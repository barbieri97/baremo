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
import { listResultsForAssessments } from '../repositories/assessments'
import type { ResultRow } from '../repositories/assessments'
import { listCognitiveFunctions } from '../repositories/trees'
import type { CognitiveFunction } from '@shared/contracts/entities'
import { notFound } from '../ipc/register'
import { ageAt, formatAge, formatIsoDate } from '@shared/domain/dates'
import { flatten } from '@shared/domain/tree'
import { HANDEDNESS_LABELS, SEX_LABELS } from '@shared/labels'
import type { Handedness, Sex } from '@shared/labels'

/**
 * `ReportContext` e `PatientHeader` vivem no contrato, e não aqui.
 *
 * São a saída do canal `results:overview` além de serem o cabeçalho dos
 * relatórios: uma definição só evita que o schema validado na fronteira e o
 * tipo usado pelos templates divirjam.
 */
import type { PatientHeader, ReportContext } from '@shared/contracts/results'
export type { PatientHeader, ReportContext }

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

  const age = patient.birthDate !== null ? ageAt(patient.birthDate, assessment.date) : null

  return {
    profile: getProfile(handle),
    patient: {
      fullName: patient.fullName,
      birthDate: patient.birthDate !== null ? formatIsoDate(patient.birthDate) : null,
      ageAtAssessment: age !== null ? formatAge(age) : null,
      sex: SEX_LABELS[patient.sex as Sex] ?? SEX_LABELS.unspecified,
      education: patient.education,
      handedness:
        HANDEDNESS_LABELS[patient.handedness as Handedness] ?? HANDEDNESS_LABELS.unspecified
    },
    assessmentDate: formatIsoDate(assessment.date),
    referralReason: assessment.referralReason,
    complaint: assessment.complaint,
    notes: assessment.notes
  }
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
    const pairs = new Map<
      string,
      { instrumentName: string; scoreType: string; a: ResultRow | null; b: ResultRow | null }
    >()

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

export { buildContext }
