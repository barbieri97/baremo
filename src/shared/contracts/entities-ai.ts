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
  /** Mensagem do USUÁRIO que abriu o turno — agrupa as chamadas na conversa. */
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

// ─── Skills ──────────────────────────────────────────────────────────────────

/**
 * Nome de skill: slug, porque vira o comando `/nome` no chat e o atributo do
 * envelope `<skill nome="...">` — sem espaço, aspas nem sinais de tag.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 300
export const SKILL_CONTENT_MAX = 20_000

export const AI_SKILL_ORIGINS = ['user', 'agent'] as const
export type AiSkillOrigin = (typeof AI_SKILL_ORIGINS)[number]

/**
 * O que define uma skill. O MESMO schema valida o IPC das configurações e a
 * tool `criar_skill` do agente — os limites não podem divergir entre os dois.
 */
export const aiSkillInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome da skill.')
    .max(SKILL_NAME_MAX, `O nome pode ter no máximo ${SKILL_NAME_MAX} caracteres.`)
    .regex(
      SKILL_NAME_PATTERN,
      'O nome deve ter apenas letras minúsculas sem acento, números e hífens (ex.: devolutiva-escolar).'
    ),
  /** É por ela que o agente decide quando carregar a skill. */
  description: z
    .string()
    .trim()
    .min(1, 'Informe uma descrição de quando usar a skill.')
    .max(
      SKILL_DESCRIPTION_MAX,
      `A descrição pode ter no máximo ${SKILL_DESCRIPTION_MAX} caracteres.`
    ),
  content: z
    .string()
    .trim()
    .min(1, 'Informe o conteúdo da skill.')
    .max(
      SKILL_CONTENT_MAX,
      `O conteúdo pode ter no máximo ${SKILL_CONTENT_MAX.toLocaleString('pt-BR')} caracteres.`
    )
})
export type AiSkillInput = z.infer<typeof aiSkillInputSchema>

export const aiSkillSchema = aiSkillInputSchema.extend({
  id: idSchema,
  enabled: z.boolean(),
  origin: z.enum(AI_SKILL_ORIGINS),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type AiSkill = z.infer<typeof aiSkillSchema>

// ─── Transporte do chat ──────────────────────────────────────────────────────

/**
 * Uma linha da proposta de `registrar_resultados`, como o diálogo de confirmação
 * a mostra. Calculada no processo principal, com as mesmas validações e a mesma
 * classificação do formulário — o renderer só devolve os índices aceitos.
 */
export const aiResultImportRowSchema = z.object({
  index: z.number().int(),
  instrumentId: z.string().nullable(),
  instrumentName: z.string(),
  scoreType: z.string(),
  value: z.number().nullable(),
  classificationName: z.string().nullable(),
  colorHex: z.string().nullable(),
  /** `overwrite` substitui um resultado já gravado; `invalid` não pode ser aceita. */
  status: z.enum(['new', 'overwrite', 'invalid']),
  existingValue: z.number().nullable(),
  existingClassification: z.string().nullable(),
  /** Motivo de uma linha `invalid`. */
  error: z.string().nullable(),
  /** Alerta que não impede a gravação, como uma classificação manual que será perdida. */
  warning: z.string().nullable()
})
export type AiResultImportRow = z.infer<typeof aiResultImportRowSchema>

/** Eventos do canal de streaming, multiplexados por `requestId` (§10.4). */
export const aiStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delta'), requestId: z.string(), text: z.string() }),
  z.object({
    kind: z.literal('tool_start'),
    requestId: z.string(),
    /** Pareia início e fim da mesma chamada; é também o id em `ai_tool_calls`. */
    callId: z.string(),
    toolName: z.string(),
    argumentsJson: z.string()
  }),
  z.object({
    kind: z.literal('tool_end'),
    requestId: z.string(),
    callId: z.string(),
    toolName: z.string(),
    ok: z.boolean(),
    /** Gravação recusada pelo profissional — não é falha, mas também não gravou. */
    rejected: z.boolean(),
    summary: z.string()
  }),
  z.object({
    kind: z.literal('confirmation_required'),
    requestId: z.string(),
    confirmationId: z.string(),
    toolName: z.string(),
    /** Descrição legível do que será gravado, para o usuário decidir. */
    preview: z.string(),
    argumentsJson: z.string(),
    /**
     * Diff por bloco, quando a tool propõe editar um documento existente
     * (§10.6). O usuário aceita ou rejeita bloco a bloco — a unidade que ele
     * revisa e assina é o parágrafo, não o documento inteiro.
     */
    blockDiff: z
      .array(
        z.object({
          index: z.number().int(),
          kind: z.enum(['keep', 'insert', 'delete', 'replace']),
          before: z.string().nullable(),
          after: z.string().nullable()
        })
      )
      .nullable(),
    /**
     * Tabela de resultados, quando a tool propõe registrar escores. O usuário
     * aceita linha a linha; os índices voltam em `acceptedBlocks`.
     */
    resultPreview: z.array(aiResultImportRowSchema).nullable(),
    /**
     * Skill proposta por `criar_skill`, com o conteúdo COMPLETO: ela passa a
     * valer em todas as conversas, então o profissional precisa ler o que aprova.
     */
    skillPreview: z
      .object({ name: z.string(), description: z.string(), content: z.string() })
      .nullable()
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
