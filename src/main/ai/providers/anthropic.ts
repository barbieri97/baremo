/**
 * Adaptador da Anthropic (Claude), sobre `@anthropic-ai/sdk`.
 *
 * O loop de tools continua sendo o do orquestrador (ADR-006): aqui só se monta
 * o pedido e se lê a resposta. Escolhas deste adaptador:
 *
 * - Raciocínio no padrão adaptativo de cada modelo — os três oferecidos o
 *   ligam sozinhos, e enviar `thinking: disabled` é recusado pela API.
 * - Os blocos da resposta voltam INTACTOS no turno seguinte (`native`), como a
 *   API exige para os blocos de raciocínio.
 * - Fallback do lado do servidor (`fallbacks: "default"`) no Opus e no Sonnet:
 *   conteúdo clínico sensível dispara recusas de filtro com certa frequência, e
 *   a API refaz o pedido num modelo alternativo dentro da mesma chamada.
 * - Cache de prompt automático: o loop reenvia o mesmo prefixo (instrução de
 *   sistema, tools, histórico) a cada iteração.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaRequestDocumentBlock,
  BetaTool,
  BetaToolResultBlockParam
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type {
  AiProvider,
  ChatTurn,
  FilePart,
  GenerateRequest,
  GenerateResponse,
  ToolCall,
  ToolSchema
} from './types'

/** Modelos com fallback do lado do servidor na API da Anthropic. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

/** Teto por resposta. Sem streaming, valores maiores esbarram no timeout HTTP. */
const MAX_TOKENS = 16_000

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

function toInputSchema(schema: ToolSchema): BetaTool['input_schema'] {
  return {
    type: 'object',
    properties: schema.properties ?? {},
    ...(schema.required === undefined ? {} : { required: [...schema.required] })
  }
}

function filePart(file: FilePart): BetaImageBlockParam | BetaRequestDocumentBlock {
  if ((IMAGE_TYPES as readonly string[]).includes(file.mime)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: file.mime as ImageType, data: file.dataBase64 }
    }
  }
  return {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: file.dataBase64 }
  }
}

export function toMessages(turns: readonly ChatTurn[]): BetaMessageParam[] {
  const messages = turns.map((turn): BetaMessageParam => {
    switch (turn.role) {
      case 'user':
        return {
          role: 'user',
          // Arquivos antes do texto, como a API recomenda para documentos.
          content: [
            ...turn.parts.filter((part) => part.kind === 'file').map(filePart),
            ...turn.parts.flatMap((part): BetaContentBlockParam[] =>
              part.kind === 'text' && part.text.length > 0
                ? [{ type: 'text', text: part.text }]
                : []
            )
          ]
        }

      case 'model':
        if (turn.native !== undefined) {
          return { role: 'assistant', content: turn.native as BetaContentBlockParam[] }
        }
        return {
          role: 'assistant',
          content: [
            ...(turn.text.length > 0 ? [{ type: 'text' as const, text: turn.text }] : []),
            ...turn.toolCalls.map((call): BetaContentBlockParam => ({
              type: 'tool_use',
              id: call.id ?? call.name,
              name: call.name,
              input: call.args
            }))
          ]
        }

      case 'tool':
        // Todos os resultados numa única mensagem — dividir ensina o modelo a
        // parar de pedir tools em paralelo. O PDF de `ler_arquivo` vai dentro do
        // próprio resultado.
        return {
          role: 'user',
          content: turn.results.map((result): BetaToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: result.call.id ?? result.call.name,
            content: [{ type: 'text', text: result.content }, ...result.files.map(filePart)]
          }))
        }
    }
  })

  // A conversa precisa começar pelo usuário; o histórico truncado pode não começar.
  while (messages[0]?.role === 'assistant') messages.shift()
  return messages.filter((message) => (message.content as unknown[]).length > 0)
}

const REFUSAL_MESSAGE =
  'A resposta foi recusada pelo filtro de segurança do provedor. ' +
  'Isso é comum em conteúdo clínico sensível e não indica falha do aplicativo. ' +
  'Tente reformular a pergunta de forma mais técnica e delimitada.'

export function fromMessage(message: BetaMessage): GenerateResponse {
  const usage = message.usage
  const inputTokens =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  const outputTokens = usage.output_tokens
  const native = message.content

  if (message.stop_reason === 'refusal') {
    return {
      text: '',
      toolCalls: [],
      stop: 'safety',
      safetyMessage: REFUSAL_MESSAGE,
      inputTokens,
      outputTokens,
      native
    }
  }

  const text = message.content
    .filter((block): block is Extract<BetaContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')

  const truncated =
    message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded'

  // Resposta cortada no meio de uma chamada traz argumentos incompletos: nada
  // é executado, e o profissional fica sabendo do corte.
  const toolCalls: ToolCall[] = truncated
    ? []
    : message.content
        .filter(
          (block): block is Extract<BetaContentBlock, { type: 'tool_use' }> =>
            block.type === 'tool_use'
        )
        .map((block) => ({
          id: block.id,
          name: block.name,
          args:
            block.input !== null && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : {}
        }))

  return {
    text,
    toolCalls,
    stop: toolCalls.length > 0 ? 'tool_calls' : truncated ? 'truncated' : 'end',
    safetyMessage: null,
    inputTokens,
    outputTokens,
    native
  }
}

function retryAfter(error: InstanceType<typeof Anthropic.APIError>): string {
  const seconds = Number(error.headers?.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0
    ? ` Tente de novo em cerca de ${Math.ceil(seconds)} s.`
    : ' Aguarde alguns instantes e tente de novo.'
}

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  // Base64 cresce ~4/3; o pedido inteiro tem teto de 32 MB.
  maxInlineFileBytes: 20 * 1024 * 1024,

  acceptsFile(mime) {
    return mime === 'application/pdf' || (IMAGE_TYPES as readonly string[]).includes(mime)
  },

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = new Anthropic({ apiKey: request.apiKey })
    const fallback = FALLBACK_MODELS.has(request.model)

    const message = await client.beta.messages.create(
      {
        model: request.model,
        max_tokens: MAX_TOKENS,
        system: request.system,
        messages: toMessages(request.turns),
        tools: request.tools.map((tool): BetaTool => ({
          name: tool.name,
          description: tool.description,
          input_schema: toInputSchema(tool.parameters)
        })),
        cache_control: { type: 'ephemeral' },
        ...(fallback
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {})
      },
      { signal: request.signal }
    )

    return fromMessage(message)
  },

  async testKey(apiKey) {
    // Listar modelos valida a chave sem gastar tokens.
    await new Anthropic({ apiKey }).models.list({ limit: 1 })
  },

  classifyError(error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return {
        code: 'invalid_key',
        message:
          'A chave de API foi recusada pela Anthropic (401). Verifique se ela está correta e ativa no Claude Console.'
      }
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return {
        code: 'invalid_key',
        message:
          'A chave da Anthropic não tem permissão para este modelo (403). Confira o workspace da chave no Claude Console.'
      }
    }
    if (error instanceof Anthropic.RateLimitError) {
      return {
        code: 'rate_limited',
        message: `A Anthropic limitou as requisições desta chave (429).${retryAfter(error)}`
      }
    }
    // Conexão vem antes de APIError: no SDK de TypeScript ela é uma subclasse.
    if (error instanceof Anthropic.APIConnectionError) return null
    if (error instanceof Anthropic.APIError && error.status === 529) {
      return {
        code: 'rate_limited',
        message: 'A Anthropic está sobrecarregada no momento (529). Tente de novo em instantes.'
      }
    }
    return null
  }
}
