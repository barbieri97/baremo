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

/**
 * Um eixo do radar por função: uma função cuja SUBÁRVORE tem nível conhecido.
 *
 * `averageLevel` não é anulável aqui, ao contrário de `FunctionSummary`: uma
 * função sem nível não vira eixo, ela some do radar. O tipo diz isso para que o
 * construtor do gráfico não precise filtrar de novo o que já foi filtrado.
 */
export const radarAxisSchema = z.object({
  id: idSchema,
  name: z.string(),
  averageLevel: z.number(),
  /** Resultados de toda a subárvore — o peso por trás da média. */
  resultCount: z.number().int()
})
export type RadarAxis = z.infer<typeof radarAxisSchema>

/**
 * Um radar montado: o conjunto de irmãs que ele compara.
 *
 * O corte de eixo mínimo já foi aplicado por quem montou — se este objeto
 * existe, ele é desenhável. É o que permite que tela e PDF apenas desenhem, sem
 * cada um repetir a regra (e divergir na primeira vez que ela mudar).
 */
export const functionRadarSchema = z.object({
  /** `null` no radar geral, que compara as funções raiz. */
  parentId: idSchema.nullable(),
  title: z.string(),
  axes: z.array(radarAxisSchema)
})
export type FunctionRadar = z.infer<typeof functionRadarSchema>

/**
 * Uma função raiz e tudo o que pende dela — a unidade do "Detalhe por função".
 *
 * Os agregados aqui são de TODA a subárvore, e por isso não substituem os de
 * `FunctionSummary`: aqueles continuam por atribuição direta, que é o que os
 * cartões do panorama e as tabelas mostram. As duas contagens convivem de
 * propósito — a soma responde "como está Atenção?", a direta responde "o que
 * foi aplicado nesta função?".
 */
export const functionGroupSchema = z.object({
  /** `null` no grupo dos instrumentos sem função associada. */
  rootId: idSchema.nullable(),
  name: z.string(),
  averageLevel: z.number().nullable(),
  distribution: levelDistributionSchema,
  belowExpected: z.number().int(),
  resultCount: z.number().int(),
  /** Um por nó da subárvore com filhas suficientes, em ordem de árvore. */
  radars: z.array(functionRadarSchema),
  /** As funções com resultados diretos, da mais rebaixada à mais preservada. */
  functions: z.array(functionSummarySchema)
})
export type FunctionGroup = z.infer<typeof functionGroupSchema>

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
  /** Compara as funções raiz, somada cada subárvore. `null` com eixos de menos. */
  overallRadar: functionRadarSchema.nullable(),
  /** O detalhe por função, agrupado por raiz. */
  functionGroups: z.array(functionGroupSchema),
  tests: z.array(testGroupSchema),
  /** Resultados da avaliação principal ainda sem nível — a leitura que falta. */
  missingLevels: z.number().int(),
  totalResults: z.number().int()
})
export type ResultsOverview = z.infer<typeof resultsOverviewSchema>
