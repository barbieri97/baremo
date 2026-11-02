/**
 * Adaptador da Anthropic — tradução entre os turnos neutros e a Messages API.
 * O SDK é trocado por um falso que só registra o pedido; as classes de erro são
 * as reais, porque a classificação depende delas.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AnthropicModule from '@anthropic-ai/sdk'

const sdk = vi.hoisted(() => ({
  requests: [] as { body: Record<string, unknown>; options: unknown }[],
  reply: null as unknown
}))

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof AnthropicModule>()
  // Herda do cliente real: as classes de erro (`Anthropic.RateLimitError`…) são
  // estáticas da classe-pai, e o `instanceof` do adaptador depende delas.
  class FakeAnthropic extends actual.default {
    constructor(...args: ConstructorParameters<typeof actual.default>) {
      super(...args)
      Object.assign(this, {
        beta: {
          messages: {
            create: async (body: Record<string, unknown>, options: unknown): Promise<unknown> => {
              sdk.requests.push({ body: structuredClone(body), options })
              return sdk.reply
            }
          }
        },
        models: { list: async (): Promise<unknown> => ({ data: [] }) }
      })
    }
  }
  return { ...actual, default: FakeAnthropic }
})

const { default: Anthropic } = await import('@anthropic-ai/sdk')
const { anthropicProvider, fromMessage, toMessages } =
  await import('../../src/main/ai/providers/anthropic')
const { toolDeclarations } = await import('../../src/main/ai/tools')

type Message = Parameters<typeof fromMessage>[0]

const message = (partial: Record<string, unknown>): Message =>
  ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [],
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...partial
  }) as unknown as Message

const pdf = { kind: 'file' as const, mime: 'application/pdf', dataBase64: 'UERG' }
const png = { kind: 'file' as const, mime: 'image/png', dataBase64: 'UE5H' }

beforeEach(() => {
  sdk.requests.length = 0
  sdk.reply = message({ content: [{ type: 'text', text: 'Ok.' }] })
})

describe('Anthropic — turnos', () => {
  it('resultados de tool vão juntos numa mensagem, com o arquivo dentro do resultado', () => {
    const [turn] = toMessages([
      {
        role: 'tool',
        results: [
          { call: { id: 'tu_1', name: 'ler_arquivo', args: {} }, content: '<env/>', files: [pdf] },
          { call: { id: 'tu_2', name: 'listar_avaliacoes', args: {} }, content: 'ok', files: [] }
        ]
      }
    ])

    expect(turn).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: [
            { type: 'text', text: '<env/>' },
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' }
            }
          ]
        },
        { type: 'tool_result', tool_use_id: 'tu_2', content: [{ type: 'text', text: 'ok' }] }
      ]
    })
  })

  it('imagem vira bloco image, e arquivos vêm antes do texto do usuário', () => {
    expect(toMessages([{ role: 'user', parts: [{ kind: 'text', text: 'Veja' }, png] }])).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'UE5H' } },
          { type: 'text', text: 'Veja' }
        ]
      }
    ])
  })

  it('reenvia os blocos nativos (raciocínio) e descarta turno do modelo no início', () => {
    const native = [{ type: 'thinking', thinking: '', signature: 'sig' }]
    expect(
      toMessages([
        { role: 'model', text: 'sobra do histórico truncado', toolCalls: [] },
        { role: 'user', parts: [{ kind: 'text', text: 'Oi' }] },
        { role: 'model', text: '', toolCalls: [], native }
      ])
    ).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Oi' }] },
      { role: 'assistant', content: native }
    ])
  })
})

describe('Anthropic — respostas', () => {
  it('lê texto, chamadas de tool e tokens (inclusive os do cache)', () => {
    const parsed = fromMessage(
      message({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Vou consultar.' },
          { type: 'tool_use', id: 'tu_9', name: 'listar_avaliacoes', input: { x: 1 } }
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 1000
        }
      })
    )
    expect(parsed).toMatchObject({
      text: 'Vou consultar.',
      stop: 'tool_calls',
      toolCalls: [{ id: 'tu_9', name: 'listar_avaliacoes', args: { x: 1 } }],
      inputTokens: 1110,
      outputTokens: 5
    })
  })

  it('recusa do filtro vira stop = safety', () => {
    expect(fromMessage(message({ stop_reason: 'refusal' }))).toMatchObject({
      stop: 'safety',
      safetyMessage: expect.stringMatching(/filtro de segurança/)
    })
  })

  it('resposta cortada não executa a chamada de tool pela metade', () => {
    const parsed = fromMessage(
      message({
        stop_reason: 'max_tokens',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'criar_rascunho_documento', input: {} }]
      })
    )
    expect(parsed).toMatchObject({ stop: 'truncated', toolCalls: [] })
  })
})

describe('Anthropic — pedido', () => {
  const request = (model: string): Parameters<typeof anthropicProvider.generate>[0] => ({
    apiKey: 'k',
    model,
    system: 'Instrução.',
    turns: [{ role: 'user', parts: [{ kind: 'text', text: 'Oi' }] }],
    tools: toolDeclarations(true),
    signal: new AbortController().signal
  })

  it('Opus e Sonnet pedem fallback do servidor; o Haiku, que não tem, não', async () => {
    await anthropicProvider.generate(request('claude-opus-5-5'))
    await anthropicProvider.generate(request('claude-sonnet-5-5'))
    await anthropicProvider.generate(request('claude-haiku-5-5'))

    const [opus, sonnet, haiku] = sdk.requests.map((entry) => entry.body)
    for (const body of [opus, sonnet]) {
      expect(body).toMatchObject({
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default'
      })
    }
    expect(haiku).not.toHaveProperty('fallbacks')
    expect(haiku).not.toHaveProperty('betas')
  })

  it('envia instrução, tools em JSON Schema, cache e o sinal de cancelamento', async () => {
    const signal = new AbortController().signal
    await anthropicProvider.generate({ ...request('claude-opus-5-5'), signal })

    const [{ body, options }] = sdk.requests as [(typeof sdk.requests)[number]]
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'Instrução.',
      cache_control: { type: 'ephemeral' }
    })
    expect(body).not.toHaveProperty('thinking')
    const tools = body['tools'] as { name: string; input_schema: { type: string } }[]
    expect(tools.map((tool) => tool.name)).toContain('criar_instrumento')
    expect(tools.every((tool) => tool.input_schema.type === 'object')).toBe(true)
    expect(options).toEqual({ signal })
  })
})

describe('Anthropic — erros', () => {
  const error = (status: number): unknown =>
    Anthropic.APIError.generate(status, { type: 'error' }, `erro ${status}`, new Headers())

  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited'],
    [529, 'rate_limited']
  ])('%i → %s', (status, code) => {
    expect(anthropicProvider.classifyError(error(status))?.code).toBe(code)
  })

  it('429 repassa o tempo de espera do retry-after', () => {
    const limited = Anthropic.APIError.generate(
      429,
      { type: 'error' },
      'limite',
      new Headers({ 'retry-after': '12' })
    )
    expect(anthropicProvider.classifyError(limited)?.message).toMatch(/12 s/)
  })

  it('rede e erro desconhecido ficam para o orquestrador', () => {
    expect(
      anthropicProvider.classifyError(new Anthropic.APIConnectionError({ message: 'x' }))
    ).toBeNull()
    expect(anthropicProvider.classifyError(error(500))).toBeNull()
  })

  it('aceita PDF e as imagens da API, e nada mais', () => {
    expect(anthropicProvider.acceptsFile('application/pdf')).toBe(true)
    expect(anthropicProvider.acceptsFile('image/webp')).toBe(true)
    expect(anthropicProvider.acceptsFile('image/tiff')).toBe(false)
  })
})
