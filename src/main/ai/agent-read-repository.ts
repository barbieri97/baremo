/**
 * Repositório de leitura do agente (spec §10.5) — o requisito crítico do módulo.
 *
 * Esta é a camada 2 das quatro do isolamento por paciente:
 *
 *  1. nenhuma tool declara `patientId` no schema exposto ao modelo — o ID vem do
 *     contexto de sessão, no processo principal;
 *  2. **este repositório recebe o `patientId` no construtor e injeta o filtro em
 *     TODA consulta**; os repositórios gerais do app não são alcançáveis pelo
 *     orquestrador, o que é imposto por `no-restricted-imports` no ESLint;
 *  3. todo ID vindo do modelo é revalidado quanto à propriedade antes de
 *     retornar — `assertOwned*` abaixo;
 *  4. suíte adversarial como gate de CI.
 *
 * Nenhum método aceita `patientId` como argumento. Se um dia algum aceitar, a
 * camada 1 terá sido furada — e é por isso que a assinatura importa tanto
 * quanto a implementação.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import {
  assessmentResults,
  assessments,
  attachments,
  classificationRanges,
  cognitiveFunctions,
  colors,
  documents,
  instruments,
  patients
} from '../db/schema'
import { ageAt, formatAge, formatIsoDate } from '@shared/domain/dates'
import { SCORE_TYPE_SHORT_LABELS, RESULT_STATUS_LABELS } from '@shared/labels'
import type { ResultStatus } from '@shared/labels'
import type { ScoreType } from '@shared/domain/score-types'
import { identifiedPatient, pseudonymizePatient, scrubText } from './pseudonymize'
import type { IdentifiedPatient, PseudonymizedPatient } from './pseudonymize'
import { extractPlainText } from '../pdf/serialize'

/** Erro de escopo: o modelo pediu um registro que não é do paciente da sessão. */
export class ScopeViolationError extends Error {
  constructor(
    readonly entity: string,
    readonly requestedId: string
  ) {
    super(`O registro solicitado não pertence ao paciente desta sessão.`)
    this.name = 'ScopeViolationError'
  }
}

export interface AgentRepositoryOptions {
  readonly pseudonymize: boolean
}

export class AgentReadRepository {
  /**
   * `patientId` é `readonly` e privado: nem o orquestrador nem uma tool
   * conseguem trocá-lo depois de construído. É a contraparte em código do
   * princípio 3 do §10.1 — uma sessão pertence a exatamente um paciente.
   */
  constructor(
    private readonly handle: BaremoDatabase,
    private readonly patientId: string,
    private readonly options: AgentRepositoryOptions
  ) {}

  // ─── Revalidação de propriedade (camada 3) ─────────────────────────────────

  /**
   * Confirma que a avaliação é do paciente da sessão.
   *
   * O modelo pode inventar um ID, ou repetir um ID válido de outro prontuário
   * visto em outro contexto. Os dois casos param aqui.
   */
  assertOwnedAssessment(assessmentId: string): void {
    const row = this.handle.db
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.patientId, this.patientId)))
      .get()

    if (!row) throw new ScopeViolationError('assessment', assessmentId)
  }

  assertOwnedDocument(documentId: string): void {
    const row = this.handle.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.patientId, this.patientId)))
      .get()

    if (!row) throw new ScopeViolationError('document', documentId)
  }

  assertOwnedAttachment(attachmentId: string): void {
    const row = this.handle.db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.patientId, this.patientId)))
      .get()

    if (!row) throw new ScopeViolationError('attachment', attachmentId)
  }

  // ─── Tools de leitura (§10.6) ──────────────────────────────────────────────

  getPatientProfile(): PseudonymizedPatient | IdentifiedPatient {
    const row = this.handle.db
      .select()
      .from(patients)
      .where(eq(patients.id, this.patientId))
      .get()

    if (!row) throw new ScopeViolationError('patient', this.patientId)

    const mostRecent = this.handle.db
      .select({ date: assessments.date })
      .from(assessments)
      .where(eq(assessments.patientId, this.patientId))
      .orderBy(desc(assessments.date))
      .limit(1)
      .get()

    return this.options.pseudonymize
      ? pseudonymizePatient(row, mostRecent?.date ?? null)
      : identifiedPatient(row)
  }

  listAssessments(): {
    assessmentId: string
    date: string
    referralReason: string | null
    resultCount: number
  }[] {
    const rows = this.handle.db
      .select({
        id: assessments.id,
        date: assessments.date,
        referralReason: assessments.referralReason
      })
      .from(assessments)
      .where(eq(assessments.patientId, this.patientId))
      .orderBy(desc(assessments.date))
      .all()

    return rows.map((row) => ({
      assessmentId: row.id,
      date: formatIsoDate(row.date),
      referralReason: this.scrub(row.referralReason),
      resultCount: this.countResults(row.id)
    }))
  }

  getAssessment(assessmentId: string): {
    assessmentId: string
    date: string
    ageAtAssessment: string | null
    referralReason: string | null
    complaint: string | null
    notes: string | null
    resultCount: number
  } {
    this.assertOwnedAssessment(assessmentId)

    // Mesmo depois da revalidação, a consulta carrega o filtro por paciente: a
    // regra é que NENHUMA consulta daqui saia sem ele.
    const row = this.handle.db
      .select()
      .from(assessments)
      .where(and(eq(assessments.id, assessmentId), eq(assessments.patientId, this.patientId)))
      .get()

    if (!row) throw new ScopeViolationError('assessment', assessmentId)

    const patient = this.handle.db
      .select({ birthDate: patients.birthDate })
      .from(patients)
      .where(eq(patients.id, this.patientId))
      .get()

    const age =
      patient?.birthDate != null ? ageAt(patient.birthDate, row.date) : null

    return {
      assessmentId: row.id,
      date: formatIsoDate(row.date),
      ageAtAssessment: age !== null ? formatAge(age) : null,
      referralReason: this.scrub(row.referralReason),
      complaint: this.scrub(row.complaint),
      notes: this.scrub(row.notes),
      resultCount: this.countResults(row.id)
    }
  }

  listResults(
    assessmentId: string,
    cognitiveFunctionId: string | null
  ): {
    instrument: string
    cognitiveFunction: string | null
    scoreType: string
    value: number | null
    classification: string | null
    status: string
    manuallyOverridden: boolean
  }[] {
    this.assertOwnedAssessment(assessmentId)

    const rows = this.handle.db
      .select({
        instrumentName: instruments.name,
        instrumentAcronym: instruments.acronym,
        cognitiveFunctionName: cognitiveFunctions.name,
        cognitiveFunctionId: instruments.cognitiveFunctionId,
        scoreType: assessmentResults.scoreType,
        value: assessmentResults.value,
        classificationName: assessmentResults.classificationName,
        status: assessmentResults.status,
        manuallyOverridden: assessmentResults.manuallyOverridden
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessmentResults.instrumentId))
      .leftJoin(cognitiveFunctions, eq(cognitiveFunctions.id, instruments.cognitiveFunctionId))
      .where(
        and(
          eq(assessmentResults.assessmentId, assessmentId),
          eq(assessments.patientId, this.patientId)
        )
      )
      .all()

    return rows
      .filter(
        (row) =>
          cognitiveFunctionId === null || row.cognitiveFunctionId === cognitiveFunctionId
      )
      .map((row) => ({
        instrument: row.instrumentAcronym
          ? `${row.instrumentName} (${row.instrumentAcronym})`
          : row.instrumentName,
        cognitiveFunction: row.cognitiveFunctionName,
        scoreType: SCORE_TYPE_SHORT_LABELS[row.scoreType as ScoreType] ?? row.scoreType,
        value: row.value,
        classification: row.classificationName,
        status: RESULT_STATUS_LABELS[row.status as ResultStatus] ?? row.status,
        manuallyOverridden: row.manuallyOverridden
      }))
  }

  compareAssessments(
    assessmentIdA: string,
    assessmentIdB: string
  ): {
    cognitiveFunction: string
    instrument: string
    scoreType: string
    valueA: number | null
    valueB: number | null
    classificationA: string | null
    classificationB: string | null
    classificationChanged: boolean
  }[] {
    this.assertOwnedAssessment(assessmentIdA)
    this.assertOwnedAssessment(assessmentIdB)

    const rows = this.handle.db
      .select({
        assessmentId: assessmentResults.assessmentId,
        instrumentId: assessmentResults.instrumentId,
        instrumentName: instruments.name,
        cognitiveFunctionName: cognitiveFunctions.name,
        scoreType: assessmentResults.scoreType,
        value: assessmentResults.value,
        classificationName: assessmentResults.classificationName
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessmentResults.instrumentId))
      .leftJoin(cognitiveFunctions, eq(cognitiveFunctions.id, instruments.cognitiveFunctionId))
      .where(
        and(
          inArray(assessmentResults.assessmentId, [assessmentIdA, assessmentIdB]),
          eq(assessments.patientId, this.patientId)
        )
      )
      .all()

    const pairs = new Map<string, (typeof rows)[number][]>()
    for (const row of rows) {
      const key = `${row.instrumentId}::${row.scoreType}`
      const bucket = pairs.get(key)
      if (bucket) bucket.push(row)
      else pairs.set(key, [row])
    }

    return [...pairs.values()].map((bucket) => {
      const a = bucket.find((row) => row.assessmentId === assessmentIdA) ?? null
      const b = bucket.find((row) => row.assessmentId === assessmentIdB) ?? null
      const reference = a ?? b!

      return {
        cognitiveFunction: reference.cognitiveFunctionName ?? 'Sem função associada',
        instrument: reference.instrumentName,
        scoreType:
          SCORE_TYPE_SHORT_LABELS[reference.scoreType as ScoreType] ?? reference.scoreType,
        valueA: a?.value ?? null,
        valueB: b?.value ?? null,
        classificationA: a?.classificationName ?? null,
        classificationB: b?.classificationName ?? null,
        classificationChanged:
          a !== null && b !== null && a.classificationName !== b.classificationName
      }
    })
  }

  listDocuments(): {
    documentId: string
    title: string
    type: string
    status: string
    createdAt: string
  }[] {
    return this.handle.db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        status: documents.status,
        createdAt: documents.createdAt
      })
      .from(documents)
      .where(eq(documents.patientId, this.patientId))
      .orderBy(desc(documents.updatedAt))
      .all()
      .map((row) => ({
        documentId: row.id,
        title: this.scrub(row.title) ?? row.title,
        type: row.type,
        status: row.status,
        createdAt: row.createdAt
      }))
  }

  readDocument(documentId: string): { title: string; type: string; text: string } {
    this.assertOwnedDocument(documentId)

    const row = this.handle.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.patientId, this.patientId)))
      .get()

    if (!row) throw new ScopeViolationError('document', documentId)

    let content: unknown = null
    try {
      content = JSON.parse(row.contentJson)
    } catch {
      content = null
    }

    return {
      title: this.scrub(row.title) ?? row.title,
      type: row.type,
      text: this.scrub(extractPlainText(content)) ?? ''
    }
  }

  listAttachments(): {
    attachmentId: string
    name: string
    mime: string
    sizeBytes: number
    description: string | null
  }[] {
    return this.handle.db
      .select({
        id: attachments.id,
        originalName: attachments.originalName,
        detectedMime: attachments.detectedMime,
        sizeBytes: attachments.sizeBytes,
        description: attachments.description
      })
      .from(attachments)
      .where(eq(attachments.patientId, this.patientId))
      .all()
      .map((row) => ({
        attachmentId: row.id,
        name: this.scrub(row.originalName) ?? row.originalName,
        mime: row.detectedMime,
        sizeBytes: row.sizeBytes,
        description: this.scrub(row.description)
      }))
  }

  /** Metadados do anexo, para o orquestrador decidir como enviá-lo (§10.6). */
  getAttachmentForReading(attachmentId: string): {
    sha256: string
    extension: string
    mime: string
    sizeBytes: number
    name: string
  } {
    this.assertOwnedAttachment(attachmentId)

    const row = this.handle.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.patientId, this.patientId)))
      .get()

    if (!row) throw new ScopeViolationError('attachment', attachmentId)

    return {
      sha256: row.sha256,
      extension: row.extension,
      mime: row.detectedMime,
      sizeBytes: row.sizeBytes,
      name: row.originalName
    }
  }

  /**
   * Faixas de classificação — dado de CATÁLOGO, não clínico.
   *
   * É a única leitura sem filtro por paciente, e de propósito: a tabela de
   * faixas de um instrumento não pertence a nenhum prontuário. Nada aqui revela
   * quem foi avaliado, nem com que resultado.
   */
  getClassificationRanges(
    instrumentId: string,
    scoreType: string
  ): { classification: string; min: number; max: number; color: string }[] {
    return this.handle.db
      .select({
        classification: classificationRanges.classificationName,
        min: classificationRanges.minValue,
        max: classificationRanges.maxValue,
        color: colors.name
      })
      .from(classificationRanges)
      .innerJoin(colors, eq(colors.id, classificationRanges.colorId))
      .where(
        and(
          eq(classificationRanges.instrumentId, instrumentId),
          eq(classificationRanges.scoreType, scoreType)
        )
      )
      .orderBy(classificationRanges.minValue)
      .all()
  }

  /** IDs de instrumentos usados por este paciente — para o modelo não chutar. */
  listUsedInstruments(): { instrumentId: string; name: string; scoreTypes: string[] }[] {
    const rows = this.handle.db
      .select({
        instrumentId: assessmentResults.instrumentId,
        name: instruments.name,
        scoreType: assessmentResults.scoreType
      })
      .from(assessmentResults)
      .innerJoin(assessments, eq(assessments.id, assessmentResults.assessmentId))
      .innerJoin(instruments, eq(instruments.id, assessmentResults.instrumentId))
      .where(eq(assessments.patientId, this.patientId))
      .all()

    const byInstrument = new Map<string, { name: string; scoreTypes: Set<string> }>()
    for (const row of rows) {
      const entry = byInstrument.get(row.instrumentId) ?? {
        name: row.name,
        scoreTypes: new Set<string>()
      }
      entry.scoreTypes.add(row.scoreType)
      byInstrument.set(row.instrumentId, entry)
    }

    return [...byInstrument.entries()].map(([instrumentId, entry]) => ({
      instrumentId,
      name: entry.name,
      scoreTypes: [...entry.scoreTypes]
    }))
  }

  /** Nome real do paciente — só para uso local no processo principal. */
  patientFullNameForLocalUse(): string {
    const row = this.handle.db
      .select({ fullName: patients.fullName })
      .from(patients)
      .where(eq(patients.id, this.patientId))
      .get()
    return row?.fullName ?? ''
  }

  private countResults(assessmentId: string): number {
    const row = this.handle.raw
      .prepare(
        `SELECT count(*) AS total
           FROM assessment_results r
           JOIN assessments a ON a.id = r.assessment_id
          WHERE r.assessment_id = ? AND a.patient_id = ?`
      )
      .get(assessmentId, this.patientId) as { total: number }
    return row.total
  }

  /** Aplica a pseudonimização a texto livre quando ela está ligada (§10.3). */
  private scrub(value: string | null): string | null {
    if (value === null) return null
    if (!this.options.pseudonymize) return value
    return scrubText(value, this.patientFullNameForLocalUse())
  }
}
