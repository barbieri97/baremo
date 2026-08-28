/**
 * Avaliações e resultados (spec §4.7, §4.8).
 *
 * O reteste é uma nova avaliação, e não a edição da anterior — é o que viabiliza
 * a comparação longitudinal do §7.1.4 e preserva o que já foi emitido em laudo.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import {
  assessmentResults,
  assessments,
  attachments,
  cognitiveFunctions,
  documents,
  instruments
} from '../db/schema'
import type {
  Assessment,
  AssessmentInput,
  AssessmentResultInput
} from '@shared/contracts/entities'
import type { ScoreType } from '@shared/domain/score-types'
import { SCORE_TYPE_DOMAINS, validateScoreValue } from '@shared/domain/score-types'
import { conflict, notFound } from '../ipc/register'
import { countWhere, nowIso } from './helpers'
import type { Impact } from './helpers'
import {
  classify,
  EMPTY_SNAPSHOT,
  loadRanges,
  loadRangesForInstruments,
  rangeKey
} from '../services/classification'
import type { ClassificationSnapshot } from '../services/classification'
import { requiresValue } from '@shared/labels'
import type { ResultStatus } from '@shared/labels'

// ─── Avaliações ──────────────────────────────────────────────────────────────

export interface AssessmentWithCount extends Assessment {
  readonly resultCount: number
}

export function listAssessmentsByPatient(
  handle: BaremoDatabase,
  patientId: string,
  includeArchived: boolean
): AssessmentWithCount[] {
  const condition = includeArchived
    ? eq(assessments.patientId, patientId)
    : and(eq(assessments.patientId, patientId), isNull(assessments.archivedAt))

  return handle.db
    .select({
      id: assessments.id,
      patientId: assessments.patientId,
      date: assessments.date,
      referralReason: assessments.referralReason,
      complaint: assessments.complaint,
      notes: assessments.notes,
      createdAt: assessments.createdAt,
      archivedAt: assessments.archivedAt,
      resultCount: sql<number>`(
        select count(*) from ${assessmentResults}
         where ${assessmentResults.assessmentId} = ${assessments.id}
      )`
    })
    .from(assessments)
    .where(condition)
    .orderBy(desc(assessments.date), desc(assessments.createdAt))
    .all() as AssessmentWithCount[]
}

export function getAssessment(handle: BaremoDatabase, id: string): Assessment {
  const row = handle.db.select().from(assessments).where(eq(assessments.id, id)).get()
  if (!row) throw notFound('Avaliação não encontrada.')
  return row as Assessment
}

export function createAssessment(
  handle: BaremoDatabase,
  input: AssessmentInput
): Assessment {
  const id = randomUUID()
  handle.db
    .insert(assessments)
    .values({ id, ...input, createdAt: nowIso(), archivedAt: null })
    .run()
  return getAssessment(handle, id)
}

export function updateAssessment(
  handle: BaremoDatabase,
  id: string,
  input: AssessmentInput
): Assessment {
  const existing = getAssessment(handle, id)
  if (existing.patientId !== input.patientId) {
    throw conflict('Uma avaliação não pode ser transferida para outro paciente.')
  }

  handle.db.update(assessments).set(input).where(eq(assessments.id, id)).run()
  return getAssessment(handle, id)
}

export function setAssessmentArchived(
  handle: BaremoDatabase,
  id: string,
  archived: boolean
): Assessment {
  const result = handle.db
    .update(assessments)
    .set({ archivedAt: archived ? nowIso() : null })
    .where(eq(assessments.id, id))
    .run()
  if (result.changes === 0) throw notFound('Avaliação não encontrada.')
  return getAssessment(handle, id)
}

export function assessmentImpact(handle: BaremoDatabase, id: string): Impact {
  const assessment = getAssessment(handle, id)

  return {
    label: `Avaliação de ${assessment.date}`,
    counts: [
      {
        entity: 'Resultados registrados',
        count: countWhere(handle, assessmentResults, eq(assessmentResults.assessmentId, id))
      },
      {
        entity: 'Documentos vinculados',
        count: countWhere(handle, documents, eq(documents.assessmentId, id))
      },
      {
        entity: 'Arquivos vinculados (perderão o vínculo)',
        count: countWhere(handle, attachments, eq(attachments.assessmentId, id))
      }
    ]
  }
}

export function deleteAssessment(handle: BaremoDatabase, id: string): void {
  getAssessment(handle, id)
  handle.db.delete(assessments).where(eq(assessments.id, id)).run()
}

// ─── Resultados ──────────────────────────────────────────────────────────────

export interface ResultRow {
  id: string
  assessmentId: string
  instrumentId: string
  scoreType: ScoreType
  value: number | null
  status: ResultStatus
  classificationName: string | null
  colorHex: string | null
  rangeId: string | null
  rangeVersion: number | null
  manuallyOverridden: boolean
  notes: string | null
  instrumentName: string
  instrumentAcronym: string | null
  cognitiveFunctionId: string | null
  cognitiveFunctionName: string | null
}

export function listResults(handle: BaremoDatabase, assessmentId: string): ResultRow[] {
  return handle.db
    .select({
      id: assessmentResults.id,
      assessmentId: assessmentResults.assessmentId,
      instrumentId: assessmentResults.instrumentId,
      scoreType: assessmentResults.scoreType,
      value: assessmentResults.value,
      status: assessmentResults.status,
      classificationName: assessmentResults.classificationName,
      colorHex: assessmentResults.colorHex,
      rangeId: assessmentResults.rangeId,
      rangeVersion: assessmentResults.rangeVersion,
      manuallyOverridden: assessmentResults.manuallyOverridden,
      notes: assessmentResults.notes,
      instrumentName: instruments.name,
      instrumentAcronym: instruments.acronym,
      cognitiveFunctionId: instruments.cognitiveFunctionId,
      cognitiveFunctionName: cognitiveFunctions.name
    })
    .from(assessmentResults)
    .innerJoin(instruments, eq(instruments.id, assessmentResults.instrumentId))
    .leftJoin(cognitiveFunctions, eq(cognitiveFunctions.id, instruments.cognitiveFunctionId))
    .where(eq(assessmentResults.assessmentId, assessmentId))
    .orderBy(asc(instruments.order), asc(instruments.name))
    .all() as ResultRow[]
}

function getResultRow(handle: BaremoDatabase, id: string): ResultRow {
  const row = handle.db
    .select({ assessmentId: assessmentResults.assessmentId })
    .from(assessmentResults)
    .where(eq(assessmentResults.id, id))
    .get()
  if (!row) throw notFound('Resultado não encontrado.')

  const found = listResults(handle, row.assessmentId).find((result) => result.id === id)
  if (!found) throw notFound('Resultado não encontrado.')
  return found
}

/**
 * Grava um resultado, resolvendo a classificação no momento da gravação.
 *
 * O snapshot (ADR-004) acontece aqui e em nenhum outro lugar: `classify` devolve
 * nome e cor, que viram coluna. Uma sobrescrita manual substitui o snapshot e
 * marca `manuallyOverridden`, o que faz o reprocessamento posterior respeitá-la.
 */
export function saveResult(
  handle: BaremoDatabase,
  id: string | null,
  input: AssessmentResultInput
): ResultRow {
  getAssessment(handle, input.assessmentId)

  if (countWhere(handle, instruments, eq(instruments.id, input.instrumentId)) === 0) {
    throw notFound('Instrumento não encontrado.')
  }

  const value = requiresValue(input.status) ? input.value : null
  if (value !== null) {
    const problem = validateScoreValue(value, input.scoreType)
    if (problem) throw conflict(problem.message)
  }

  const snapshot = resolveSnapshot(handle, input, value)

  const values = {
    assessmentId: input.assessmentId,
    instrumentId: input.instrumentId,
    scoreType: input.scoreType,
    value,
    status: input.status,
    classificationName: snapshot.classificationName,
    colorHex: snapshot.colorHex,
    rangeId: snapshot.rangeId,
    rangeVersion: snapshot.rangeVersion,
    manuallyOverridden: input.override !== null,
    notes: input.notes
  }

  if (id === null) {
    const newId = randomUUID()
    try {
      handle.db.insert(assessmentResults).values({ id: newId, ...values }).run()
    } catch (error) {
      // O índice único (avaliação, instrumento, tipo de escore) impede duplicata;
      // a mensagem crua do SQLite não ajudaria o usuário.
      if (isUniqueViolation(error)) {
        throw conflict(
          'Já existe um resultado deste instrumento com este tipo de escore nesta avaliação.'
        )
      }
      throw error
    }
    return getResultRow(handle, newId)
  }

  const updated = handle.db
    .update(assessmentResults)
    .set(values)
    .where(eq(assessmentResults.id, id))
    .run()
  if (updated.changes === 0) throw notFound('Resultado não encontrado.')

  return getResultRow(handle, id)
}

function resolveSnapshot(
  handle: BaremoDatabase,
  input: AssessmentResultInput,
  value: number | null
): ClassificationSnapshot {
  if (input.override !== null) {
    return {
      classificationName: input.override.classificationName,
      colorHex: input.override.colorHex,
      rangeId: null,
      rangeVersion: null
    }
  }

  if (value === null || !SCORE_TYPE_DOMAINS[input.scoreType].autoClassify) {
    return EMPTY_SNAPSHOT
  }

  return classify(value, input.scoreType, loadRanges(handle, input.instrumentId, input.scoreType))
}

export function deleteResult(handle: BaremoDatabase, id: string): void {
  const result = handle.db.delete(assessmentResults).where(eq(assessmentResults.id, id)).run()
  if (result.changes === 0) throw notFound('Resultado não encontrado.')
}

// ─── Reprocessamento (ADR-004) ───────────────────────────────────────────────

export interface ReprocessChange {
  readonly resultId: string
  readonly instrumentName: string
  readonly from: string | null
  readonly to: string | null
}

/**
 * Calcula o que mudaria se as classificações desta avaliação fossem
 * reprocessadas com as faixas atuais.
 *
 * Resultados sobrescritos manualmente ficam de fora: a decisão do profissional
 * prevalece sobre a tabela.
 */
export function previewReprocess(
  handle: BaremoDatabase,
  assessmentId: string
): ReprocessChange[] {
  const results = listResults(handle, assessmentId)
  const rangesByKey = loadRangesForInstruments(handle, [
    ...new Set(results.map((result) => result.instrumentId))
  ])

  const changes: ReprocessChange[] = []

  for (const result of results) {
    if (result.manuallyOverridden || result.value === null) continue

    const ranges = rangesByKey.get(rangeKey(result.instrumentId, result.scoreType)) ?? []
    const snapshot = classify(result.value, result.scoreType, ranges)

    if (snapshot.classificationName !== result.classificationName) {
      changes.push({
        resultId: result.id,
        instrumentName: result.instrumentName,
        from: result.classificationName,
        to: snapshot.classificationName
      })
    }
  }

  return changes
}

export interface ReprocessOutcome {
  readonly updated: number
  readonly unchanged: number
  readonly unresolved: number
}

export function reprocessAssessment(
  handle: BaremoDatabase,
  assessmentId: string
): ReprocessOutcome {
  const results = listResults(handle, assessmentId)
  const rangesByKey = loadRangesForInstruments(handle, [
    ...new Set(results.map((result) => result.instrumentId))
  ])

  let updated = 0
  let unchanged = 0
  let unresolved = 0

  const apply = handle.raw.transaction(() => {
    for (const result of results) {
      if (result.manuallyOverridden || result.value === null) {
        unchanged++
        continue
      }

      const ranges = rangesByKey.get(rangeKey(result.instrumentId, result.scoreType)) ?? []
      const snapshot = classify(result.value, result.scoreType, ranges)

      if (snapshot.classificationName === null) unresolved++

      if (
        snapshot.classificationName === result.classificationName &&
        snapshot.colorHex === result.colorHex
      ) {
        unchanged++
        continue
      }

      handle.db
        .update(assessmentResults)
        .set({
          classificationName: snapshot.classificationName,
          colorHex: snapshot.colorHex,
          rangeId: snapshot.rangeId,
          rangeVersion: snapshot.rangeVersion
        })
        .where(eq(assessmentResults.id, result.id))
        .run()

      updated++
    }
  })

  apply()
  return { updated, unchanged, unresolved }
}

/** Resultados de várias avaliações de uma vez — usado pelo relatório comparativo. */
export function listResultsForAssessments(
  handle: BaremoDatabase,
  assessmentIds: readonly string[]
): ResultRow[] {
  if (assessmentIds.length === 0) return []

  return handle.db
    .select({
      id: assessmentResults.id,
      assessmentId: assessmentResults.assessmentId,
      instrumentId: assessmentResults.instrumentId,
      scoreType: assessmentResults.scoreType,
      value: assessmentResults.value,
      status: assessmentResults.status,
      classificationName: assessmentResults.classificationName,
      colorHex: assessmentResults.colorHex,
      rangeId: assessmentResults.rangeId,
      rangeVersion: assessmentResults.rangeVersion,
      manuallyOverridden: assessmentResults.manuallyOverridden,
      notes: assessmentResults.notes,
      instrumentName: instruments.name,
      instrumentAcronym: instruments.acronym,
      cognitiveFunctionId: instruments.cognitiveFunctionId,
      cognitiveFunctionName: cognitiveFunctions.name
    })
    .from(assessmentResults)
    .innerJoin(instruments, eq(instruments.id, assessmentResults.instrumentId))
    .leftJoin(cognitiveFunctions, eq(cognitiveFunctions.id, instruments.cognitiveFunctionId))
    .where(inArray(assessmentResults.assessmentId, [...assessmentIds]))
    .orderBy(asc(instruments.order), asc(instruments.name))
    .all() as ResultRow[]
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    String((error as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT')
  )
}
