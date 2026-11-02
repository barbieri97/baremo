/**
 * Adaptador do Google Gemini (`@google/genai`).
 *
 * O único arquivo do app que conhece o SDK do Google. A chamada automática de
 * funções fica desligada (ADR-006): quem executa as tools é o loop manual do
 * orquestrador, o único ponto onde o escopo por paciente é garantido.
 */

import { GoogleGenAI, Type } from '@google/genai'
import type { Content, GenerateContentResponse, Part, Schema } from '@google/genai'
import { describeRateLimit, parseRateLimit } from '../rate-limit'
import type {
  AiProvider,
  ChatTurn,
  GenerateRequest,
  GenerateResponse,
  ToolCall,
  ToolSchema
} from './types'

const SCHEMA_TYPES: Record<ToolSchema['type'], Type> = {
  object: Type.OBJECT,
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY
}

export function toGeminiSchema(schema: ToolSchema): Schema {
  return {
    type: SCHEMA_TYPES[schema.type],
    ...(schema.description === undefined ? {} : { description: schema.description }),
    ...(schema.properties === undefined
      ? {}
      : {
          properties: Object.fromEntries(
            Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)])
          )
        }),
    ...(schema.items === undefined ? {} : { items: toGeminiSchema(schema.items) }),
    ...(schema.required === undefined ? {} : { required: [...schema.required] })
  }
}

export function toContents(turns: readonly ChatTurn[]): Content[] {
  return turns.map((turn): Content => {
    switch (turn.role) {
      case 'user':
        return {
          role: 'user',
          parts: turn.parts.map((part): Part =>
            part.kind === 'text'
              ? { text: part.text }
              : { inlineData: { mimeType: part.mime, data: part.dataBase64 } }
          )
        }

      case 'model':
        // As partes nativas carregam as assinaturas de raciocínio do Gemini.
        if (turn.native !== undefined) return { role: 'model', parts: turn.native as Part[] }
        return {
          role: 'model',
          parts: [
            ...(turn.text.length > 0 ? [{ text: turn.text }] : []),
            ...turn.toolCalls.map((call): Part => ({
              functionCall: {
                name: call.name,
                args: call.args,
                ...(call.id === null ? {} : { id: call.id })
              }
            }))
          ]
        }

      case 'tool':
        // Respostas de função vão num turno `user`; o arquivo de `ler_arquivo`
        // segue logo depois da resposta da tool que o pediu.
        return {
          role: 'user',
          parts: turn.results.flatMap((result): Part[] => [
            {
              functionResponse: {
                name: result.call.name,
                ...(result.call.id === null ? {} : { id: result.call.id }),
                response: { conteudo: result.content }
              }
            },
            ...result.files.map((file): Part => ({
              inlineData: { mimeType: file.mime, data: file.dataBase64 }
            }))
          ])
        }
    }
  })
}

function safetyBlock(response: GenerateContentResponse): string | null {
  const promptBlock = response.promptFeedback?.blockReason
  if (promptBlock) {
    return (
      'A pergunta foi bloqueada pelo filtro de segurança do provedor antes de ser processada. ' +
      'Em contexto clínico isso acontece com frequência em relatos de ideação suicida, violência ou abuso. ' +
      'O aplicativo funcionou corretamente; foi o provedor que recusou o conteúdo.'
    )
  }

  const finishReason = response.candidates?.[0]?.finishReason
  if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
    return (
      'A resposta foi bloqueada pelo filtro de segurança do provedor. ' +
      'Isso é comum em conteúdo clínico sensível e não indica falha do aplicativo. ' +
      'Tente reformular a pergunta de forma mais técnica e delimitada.'
    )
  }

  return null
}

export function fromResponse(response: GenerateContentResponse): GenerateResponse {
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
  const native = response.candidates?.[0]?.content?.parts ?? []

  const blocked = safetyBlock(response)
  if (blocked !== null) {
    return {
      text: '',
      toolCalls: [],
      stop: 'safety',
      safetyMessage: blocked,
      inputTokens,
      outputTokens,
      native
    }
  }

  const toolCalls: ToolCall[] = (response.functionCalls ?? []).map((call) => ({
    id: call.id ?? null,
    name: call.name ?? '',
    args: (call.args ?? {}) as Record<string, unknown>
  }))

  return {
    text: response.text ?? '',
    toolCalls,
    stop:
      toolCalls.length > 0
        ? 'tool_calls'
        : response.candidates?.[0]?.finishReason === 'MAX_TOKENS'
          ? 'truncated'
          : 'end',
    safetyMessage: null,
    inputTokens,
    outputTokens,
    native
  }
}

const INVALID_KEY = /\b401\b|API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i

export const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  maxInlineFileBytes: 15 * 1024 * 1024,

  acceptsFile(mime) {
    return /^(application\/pdf|image\/)/.test(mime)
  },

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = new GoogleGenAI({ apiKey: request.apiKey })
    const response = await client.models.generateContent({
      model: request.model,
      contents: toContents(request.turns),
      config: {
        systemInstruction: request.system,
        tools: [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: toGeminiSchema(tool.parameters)
            }))
          }
        ],
        // ADR-006 — o loop é nosso.
        automaticFunctionCalling: { disable: true },
        abortSignal: request.signal
      }
    })
    return fromResponse(response)
  },

  async testKey(apiKey) {
    const client = new GoogleGenAI({ apiKey })
    await client.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: 'ok',
      config: { maxOutputTokens: 1, automaticFunctionCalling: { disable: true } }
    })
  },

  classifyError(error) {
    const raw = error instanceof Error ? error.message : String(error)

    if (INVALID_KEY.test(raw)) {
      return {
        code: 'invalid_key',
        message:
          'A chave de API foi recusada pelo provedor (401). Verifique se ela está correta e ativa no projeto do Google AI Studio.'
      }
    }

    if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
      // O 429 do Gemini diz qual limite estourou (por minuto, por dia, por
      // modelo) — repassar isso é o que separa "espere 30 s" de "troque o modelo".
      return { code: 'rate_limited', message: describeRateLimit(parseRateLimit(raw)) }
    }

    return null
  }
}
