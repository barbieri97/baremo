/**
 * Adaptador da OpenAI, sobre a Responses API do pacote `openai`.
 *
 * O loop de tools continua sendo o do orquestrador (ADR-006). Escolhas deste
 * adaptador:
 *
 * - `store: false`: por padrão a OpenAI guarda as respostas no servidor. Com
 *   dado clínico, não. Sem o armazenamento, o raciocínio do modelo só pode
 *   voltar no turno seguinte se vier cifrado — daí o
 *   `include: ['reasoning.encrypted_content']`, e os itens da resposta voltam
 *   intactos (`native`).
 * - PDFs e imagens vão como bytes (`input_file`/`input_image`) dentro do próprio
 *   resultado da tool que os pediu.
 */

import OpenAI from 'openai'
import type {
  FunctionTool,
  Response,
  ResponseFunctionCallOutputItem,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseInputContent
} from 'openai/resources/responses/responses'
import type {
  AiProvider,
  ChatTurn,
  FilePart,
  GenerateRequest,
  GenerateResponse,
  ToolCall
} from './types'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function dataUrl(file: FilePart): string {
  return `data:${file.mime};base64,${file.dataBase64}`
}

function fileContent(file: FilePart): ResponseInputContent & ResponseFunctionCallOutputItem {
  return IMAGE_TYPES.includes(file.mime)
    ? { type: 'input_image', image_url: dataUrl(file), detail: 'auto' }
    : { type: 'input_file', file_data: dataUrl(file), filename: 'anexo.pdf' }
}

export function toInput(turns: readonly ChatTurn[]): ResponseInputItem[] {
  return turns.flatMap((turn): ResponseInputItem[] => {
    switch (turn.role) {
      case 'user':
        return [
          {
            role: 'user',
            content: turn.parts.map((part): ResponseInputContent =>
              part.kind === 'text' ? { type: 'input_text', text: part.text } : fileContent(part)
            )
          }
        ]

      case 'model':
        // Itens nativos: inclui o raciocínio cifrado e as chamadas de função.
        if (turn.native !== undefined) return turn.native as ResponseInputItem[]
        return [
          ...(turn.text.length > 0 ? [{ role: 'assistant' as const, content: turn.text }] : []),
          ...turn.toolCalls.map((call): ResponseInputItem => ({
            type: 'function_call',
            call_id: call.id ?? call.name,
            name: call.name,
            arguments: JSON.stringify(call.args)
          }))
        ]

      case 'tool':
        return turn.results.map((result): ResponseInputItem => ({
          type: 'function_call_output',
          call_id: result.call.id ?? result.call.name,
          output:
            result.files.length === 0
              ? result.content
              : [{ type: 'input_text', text: result.content }, ...result.files.map(fileContent)]
        }))
    }
  })
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Argumento malformado vira objeto vazio: a tool recusa por falta de
    // parâmetro e o erro volta ao modelo, como qualquer outro.
    return {}
  }
}

const REFUSAL_MESSAGE =
  'A resposta foi recusada pelo filtro de segurança do provedor. ' +
  'Isso é comum em conteúdo clínico sensível e não indica falha do aplicativo. ' +
  'Tente reformular a pergunta de forma mais técnica e delimitada.'

export function fromResponse(response: Response): GenerateResponse {
  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  const native = response.output

  const refused =
    response.incomplete_details?.reason === 'content_filter' ||
    response.output.some(
      (item) =>
        item.type === 'message' && item.content.some((content) => content.type === 'refusal')
    )

  if (refused) {
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

  const truncated = response.incomplete_details?.reason === 'max_output_tokens'

  const toolCalls: ToolCall[] = truncated
    ? []
    : response.output
        .filter((item): item is ResponseFunctionToolCall => item.type === 'function_call')
        .map((item) => ({
          id: item.call_id,
          name: item.name,
          args: parseArguments(item.arguments)
        }))

  return {
    text: response.output_text,
    toolCalls,
    stop: toolCalls.length > 0 ? 'tool_calls' : truncated ? 'truncated' : 'end',
    safetyMessage: null,
    inputTokens,
    outputTokens,
    native
  }
}

export const openaiProvider: AiProvider = {
  id: 'openai',
  label: 'OpenAI',
  maxInlineFileBytes: 20 * 1024 * 1024,

  acceptsFile(mime) {
    return mime === 'application/pdf' || IMAGE_TYPES.includes(mime)
  },

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const client = new OpenAI({ apiKey: request.apiKey })

    const response = await client.responses.create(
      {
        model: request.model,
        instructions: request.system,
        input: toInput(request.turns),
        tools: request.tools.map((tool): FunctionTool => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as unknown as Record<string, unknown>,
          // O modo estrito exige todo parâmetro como obrigatório; as tools
          // do app têm opcionais, e os argumentos são revalidados de todo jeito.
          strict: false
        })),
        store: false,
        include: ['reasoning.encrypted_content']
      },
      { signal: request.signal }
    )

    return fromResponse(response)
  },

  async testKey(apiKey) {
    // Listar modelos valida a chave sem gastar tokens.
    await new OpenAI({ apiKey }).models.list()
  },

  classifyError(error) {
    if (error instanceof OpenAI.AuthenticationError) {
      return {
        code: 'invalid_key',
        message:
          'A chave de API foi recusada pela OpenAI (401). Verifique se ela está correta e ativa na OpenAI Platform.'
      }
    }
    if (error instanceof OpenAI.PermissionDeniedError) {
      return {
        code: 'invalid_key',
        message:
          'A chave da OpenAI não tem permissão para este modelo (403). Confira o projeto da chave na OpenAI Platform.'
      }
    }
    if (error instanceof OpenAI.RateLimitError) {
      // O 429 da OpenAI também chega quando acaba o crédito da conta — e aí
      // esperar não resolve.
      return error.code === 'insufficient_quota'
        ? {
            code: 'rate_limited',
            message:
              'A conta da OpenAI ficou sem crédito (429, insufficient_quota). Adicione crédito na OpenAI Platform para continuar.'
          }
        : {
            code: 'rate_limited',
            message:
              'A OpenAI limitou as requisições desta chave (429). Aguarde alguns instantes e tente de novo.'
          }
    }
    return null
  }
}
