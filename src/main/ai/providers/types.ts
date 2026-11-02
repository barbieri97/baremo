/**
 * Contrato entre o orquestrador e um provedor de modelo (Gemini, Claude, …).
 *
 * O orquestrador fala só esta língua: turnos neutros, ferramentas em JSON
 * Schema e uma resposta já classificada (texto, chamadas de tool, motivo de
 * parada). Cada adaptador traduz para o SDK da sua empresa e de volta.
 *
 * O que NÃO entra aqui, de propósito: escopo por paciente, envelopes do §10.7,
 * confirmação de escrita. Isso é do orquestrador e vale igual para qualquer
 * provedor — trocar de empresa não pode afrouxar nenhuma dessas regras.
 */

import type { AiStreamEvent } from '@shared/contracts/entities-ai'

/** Subconjunto de JSON Schema que os provedores aceitam nas declarações. */
export interface ToolSchema {
  readonly type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  readonly description?: string
  readonly properties?: Readonly<Record<string, ToolSchema>>
  readonly items?: ToolSchema
  readonly required?: readonly string[]
}

export interface ToolDeclaration {
  readonly name: string
  readonly description: string
  readonly parameters: ToolSchema
}

/** Arquivo enviado ao modelo como bytes (PDF, imagem), sem extração de texto. */
export interface FilePart {
  readonly kind: 'file'
  readonly mime: string
  readonly dataBase64: string
}

export type UserPart = { readonly kind: 'text'; readonly text: string } | FilePart

export interface ToolCall {
  /** ID do provedor, quando ele dá um; o adaptador usa para parear a resposta. */
  readonly id: string | null
  readonly name: string
  readonly args: Record<string, unknown>
}

export interface ToolResult {
  readonly call: ToolCall
  /** Já envelopado (§10.7) pelo orquestrador. */
  readonly content: string
  /** Bytes que acompanham o resultado — hoje, só o arquivo de `ler_arquivo`. */
  readonly files: readonly FilePart[]
}

export type ChatTurn =
  | { readonly role: 'user'; readonly parts: UserPart[] }
  | {
      readonly role: 'model'
      readonly text: string
      readonly toolCalls: readonly ToolCall[]
      /**
       * Conteúdo nativo do provedor, devolvido tal como veio. O Gemini exige as
       * assinaturas de raciocínio de volta no turno seguinte; reconstruir a
       * partir de `text` e `toolCalls` as perderia.
       */
      readonly native?: unknown
    }
  | { readonly role: 'tool'; readonly results: readonly ToolResult[] }

export interface GenerateRequest {
  readonly apiKey: string
  readonly model: string
  readonly system: string
  readonly turns: readonly ChatTurn[]
  readonly tools: readonly ToolDeclaration[]
  readonly signal: AbortSignal
}

export type StopReason = 'end' | 'tool_calls' | 'truncated' | 'safety'

export interface GenerateResponse {
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
  readonly stop: StopReason
  /** Explicação para o profissional quando `stop === 'safety'`. */
  readonly safetyMessage: string | null
  readonly inputTokens: number
  readonly outputTokens: number
  /** Repassado no turno `model` seguinte; ver `ChatTurn`. */
  readonly native?: unknown
}

export type AiErrorCode = Extract<AiStreamEvent, { kind: 'error' }>['code']

export interface AiProvider {
  readonly id: string
  /** Nome da empresa, para mensagens ao usuário. */
  readonly label: string
  /** Teto do envio inline de arquivo, em bytes. */
  readonly maxInlineFileBytes: number
  /** Tipos que o modelo lê direto dos bytes. */
  acceptsFile(mime: string): boolean

  generate(request: GenerateRequest): Promise<GenerateResponse>

  /** Chamada mínima para validar a chave; lança no formato do SDK em falha. */
  testKey(apiKey: string): Promise<void>

  /**
   * Traduz um erro do SDK para os códigos do app, ou `null` quando não sabe —
   * o orquestrador cuida dos casos genéricos (cancelamento, rede).
   */
  classifyError(error: unknown): { code: AiErrorCode; message: string } | null
}
