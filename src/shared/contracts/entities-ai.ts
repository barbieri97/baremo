/**
 * Entidades do módulo de IA (spec §4.11, §10).
 *
 * Separadas das demais porque carregam uma regra própria: nada aqui pode
 * carregar a chave de API para fora do processo principal (§10.1, princípio 2).
 * Os schemas expostos ao renderer descrevem estado e metadados, nunca segredo.
 */

import { z } from 'zod'
import { idSchema, timestampSchema } from './entities'

/** Família do modelo: Flash para custo, Pro para raciocínio longo (§10.2). */
export const AI_MODELS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro-latest'
] as const
export type AiModel = (typeof AI_MODELS)[number]

export const AI_MODEL_LABELS: Readonly<Record<AiModel, string>> = {
  'gemini-flash-latest': 'Gemini Flash — mais rápido e barato',
  'gemini-flash-lite-latest': 'Gemini Flash Lite — custo mínimo',
  'gemini-pro-latest': 'Gemini Pro — raciocínio longo'
}

/**
 * Estado do módulo, do ponto de vista do renderer.
 * `hasKey` é booleano e `keyHint` traz só os quatro últimos caracteres (§10.2).
 */
export const aiConfigSchema = z.object({
  /** Desligado por padrão — §10.1, princípio 6. */
  enabled: z.boolean(),
  model: z.enum(AI_MODELS),
  hasKey: z.boolean(),
  keyHint: z.string().max(8).nullable(),
  /** `false` quando o usuário optou por digitar a chave a cada execução. */
  keyPersisted: z.boolean(),
  /** §10.2 — Linux sem keyring degrada para criptografia simbólica. */
  safeStorageAvailable: z.boolean(),
  /** Pseudonimização ligada por padrão — §10.3. */
  pseudonymize: z.boolean(),
  monthlyTokenBudget: z.number().int().min(0),
  tokensUsedThisMonth: z.number().int().min(0),
  budgetPeriod: z.string().max(7) // YYYY-MM
})
export type AiConfig = z.infer<typeof aiConfigSchema>

export const aiSessionSchema = z.object({
  id: idSchema,
  /** Imutável depois da criação — §10.1, princípio 3. */
  patientId: idSchema,
  title: z.string().trim().max(200),
  model: z.enum(AI_MODELS),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type AiSession = z.infer<typeof aiSessionSchema>

export const AI_MESSAGE_ROLES = ['user', 'model', 'tool', 'system'] as const
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number]

export const aiMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  role: z.enum(AI_MESSAGE_ROLES),
  text: z.string(),
  /** Preenchido quando a mensagem é o registro de uma chamada de tool. */
  toolName: z.string().max(80).nullable(),
  createdAt: timestampSchema
})
export type AiMessage = z.infer<typeof aiMessageSchema>

export const aiToolCallSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  messageId: idSchema.nullable(),
  toolName: z.string().max(80),
  argumentsJson: z.string(),
  status: z.enum(['executed', 'awaiting_confirmation', 'rejected', 'failed']),
  resultSummary: z.string().max(2000).nullable(),
  createdAt: timestampSchema
})
export type AiToolCall = z.infer<typeof aiToolCallSchema>

export const CONSENT_SCOPES = ['module', 'patient'] as const
export type ConsentScope = (typeof CONSENT_SCOPES)[number]

export const consentSchema = z.object({
  id: idSchema,
  scope: z.enum(CONSENT_SCOPES),
  /** `null` para o consentimento geral do módulo. */
  patientId: idSchema.nullable(),
  grantedAt: timestampSchema,
  /** Texto exato que o usuário viu — o consentimento precisa ser auditável. */
  consentTextVersion: z.string().max(40)
})
export type Consent = z.infer<typeof consentSchema>

export const aiAuditSchema = z.object({
  id: idSchema,
  timestamp: timestampSchema,
  sessionId: idSchema.nullable(),
  patientId: idSchema.nullable(),
  model: z.string().max(80),
  toolCallsJson: z.string(),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  pseudonymized: z.boolean(),
  blockedBySafetyFilter: z.boolean(),
  /** §10.5, camada 3 — uma revalidação de ID que falhou vira registro aqui. */
  idRevalidationFailed: z.boolean(),
  detail: z.string().max(4000).nullable()
})
export type AiAudit = z.infer<typeof aiAuditSchema>

// ─── Transporte do chat ──────────────────────────────────────────────────────

/** Eventos do canal de streaming, multiplexados por `requestId` (§10.4). */
export const aiStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delta'), requestId: z.string(), text: z.string() }),
  z.object({
    kind: z.literal('tool_start'),
    requestId: z.string(),
    toolName: z.string(),
    argumentsJson: z.string()
  }),
  z.object({
    kind: z.literal('tool_end'),
    requestId: z.string(),
    toolName: z.string(),
    ok: z.boolean(),
    summary: z.string()
  }),
  z.object({
    kind: z.literal('confirmation_required'),
    requestId: z.string(),
    confirmationId: z.string(),
    toolName: z.string(),
    /** Descrição legível do que será gravado, para o usuário decidir. */
    preview: z.string(),
    argumentsJson: z.string()
  }),
  z.object({
    kind: z.literal('done'),
    requestId: z.string(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int()
  }),
  z.object({
    kind: z.literal('error'),
    requestId: z.string(),
    code: z.enum([
      'invalid_key',
      'rate_limited',
      'offline',
      'safety_blocked',
      'truncated',
      'budget_exceeded',
      'cancelled',
      'unknown'
    ]),
    message: z.string()
  })
])
export type AiStreamEvent = z.infer<typeof aiStreamEventSchema>
