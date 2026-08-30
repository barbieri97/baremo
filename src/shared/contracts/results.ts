/**
 * Contrato da visualização de resultados (spec §7.3).
 *
 * Vive num arquivo próprio, e não em `entities.ts`, porque não é uma entidade:
 * é um view-model agregado, montado a partir de resultados, instrumentos e
 * funções cognitivas. Está aqui, e não no processo principal, por dois motivos
 * que se reforçam — é o schema de saída do canal `results:overview`, validado
 * na fronteira, e é a partir destes tipos que os construtores de gráfico em
 * `@shared/charts` desenham. Uma definição só serve os dois lados e o PDF.
 */

import { z } from 'zod'
import {
  classificationLevelSchema,
  hexColorSchema,
  idSchema,
  isoDateSchema,
  professionalProfileSchema,
  scoreTypeSchema
} from './entities'
import { RESULT_STATUSES } from '../labels'

const nullableText = z.string().nullable()

export const patientHeaderSchema = z.object({
  fullName: z.string(),
  birthDate: nullableText,
  ageAtAssessment: nullableText,
  sex: z.string(),
  education: nullableText,
  handedness: z.string()
})
export type PatientHeader = z.infer<typeof patientHeaderSchema>

/** Cabeçalho comum a todo relatório: quem assina, sobre quem, de quando. */
export const reportContextSchema = z.object({
  profile: professionalProfileSchema,
  patient: patientHeaderSchema,
  assessmentDate: z.string(),
  referralReason: nullableText,
  complaint: nullableText,
  notes: nullableText
})
export type ReportContext = z.infer<typeof reportContextSchema>

export const resultPointSchema = z.object({
  resultId: idSchema,
  assessmentId: idSchema,
  instrumentId: idSchema,
  instrumentName: z.string(),
  instrumentAcronym: nullableText,
  /** Caminho hierárquico completo, `Teste › Índice › Subteste`. */
  instrumentPath: z.string(),
  scoreType: scoreTypeSchema,
  scoreTypeLabel: z.string(),
  value: z.number().nullable(),
  /** 0–100, onde 100 é sempre o melhor desempenho. `null` em escore bruto. */
  normalized: z.number().nullable(),
  classificationName: nullableText,
  colorHex: hexColorSchema.nullable(),
  classificationLevel: classificationLevelSchema.nullable(),
  status: z.enum(RESULT_STATUSES),
  statusLabel: z.string(),
  manuallyOverridden: z.boolean(),
  notes: nullableText,
  cognitiveFunctionId: idSchema.nullable(),
  cognitiveFunctionName: nullableText
})
export type ResultPoint = z.infer<typeof resultPointSchema>

export const levelDistributionSchema = z.object({
  1: z.number().int(),
  2: z.number().int(),
  3: z.number().int(),
  4: z.number().int(),
  5: z.number().int(),
  unknown: z.number().int()
})

export const functionSummarySchema = z.object({
  /** `null` no grupo dos instrumentos sem função associada. */
  id: idSchema.nullable(),
  name: z.string(),
  depth: z.number().int(),
  points: z.array(resultPointSchema),
  averageLevel: z.number().nullable(),
  averageNormalized: z.number().nullable(),
  distribution: levelDistributionSchema,
  belowExpected: z.number().int()
})
export type FunctionSummary = z.infer<typeof functionSummarySchema>

/** Uma coluna do gráfico de comparação: um subteste, num tipo de escore. */
export const testEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  instrumentId: idSchema,
  scoreType: scoreTypeSchema,
  scoreTypeLabel: z.string(),
  /** Um por avaliação, na mesma ordem de `ResultsOverview.assessments`. */
  values: z.array(resultPointSchema.nullable())
})
export type TestEntry = z.infer<typeof testEntrySchema>

export const testGroupSchema = z.object({
  /** Instrumento raiz da árvore — o "teste". */
  instrumentId: idSchema,
  name: z.string(),
  acronym: nullableText,
  label: z.string(),
  inverted: z.boolean(),
  entries: z.array(testEntrySchema),
  /** Com uma entrada só não há o que comparar. */
  comparable: z.boolean()
})
export type TestGroup = z.infer<typeof testGroupSchema>

export const overviewAssessmentSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  dateLabel: z.string(),
  isPrimary: z.boolean()
})
export type OverviewAssessment = z.infer<typeof overviewAssessmentSchema>

export const resultsOverviewSchema = reportContextSchema.extend({
  assessmentId: idSchema,
  assessments: z.array(overviewAssessmentSchema),
  functions: z.array(functionSummarySchema),
  tests: z.array(testGroupSchema),
  /** Resultados da avaliação principal ainda sem nível — a leitura que falta. */
  missingLevels: z.number().int(),
  totalResults: z.number().int()
})
export type ResultsOverview = z.infer<typeof resultsOverviewSchema>
