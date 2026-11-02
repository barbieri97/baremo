/**
 * Adaptador da OpenAI — tradução entre os turnos neutros e a Responses API.
 * O SDK é trocado por um falso que só registra o pedido; as classes de erro são
 * as reais, herdadas do cliente.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as OpenAIModule from 'openai'

const sdk = vi.hoisted(() => ({
  requests: [] as { body: Record<string, unknown>; options: unknown }[],
  reply: null as unknown
}))

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenAIModule>()
  class FakeOpenAI extends actual.default {
    constructor(...args: ConstructorParameters<typeof actual.default>) {
      super(...args)
      Object.assign(this, {
        responses: {
          create: async (body: Record<string, unknown>, options: unknown): Promise<unknown> => {
            sdk.requests.push({ body: structuredClone(body), options })
            return sdk.reply
          }
        },
        models: { list: async (): Promise<unknown> => ({ data: [] }) }
      })
    }
  }
  return { ...actual, default: FakeOpenAI }
})

const { default: OpenAI } = await import('openai')
const { fromResponse, openaiProvider, toInput } = await import('../../src/main/ai/providers/openai')
const { toolDeclarations } = await import('../../src/main/ai/tools')

type Response = Parameters<typeof fromResponse>[0]

const response = (partial: Record<string, unknown>): Response =>
  ({
    id: 'resp_1',
    output: [],
    output_text: '',
    incomplete_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...partial
  }) as unknown as Response

const pdf = { kind: 'file' as const, mime: 'application/pdf', dataBase64: 'UERG' }

beforeEach(() => {
  sdk.requests.length = 0
  sdk.reply = response({ output_text: 'Ok.' })
})

describe('OpenAI — turnos', () => {
  it('resultado de tool vira function_call_output; com arquivo, o PDF vai junto', () => {
    expect(
      toInput([
        {
          role: 'tool',
          results: [
            {
              call: { id: 'call_1', name: 'ler_arquivo', args: {} },
              content: '<env/>',
              files: [pdf]
            },
            {
              call: { id: 'call_2', name: 'listar_avaliacoes', args: {} },
              content: 'ok',
              files: []
            }
          ]
        }
      ])
    ).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: [
          { type: 'input_text', text: '<env/>' },
          {
            type: 'input_file',
            file_data: 'data:application/pdf;base64,UERG',
            filename: 'anexo.pdf'
          }
        ]
      },
      { type: 'function_call_output', call_id: 'call_2', output: 'ok' }
    ])
  })

  it('reenvia os itens nativos (raciocínio cifrado e chamadas)', () => {
    const native = [
      { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'cifrado' },
      { type: 'function_call', call_id: 'call_1', name: 'x', arguments: '{}' }
    ]
    expect(toInput([{ role: 'model', text: '', toolCalls: [], native }])).toEqual(native)
  })

  it('histórico salvo (sem nativo) reconstrói texto do assistente e do usuário', () => {
    expect(
      toInput([
        { role: 'user', parts: [{ kind: 'text', text: 'Oi' }] },
        { role: 'model', text: 'Olá', toolCalls: [] }
      ])
    ).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'Oi' }] },
      { role: 'assistant', content: 'Olá' }
    ])
  })
})

describe('OpenAI — respostas', () => {
  it('lê chamadas de função, com os argumentos em JSON', () => {
    expect(
      fromResponse(
        response({
          output: [
            {
              type: 'function_call',
              call_id: 'call_7',
              name: 'listar_avaliacoes',
              arguments: '{"x":1}'
            }
          ]
        })
      )
    ).toMatchObject({
      stop: 'tool_calls',
      toolCalls: [{ id: 'call_7', name: 'listar_avaliacoes', args: { x: 1 } }],
      inputTokens: 10,
      outputTokens: 5
    })
  })

  it('argumento malformado vira objeto vazio, sem derrubar o turno', () => {
    const parsed = fromResponse(
      response({
        output: [{ type: 'function_call', call_id: 'c', name: 'ler_documento', arguments: '{' }]
      })
    )
    expect(parsed.toolCalls[0]?.args).toEqual({})
  })

  it('recusa (no conteúdo ou pelo filtro) vira stop = safety', () => {
    for (const refused of [
      response({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'não' }] }] }),
      response({ incomplete_details: { reason: 'content_filter' } })
    ]) {
      expect(fromResponse(refused).stop).toBe('safety')
    }
  })

  it('resposta cortada não executa chamada pela metade', () => {
    expect(
      fromResponse(
        response({
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'function_call', call_id: 'c', name: 'x', arguments: '{"a":' }]
        })
      )
    ).toMatchObject({ stop: 'truncated', toolCalls: [] })
  })
})

describe('OpenAI — pedido', () => {
  it('nunca guarda a conversa no servidor e pede o raciocínio cifrado', async () => {
    const signal = new AbortController().signal
    await openaiProvider.generate({
      apiKey: 'k',
      model: 'gpt-5.5',
      system: 'Instrução.',
      turns: [{ role: 'user', parts: [{ kind: 'text', text: 'Oi' }] }],
      tools: toolDeclarations(true),
      signal
    })

    const [{ body, options }] = sdk.requests as [(typeof sdk.requests)[number]]
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      instructions: 'Instrução.',
      store: false,
      include: ['reasoning.encrypted_content']
    })
    const tools = body['tools'] as { type: string; name: string; strict: boolean }[]
    expect(tools.every((tool) => tool.type === 'function' && tool.strict === false)).toBe(true)
    expect(tools.map((tool) => tool.name)).toContain('excluir_instrumento')
    expect(options).toEqual({ signal })
  })
})

describe('OpenAI — erros', () => {
  const error = (status: number, body: Record<string, unknown> = {}): unknown =>
    OpenAI.APIError.generate(status, body, `erro ${status}`, new Headers())

  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited']
  ])('%i → %s', (status, code) => {
    expect(openaiProvider.classifyError(error(status))?.code).toBe(code)
  })

  it('429 por falta de crédito diz que esperar não resolve', () => {
    expect(
      // O corpo real da API: `{ error: { code, message, … } }`.
      openaiProvider.classifyError(error(429, { error: { code: 'insufficient_quota' } }))?.message
    ).toMatch(/sem crédito/)
  })

  it('rede e erro desconhecido ficam para o orquestrador', () => {
    expect(openaiProvider.classifyError(new OpenAI.APIConnectionError({ message: 'x' }))).toBeNull()
    expect(openaiProvider.classifyError(error(500))).toBeNull()
  })
})
