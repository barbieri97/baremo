/**
 * `registrar_resultados` — o assistente propõe lançar escores, o profissional
 * decide linha a linha (spec §10.6).
 *
 * Vive fora de `src/main/ai/**` porque precisa dos repositórios gerais de
 * avaliação e resultado, que o orquestrador não pode importar (§10.5, camada 2).
 * A gravação passa por `saveResults`: a mesma validação de domínio, o mesmo
 * snapshot de classificação e a mesma transação do lançamento pelo formulário.
 *
 * Tudo que chega em `args` veio do modelo — e o modelo pode ter lido um PDF com
 * texto hostil. Por isso a pré-visualização e a gravação revalidam do zero, a
 * avaliação precisa ser do paciente da SESSÃO, e o renderer só devolve índices.
 */

import { eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { attachments, instruments } from '../db/schema'
import {
  createAssessment,
  getAssessment,
  listResults,
  saveResults
} from '../repositories/assessments'
import type { ResultBatchItem, ResultRow } from '../repositories/assessments'
import { classifyWithLookup } from './classification'
import { SCORE_TYPES, validateScoreValue } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import { formatIsoDate, isIsoDate } from '@shared/domain/dates'
import type { IsoDate } from '@shared/domain/dates'
import { SCORE_TYPE_SHORT_LABELS } from '@shared/labels'
import type { Assessment } from '@shared/contracts/entities'
import type { AiResultImportRow } from '@shared/contracts/entities-ai'

/** Mesmo teto do lançamento em lote pela interface — um PDF não justifica mais. */
const MAX_ITEMS = 200

interface ImportItem {
  readonly instrumentId: string
  readonly scoreType: string
  readonly value: unknown
  readonly note: string | null
}

interface ImportRequest {
  readonly assessmentId: string | null
  readonly newAssessment: { readonly date: IsoDate; readonly reason: string | null } | null
  readonly sourceAttachmentId: string | null
  readonly items: readonly ImportItem[]
}

interface ImportTarget {
  /** `null` quando a proposta é criar uma avaliação nova. */
  readonly assessment: Assessment | null
  readonly date: IsoDate
}

export interface ResultImportPreview {
  readonly description: string
  readonly rows: AiResultImportRow[]
}

/** Monta a tabela que o diálogo de confirmação mostra. Não grava nada. */
export function previewResultImport(
  handle: BaremoDatabase,
  patientId: string,
  args: Record<string, unknown>
): ResultImportPreview {
  const request = parseRequest(args)
  const target = resolveTarget(handle, patientId, request)
  const source = sourceName(handle, patientId, request.sourceAttachmentId)
  const rows = buildRows(handle, target, request.items).map((row) => row.preview)

  const valid = rows.filter((row) => row.status !== 'invalid').length
  const overwrites = rows.filter((row) => row.status === 'overwrite').length
  const where =
    target.assessment === null
      ? `numa NOVA avaliação de ${formatIsoDate(target.date)}`
      : `na avaliação de ${formatIsoDate(target.date)}`

  const parts = [
    `Registrar ${valid} resultado(s) ${where}${source === null ? '' : `, a partir de "${source}"`}.`
  ]
  if (overwrites > 0) {
    parts.push(
      `${overwrites} linha(s) substituem um resultado já gravado e só serão aplicadas se você marcá-las.`
    )
  }
  if (valid < rows.length) {
    parts.push(`${rows.length - valid} linha(s) inválida(s) não podem ser gravadas.`)
  }
  parts.push('Confira cada valor com o arquivo original antes de aceitar.')

  return { description: parts.join(' '), rows }
}

/**
 * Grava as linhas aceitas, depois da confirmação.
 *
 * `acceptedRows === null` (nenhuma seleção enviada) grava só as linhas novas:
 * sobrescrever um resultado existente exige sempre uma escolha explícita.
 */
export function applyResultImport(
  handle: BaremoDatabase,
  patientId: string,
  args: Record<string, unknown>,
  acceptedRows: readonly number[] | null
): string {
  const request = parseRequest(args)
  const target = resolveTarget(handle, patientId, request)
  const source = sourceName(handle, patientId, request.sourceAttachmentId)
  const accepted = acceptedRows === null ? null : new Set(acceptedRows)

  const chosen = buildRows(handle, target, request.items).filter((row) => {
    if (row.preview.status === 'invalid') return false
    if (accepted === null) return row.preview.status === 'new'
    return accepted.has(row.preview.index)
  })

  if (chosen.length === 0) return 'Nenhuma linha foi aceita; nada foi gravado.'

  const importNote =
    source === null
      ? 'Importado pelo assistente de IA.'
      : `Importado pelo assistente de IA a partir de "${source}".`

  const apply = handle.raw.transaction(() => {
    const assessment =
      target.assessment ??
      createAssessment(handle, {
        patientId,
        date: target.date,
        referralReason: request.newAssessment?.reason ?? null,
        complaint: null,
        notes: 'Criada pelo assistente de IA ao importar resultados.'
      })

    const items: ResultBatchItem[] = chosen.map((row) => ({
      id: row.existing?.id ?? null,
      input: {
        assessmentId: assessment.id,
        instrumentId: row.instrumentId,
        scoreType: row.scoreType,
        value: row.value,
        status: 'applied',
        notes: joinNotes(row.existing?.notes ?? null, importNote, row.note),
        override: null
      }
    }))

    saveResults(handle, assessment.id, items)
    return assessment
  })

  const assessment = apply()
  const overwritten = chosen.filter((row) => row.existing !== null).length
  const created = chosen.length - overwritten

  return [
    `${created} resultado(s) novo(s)`,
    overwritten > 0 ? ` e ${overwritten} substituído(s)` : '',
    ` gravado(s) na avaliação de ${formatIsoDate(assessment.date as IsoDate)}`,
    target.assessment === null ? ' (avaliação criada agora).' : '.'
  ].join('')
}

// ─── Leitura dos argumentos do modelo ────────────────────────────────────────

function parseRequest(args: Record<string, unknown>): ImportRequest {
  const assessmentId = nonEmptyString(args['avaliacaoId'])
  const rawNew = args['novaAvaliacao']
  const hasNew = typeof rawNew === 'object' && rawNew !== null

  if ((assessmentId === null) === !hasNew) {
    throw new Error('Informe avaliacaoId OU novaAvaliacao — exatamente um dos dois.')
  }

  let newAssessment: ImportRequest['newAssessment'] = null
  if (hasNew) {
    const record = rawNew as Record<string, unknown>
    const date = nonEmptyString(record['data'])
    if (date === null || !isIsoDate(date)) {
      throw new Error('A data da nova avaliação precisa estar no formato AAAA-MM-DD.')
    }
    newAssessment = { date, reason: nonEmptyString(record['motivo']) }
  }

  const rawItems = args['resultados']
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('Nenhum resultado foi informado.')
  }
  if (rawItems.length > MAX_ITEMS) {
    throw new Error(`No máximo ${MAX_ITEMS} resultados por vez.`)
  }

  const items = rawItems.map((raw): ImportItem => {
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
    return {
      instrumentId: nonEmptyString(record['instrumentoId']) ?? '',
      scoreType: nonEmptyString(record['tipoEscore']) ?? '',
      value: record['valor'],
      note: nonEmptyString(record['observacao'])
    }
  })

  return {
    assessmentId,
    newAssessment,
    sourceAttachmentId: nonEmptyString(args['arquivoOrigemId']),
    items
  }
}

/**
 * A avaliação precisa ser do paciente da sessão — revalidação de propriedade,
 * como em toda tool que recebe um ID do modelo (§10.5, camada 3).
 */
function resolveTarget(
  handle: BaremoDatabase,
  patientId: string,
  request: ImportRequest
): ImportTarget {
  if (request.assessmentId === null) {
    // parseRequest garante que uma das duas formas veio.
    const date = request.newAssessment?.date as IsoDate
    return { assessment: null, date }
  }

  let assessment: Assessment
  try {
    assessment = getAssessment(handle, request.assessmentId)
  } catch {
    throw new Error('Avaliação não encontrada.')
  }

  if (assessment.patientId !== patientId) {
    throw new Error('A avaliação indicada não pertence ao paciente desta sessão.')
  }

  return { assessment, date: assessment.date as IsoDate }
}

/** Nome do arquivo de origem — só se ele for deste prontuário. */
function sourceName(
  handle: BaremoDatabase,
  patientId: string,
  attachmentId: string | null
): string | null {
  if (attachmentId === null) return null

  const row = handle.db
    .select({ patientId: attachments.patientId, name: attachments.originalName })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .get()

  return row !== undefined && row.patientId === patientId ? row.name : null
}

// ─── Linhas ──────────────────────────────────────────────────────────────────

interface BuiltRow {
  readonly preview: AiResultImportRow
  readonly instrumentId: string
  readonly scoreType: ScoreType
  readonly value: number
  readonly note: string | null
  readonly existing: ResultRow | null
}

function buildRows(
  handle: BaremoDatabase,
  target: ImportTarget,
  items: readonly ImportItem[]
): BuiltRow[] {
  const existingByKey = new Map<string, ResultRow>()
  if (target.assessment !== null) {
    for (const row of listResults(handle, target.assessment.id)) {
      existingByKey.set(resultKey(row.instrumentId, row.scoreType), row)
    }
  }

  const seen = new Set<string>()

  return items.map((item, index) => {
    const instrument =
      item.instrumentId === ''
        ? undefined
        : handle.db
            .select({ name: instruments.name, acronym: instruments.acronym })
            .from(instruments)
            .where(eq(instruments.id, item.instrumentId))
            .get()

    const instrumentName =
      instrument === undefined
        ? 'Instrumento desconhecido'
        : instrument.acronym
          ? `${instrument.name} (${instrument.acronym})`
          : instrument.name

    const value = typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : null
    const scoreType = (SCORE_TYPES as readonly string[]).includes(item.scoreType)
      ? (item.scoreType as ScoreType)
      : null

    const invalid = (error: string): BuiltRow => ({
      preview: {
        index,
        instrumentId: instrument === undefined ? null : item.instrumentId,
        instrumentName,
        scoreType: scoreType === null ? item.scoreType : SCORE_TYPE_SHORT_LABELS[scoreType],
        value,
        classificationName: null,
        colorHex: null,
        status: 'invalid',
        existingValue: null,
        existingClassification: null,
        error,
        warning: null
      },
      instrumentId: item.instrumentId,
      scoreType: scoreType ?? 'raw',
      value: value ?? 0,
      note: item.note,
      existing: null
    })

    if (instrument === undefined) return invalid('Instrumento não encontrado no catálogo.')
    if (scoreType === null) return invalid(`Tipo de escore desconhecido: "${item.scoreType}".`)
    if (value === null) return invalid('O valor precisa ser um número.')

    const problem = validateScoreValue(value, scoreType)
    if (problem !== null) return invalid(problem.message)

    const key = resultKey(item.instrumentId, scoreType)
    if (seen.has(key)) return invalid('Item repetido nesta proposta (mesmo instrumento e tipo).')
    seen.add(key)

    const existing = existingByKey.get(key) ?? null
    const snapshot = classifyWithLookup(handle, item.instrumentId, scoreType, value)

    return {
      preview: {
        index,
        instrumentId: item.instrumentId,
        instrumentName,
        scoreType: SCORE_TYPE_SHORT_LABELS[scoreType],
        value,
        classificationName: snapshot.classificationName,
        colorHex: snapshot.colorHex,
        status: existing === null ? 'new' : 'overwrite',
        existingValue: existing?.value ?? null,
        existingClassification: existing?.classificationName ?? null,
        error: null,
        warning:
          existing?.manuallyOverridden === true
            ? 'A classificação ajustada manualmente neste resultado será substituída.'
            : null
      },
      instrumentId: item.instrumentId,
      scoreType,
      value,
      note: item.note,
      existing
    }
  })
}

function resultKey(instrumentId: string, scoreType: string): string {
  return `${instrumentId}|${scoreType}`
}

/** Preserva a nota que já existia num resultado substituído. */
function joinNotes(existing: string | null, importNote: string, itemNote: string | null): string {
  const added = itemNote === null ? importNote : `${importNote} ${itemNote}`
  if (existing !== null && existing.includes(added)) return existing
  return [existing, added]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join('\n')
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
