/**
 * Schemas Zod das entidades do domínio (spec §4).
 *
 * São a fonte única de verdade: o schema Drizzle é escrito para casar com eles,
 * os contratos de IPC os reutilizam, e os tipos TypeScript do renderer são
 * inferidos daqui. Um campo que não existe aqui não atravessa a fronteira IPC.
 */

import { z } from 'zod'
import { SCORE_TYPES } from '../domain/score-types'
import { isIsoDate } from '../domain/dates'
import {
  AUDIT_ACTIONS,
  DOCUMENT_ORIGINS,
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
  HANDEDNESS,
  RESULT_STATUSES,
  SEXES
} from '../labels'

export const idSchema = z.uuid()

export const isoDateSchema = z
  .string()
  .refine(isIsoDate, { message: 'Data inválida. Use o formato AAAA-MM-DD.' })

export const timestampSchema = z.iso.datetime()

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor inválida. Use o formato #RRGGBB.')

export const scoreTypeSchema = z.enum(SCORE_TYPES)

/** Texto livre de campo curto; `trim` evita nomes que diferem só por espaço. */
const shortText = z.string().trim().min(1).max(200)
const optionalShortText = z.string().trim().max(200).nullable()
const longText = z.string().trim().max(20_000).nullable()

// ─── Perfil profissional (§4.1, registro único) ──────────────────────────────

export const professionalProfileSchema = z.object({
  name: z.string().trim().max(200),
  crp: z.string().trim().max(40),
  specialty: z.string().trim().max(200),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(200),
  address: z.string().trim().max(400),
  /** Logo do cabeçalho de relatório, como data URI. Opcional. */
  logoDataUrl: z.string().max(2_000_000).nullable()
})
export type ProfessionalProfile = z.infer<typeof professionalProfileSchema>

// ─── Paleta de cores (§5) ────────────────────────────────────────────────────

export const colorSchema = z.object({
  id: idSchema,
  name: shortText,
  hex: hexColorSchema,
  order: z.number().int(),
  /** Cores semeadas podem ser editadas, mas a origem é útil para o "restaurar padrão". */
  isSeed: z.boolean()
})
export type Color = z.infer<typeof colorSchema>

// ─── Paciente (§4.2) ─────────────────────────────────────────────────────────

export const patientSchema = z.object({
  id: idSchema,
  fullName: shortText,
  birthDate: isoDateSchema.nullable(),
  sex: z.enum(SEXES),
  education: optionalShortText,
  handedness: z.enum(HANDEDNESS),
  guardian: optionalShortText,
  contact: optionalShortText,
  notes: longText,
  createdAt: timestampSchema,
  archivedAt: timestampSchema.nullable()
})
export type Patient = z.infer<typeof patientSchema>

export const patientInputSchema = patientSchema.omit({
  id: true,
  createdAt: true,
  archivedAt: true
})
export type PatientInput = z.infer<typeof patientInputSchema>

// ─── Função cognitiva (§4.3) ─────────────────────────────────────────────────

export const cognitiveFunctionSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  name: shortText,
  description: longText,
  order: z.number().int()
})
export type CognitiveFunction = z.infer<typeof cognitiveFunctionSchema>

export const cognitiveFunctionInputSchema = cognitiveFunctionSchema.omit({ id: true })
export type CognitiveFunctionInput = z.infer<typeof cognitiveFunctionInputSchema>

// ─── Instrumento / subteste (§4.4) ───────────────────────────────────────────

export const instrumentSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  name: shortText,
  acronym: optionalShortText,
  /** A associação à função cognitiva é feita no nó que produz escore. */
  cognitiveFunctionId: idSchema.nullable(),
  minAgeYears: z.number().int().min(0).max(120).nullable(),
  maxAgeYears: z.number().int().min(0).max(120).nullable(),
  reference: longText,
  order: z.number().int()
})
export type Instrument = z.infer<typeof instrumentSchema>

export const instrumentInputSchema = instrumentSchema
  .omit({ id: true })
  .refine(
    (v) => v.minAgeYears === null || v.maxAgeYears === null || v.minAgeYears <= v.maxAgeYears,
    { message: 'A idade mínima não pode ser maior que a máxima.', path: ['minAgeYears'] }
  )
export type InstrumentInput = z.infer<typeof instrumentInputSchema>

// ─── Faixa de classificação (§4.6) ───────────────────────────────────────────

export const classificationRangeSchema = z.object({
  id: idSchema,
  instrumentId: idSchema,
  scoreType: scoreTypeSchema,
  classificationName: shortText,
  minValue: z.number(),
  maxValue: z.number(),
  colorId: idSchema,
  /** Incrementa a cada edição do conjunto — rastreabilidade do snapshot (§4.8). */
  version: z.number().int().min(1)
})
export type ClassificationRange = z.infer<typeof classificationRangeSchema>

/** Faixa vinda da UI: sem id nem versão, que o serviço atribui. */
export const classificationRangeDraftSchema = z.object({
  classificationName: shortText,
  minValue: z.number(),
  maxValue: z.number(),
  colorId: idSchema
})
export type ClassificationRangeDraft = z.infer<typeof classificationRangeDraftSchema>

/** Faixa com a cor já resolvida — o que a UI e os relatórios consomem. */
export const classificationRangeWithColorSchema = classificationRangeSchema.extend({
  colorHex: hexColorSchema,
  colorName: shortText
})
export type ClassificationRangeWithColor = z.infer<typeof classificationRangeWithColorSchema>

// ─── Avaliação (§4.7) ────────────────────────────────────────────────────────

export const assessmentSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  date: isoDateSchema,
  referralReason: longText,
  complaint: longText,
  notes: longText,
  createdAt: timestampSchema,
  archivedAt: timestampSchema.nullable()
})
export type Assessment = z.infer<typeof assessmentSchema>

export const assessmentInputSchema = assessmentSchema.omit({
  id: true,
  createdAt: true,
  archivedAt: true
})
export type AssessmentInput = z.infer<typeof assessmentInputSchema>

// ─── Resultado (§4.8) ────────────────────────────────────────────────────────

export const assessmentResultSchema = z.object({
  id: idSchema,
  assessmentId: idSchema,
  instrumentId: idSchema,
  scoreType: scoreTypeSchema,
  value: z.number().nullable(),
  status: z.enum(RESULT_STATUSES),
  /** Snapshot imutável — ADR-004. Não reflete edições posteriores das faixas. */
  classificationName: optionalShortText,
  colorHex: hexColorSchema.nullable(),
  rangeId: idSchema.nullable(),
  rangeVersion: z.number().int().nullable(),
  manuallyOverridden: z.boolean(),
  notes: longText
})
export type AssessmentResult = z.infer<typeof assessmentResultSchema>

export const assessmentResultInputSchema = z
  .object({
    assessmentId: idSchema,
    instrumentId: idSchema,
    scoreType: scoreTypeSchema,
    value: z.number().nullable(),
    status: z.enum(RESULT_STATUSES),
    notes: longText,
    /** Sobrescrita manual da classificação; quando ausente, o sistema resolve. */
    override: z
      .object({ classificationName: shortText, colorHex: hexColorSchema })
      .nullable()
      .default(null)
  })
  .refine((v) => v.status !== 'applied' || v.value !== null, {
    message: 'Um resultado aplicado precisa de um valor.',
    path: ['value']
  })
export type AssessmentResultInput = z.infer<typeof assessmentResultInputSchema>

// ─── Arquivo (§8.2) ──────────────────────────────────────────────────────────

export const attachmentSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  assessmentId: idSchema.nullable(),
  originalName: z.string().trim().min(1).max(400),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  extension: z.string().max(16),
  detectedMime: z.string().max(160),
  sizeBytes: z.number().int().min(0),
  description: longText,
  tags: z.array(z.string().trim().min(1).max(60)).max(30),
  createdAt: timestampSchema,
  archivedAt: timestampSchema.nullable()
})
export type Attachment = z.infer<typeof attachmentSchema>

// ─── Documento e versão (§9.4) ───────────────────────────────────────────────

/**
 * Conteúdo do TipTap. Fica como `unknown` no contrato de propósito: quem valida
 * a forma do documento é o serializador com allowlist (§13.4), não o Zod — uma
 * validação estrutural aqui daria falsa sensação de segurança sobre um dado que
 * ainda assim precisa ser sanitizado antes de virar HTML.
 */
export const tiptapContentSchema = z.unknown()

export const documentSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  assessmentId: idSchema.nullable(),
  type: z.enum(DOCUMENT_TYPES),
  title: shortText,
  contentJson: tiptapContentSchema,
  status: z.enum(DOCUMENT_STATUSES),
  origin: z.enum(DOCUMENT_ORIGINS),
  /** Documento assistido por IA só finaliza após revisão explícita (§10.9). */
  reviewedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  finalizedAt: timestampSchema.nullable()
})
export type BaremoDocument = z.infer<typeof documentSchema>

export const documentVersionSchema = z.object({
  id: idSchema,
  documentId: idSchema,
  contentJson: tiptapContentSchema,
  /** `autosave` | `finalized` | `reopened` — por que o snapshot foi criado. */
  reason: z.enum(['autosave', 'finalized', 'reopened']),
  createdAt: timestampSchema
})
export type DocumentVersion = z.infer<typeof documentVersionSchema>

export const documentTemplateSchema = z.object({
  id: idSchema,
  type: z.enum(DOCUMENT_TYPES),
  name: shortText,
  contentJson: tiptapContentSchema,
  isSeed: z.boolean()
})
export type DocumentTemplate = z.infer<typeof documentTemplateSchema>

// ─── Auditoria (§4.12) ───────────────────────────────────────────────────────

export const auditLogSchema = z.object({
  id: idSchema,
  timestamp: timestampSchema,
  entity: z.string().max(60),
  entityId: z.string().max(80).nullable(),
  action: z.enum(AUDIT_ACTIONS),
  summary: z.string().max(1000)
})
export type AuditLog = z.infer<typeof auditLogSchema>
