/**
 * Montagem dos dados dos relatórios (spec §7.1).
 *
 * Separa a consulta ao banco da geração de HTML: os templates recebem um
 * view-model pronto e não fazem I/O. É o que permite testar a montagem sem
 * Electron e o serializador sem banco.
 */

import { eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { assessments, patients } from '../db/schema'
import { getProfile } from '../repositories/config'
import { listResults, listResultsForAssessments } from '../repositories/assessments'
import type { ResultRow } from '../repositories/assessments'
import { listCognitiveFunctions, listInstruments } from '../repositories/trees'
import type { CognitiveFunction, Instrument, ProfessionalProfile } from '@shared/contracts/entities'
import { notFound } from '../ipc/register'
import { ageAt, formatAge, formatIsoDate } from '@shared/domain/dates'
import { flatten } from '@shared/domain/tree'
import { HANDEDNESS_LABELS, SEX_LABELS } from '@shared/labels'
import type { Handedness, Sex } from '@shared/labels'

export interface PatientHeader {
  readonly fullName: string
  readonly birthDate: string | null
  readonly ageAtAssessment: string | null
  readonly sex: string
  readonly education: string | null
  readonly handedness: string
}

export interface ReportContext {
  readonly profile: ProfessionalProfile
  readonly patient: PatientHeader
  readonly assessmentDate: string
  readonly referralReason: string | null
  readonly complaint: string | null
  readonly notes: string | null
}

/** Uma linha da árvore de saída: o nó mais os resultados que pertencem a ele. */
export interface ReportTreeRow {
  readonly id: string
  readonly label: string
  readonly depth: number
  readonly results: readonly ResultRow[]
}

export interface FunctionReport extends ReportContext {
  readonly rows: readonly ReportTreeRow[]
  /** Resultados de instrumentos sem função cognitiva associada. */
  readonly unassigned: readonly ResultRow[]
}

export interface InstrumentReport extends ReportContext {
  readonly rows: readonly ReportTreeRow[]
}

export interface ComparativeRow {
  readonly label: string
  readonly depth: number
  readonly entries: readonly {
    readonly instrumentName: string
    readonly scoreType: string
    readonly a: ResultRow | null
    readonly b: ResultRow | null
  }[]
}

export interface ComparativeReport extends ReportContext {
  readonly assessmentDateB: string
  readonly rows: readonly ComparativeRow[]
}

function buildContext(handle: BaremoDatabase, assessmentId: string): ReportContext {
  const assessment = handle.db
    .select()
    .from(assessments)
    .where(eq(assessments.id, assessmentId))
    .get()
  if (!assessment) throw notFound('Avaliação não encontrada.')

  const patient = handle.db
    .select()
    .from(patients)
    .where(eq(patients.id, assessment.patientId))
    .get()
  if (!patient) throw notFound('Paciente não encontrado.')

  const age =
    patient.birthDate !== null ? ageAt(patient.birthDate, assessment.date) : null

  return {
    profile: getProfile(handle),
    patient: {
      fullName: patient.fullName,
      birthDate: patient.birthDate !== null ? formatIsoDate(patient.birthDate) : null,
      ageAtAssessment: age !== null ? formatAge(age) : null,
      sex: SEX_LABELS[patient.sex as Sex] ?? SEX_LABELS.unspecified,
      education: patient.education,
      handedness: HANDEDNESS_LABELS[patient.handedness as Handedness] ?? HANDEDNESS_LABELS.unspecified
    },
    assessmentDate: formatIsoDate(assessment.date),
    referralReason: assessment.referralReason,
    complaint: assessment.complaint,
    notes: assessment.notes
  }
}

/**
 * Relatório por função cognitiva (§7.1.1).
 *
 * Cada resultado é pendurado na função do seu instrumento. Funções sem
 * resultado permanecem na árvore quando algum descendente tem resultado — é o
 * que preserva a hierarquia visível; ramos inteiramente vazios são podados,
 * para o relatório não virar uma lista do catálogo.
 */
export function buildFunctionReport(
  handle: BaremoDatabase,
  assessmentId: string
): FunctionReport {
  const context = buildContext(handle, assessmentId)
  const results = listResults(handle, assessmentId)
  const functions = listCognitiveFunctions(handle)

  const byFunction = groupBy(results, (result) => result.cognitiveFunctionId)
  const flat = flatten(functions)

  const withContent = new Set<string>()
  for (const { node } of flat) {
    if ((byFunction.get(node.id) ?? []).length > 0) {
      for (const ancestor of ancestorsOf(functions, node.id)) withContent.add(ancestor)
    }
  }

  const rows: ReportTreeRow[] = flat
    .filter(({ node }) => withContent.has(node.id))
    .map(({ node, depth }) => ({
      id: node.id,
      label: (node as CognitiveFunction).name,
      depth,
      results: byFunction.get(node.id) ?? []
    }))

  return { ...context, rows, unassigned: byFunction.get(null) ?? [] }
}

/**
 * Relatório por hierarquia de instrumentos (§7.1.2).
 *
 * Segue a estrutura psicométrica original — teste principal → índices compostos
 * → subtestes — em vez da organização por função.
 */
export function buildInstrumentReport(
  handle: BaremoDatabase,
  assessmentId: string
): InstrumentReport {
  const context = buildContext(handle, assessmentId)
  const results = listResults(handle, assessmentId)
  const catalog = listInstruments(handle)

  const byInstrument = groupBy(results, (result) => result.instrumentId)
  const flat = flatten(catalog)

  const withContent = new Set<string>()
  for (const { node } of flat) {
    if ((byInstrument.get(node.id) ?? []).length > 0) {
      for (const ancestor of ancestorsOf(catalog, node.id)) withContent.add(ancestor)
    }
  }

  const rows: ReportTreeRow[] = flat
    .filter(({ node }) => withContent.has(node.id))
    .map(({ node, depth }) => ({
      id: node.id,
      label: instrumentLabel(node as Instrument),
      depth,
      results: byInstrument.get(node.id) ?? []
    }))

  return { ...context, rows }
}

/** Relatório comparativo (§7.1.4): duas avaliações do mesmo paciente. */
export function buildComparativeReport(
  handle: BaremoDatabase,
  assessmentIdA: string,
  assessmentIdB: string
): ComparativeReport {
  const context = buildContext(handle, assessmentIdA)
  const contextB = buildContext(handle, assessmentIdB)

  const results = listResultsForAssessments(handle, [assessmentIdA, assessmentIdB])
  const functions = listCognitiveFunctions(handle)

  const byFunction = groupBy(results, (result) => result.cognitiveFunctionId)
  const flat = flatten(functions)

  const rows: ComparativeRow[] = []

  const collect = (functionId: string | null, label: string, depth: number): void => {
    const bucket = byFunction.get(functionId) ?? []
    if (bucket.length === 0) return

    // Pareia por instrumento + tipo de escore: comparar percentil com T-score
    // não diria nada.
    const pairs = new Map<string, { instrumentName: string; scoreType: string; a: ResultRow | null; b: ResultRow | null }>()

    for (const result of bucket) {
      const key = `${result.instrumentId}::${result.scoreType}`
      const entry = pairs.get(key) ?? {
        instrumentName: result.instrumentName,
        scoreType: result.scoreType,
        a: null,
        b: null
      }
      if (result.assessmentId === assessmentIdA) entry.a = result
      else entry.b = result
      pairs.set(key, entry)
    }

    rows.push({ label, depth, entries: [...pairs.values()] })
  }

  for (const { node, depth } of flat) {
    collect(node.id, (node as CognitiveFunction).name, depth)
  }
  collect(null, 'Sem função cognitiva associada', 0)

  return { ...context, assessmentDateB: contextB.assessmentDate, rows }
}

function instrumentLabel(instrument: Instrument): string {
  return instrument.acronym !== null && instrument.acronym.length > 0
    ? `${instrument.name} (${instrument.acronym})`
    : instrument.name
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const bucket = map.get(k)
    if (bucket) bucket.push(item)
    else map.set(k, [item])
  }
  return map
}

/** IDs do nó e de todos os seus ancestrais. */
function ancestorsOf(
  nodes: readonly { id: string; parentId: string | null }[],
  id: string
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const out: string[] = []
  const seen = new Set<string>()

  let cursor: string | null = id
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor)
    out.push(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }

  return out
}

export { buildContext }
