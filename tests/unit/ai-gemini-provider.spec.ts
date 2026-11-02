/**
 * Adaptador do Gemini — a tradução entre os turnos neutros do orquestrador e o
 * formato do `@google/genai`. O comportamento ponta a ponta (loop de tools,
 * confirmação) está em `ai-orchestrator.spec.ts`, que roda sobre este adaptador.
 */

import { describe, expect, it } from 'vitest'
import { Type } from '@google/genai'
import type { GenerateContentResponse } from '@google/genai'
import {
  fromResponse,
  geminiProvider,
  toContents,
  toGeminiSchema
} from '../../src/main/ai/providers/gemini'
import { toolDeclarations } from '../../src/main/ai/tools'

const call = { id: null, name: 'ler_arquivo', args: { arquivoId: 'a1' } }

describe('Gemini — declarações', () => {
  it('converte JSON Schema neutro para o Schema do SDK, recursivamente', () => {
    expect(
      toGeminiSchema({
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            items: { type: 'object', properties: { valor: { type: 'number' } } }
          },
          idade: { type: 'integer', description: 'Anos.' }
        },
        required: ['itens']
      })
    ).toEqual({
      type: Type.OBJECT,
      properties: {
        itens: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { valor: { type: Type.NUMBER } } }
        },
        idade: { type: Type.INTEGER, description: 'Anos.' }
      },
      required: ['itens']
    })
  })

  it('aceita todas as declarações do app', () => {
    for (const declaration of toolDeclarations(true)) {
      expect(toGeminiSchema(declaration.parameters).type).toBe(Type.OBJECT)
    }
  })
})

describe('Gemini — turnos', () => {
  it('resultado de tool vai num turno user, com o arquivo logo após a resposta', () => {
    const [content] = toContents([
      {
        role: 'tool',
        results: [
          {
            call,
            content: '<dados_do_prontuario/>',
            files: [{ kind: 'file', mime: 'application/pdf', dataBase64: 'QUJD' }]
          },
          { call: { id: 'c2', name: 'listar_avaliacoes', args: {} }, content: 'ok', files: [] }
        ]
      }
    ])

    expect(content).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'ler_arquivo',
            response: { conteudo: '<dados_do_prontuario/>' }
          }
        },
        { inlineData: { mimeType: 'application/pdf', data: 'QUJD' } },
        { functionResponse: { name: 'listar_avaliacoes', id: 'c2', response: { conteudo: 'ok' } } }
      ]
    })
  })

  it('turno do modelo reenvia as partes nativas (assinaturas de raciocínio)', () => {
    const native = [{ functionCall: { name: 'x', args: {} }, thoughtSignature: 'assinatura' }]
    expect(toContents([{ role: 'model', text: '', toolCalls: [], native }])).toEqual([
      { role: 'model', parts: native }
    ])
  })

  it('sem partes nativas (histórico salvo), reconstrói texto e chamadas', () => {
    expect(
      toContents([
        { role: 'model', text: 'Olá', toolCalls: [] },
        { role: 'user', parts: [{ kind: 'text', text: 'Oi' }] }
      ])
    ).toEqual([
      { role: 'model', parts: [{ text: 'Olá' }] },
      { role: 'user', parts: [{ text: 'Oi' }] }
    ])
  })
})

describe('Gemini — respostas', () => {
  const response = (partial: Record<string, unknown>): GenerateContentResponse =>
    partial as unknown as GenerateContentResponse

  it('lê tokens, texto e motivo de parada', () => {
    expect(
      fromResponse(
        response({
          text: 'Pronto.',
          candidates: [{ content: { parts: [{ text: 'Pronto.' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 }
        })
      )
    ).toMatchObject({ text: 'Pronto.', stop: 'end', inputTokens: 10, outputTokens: 4 })

    expect(
      fromResponse(
        response({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] })
      ).stop
    ).toBe('truncated')

    expect(
      fromResponse(response({ functionCalls: [{ name: 'listar_avaliacoes', args: {} }] }))
    ).toMatchObject({ stop: 'tool_calls', toolCalls: [{ id: null, name: 'listar_avaliacoes' }] })
  })

  it('bloqueio de segurança, na pergunta ou na resposta, vira stop = safety', () => {
    for (const blocked of [
      response({ promptFeedback: { blockReason: 'SAFETY' } }),
      response({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] })
    ]) {
      const parsed = fromResponse(blocked)
      expect(parsed.stop).toBe('safety')
      expect(parsed.safetyMessage).toMatch(/filtro de segurança/)
    }
  })
})

describe('Gemini — erros', () => {
  it.each([
    ['[401] API key not valid', 'invalid_key'],
    ['PERMISSION_DENIED', 'invalid_key'],
    ['[429] RESOURCE_EXHAUSTED', 'rate_limited']
  ])('%s → %s', (message, code) => {
    expect(geminiProvider.classifyError(new Error(message))?.code).toBe(code)
  })

  it('deixa rede e falhas desconhecidas para o orquestrador', () => {
    expect(geminiProvider.classifyError(new Error('fetch failed'))).toBeNull()
    expect(geminiProvider.classifyError(new Error('???'))).toBeNull()
  })

  it('aceita PDF e imagem, e nada mais', () => {
    expect(geminiProvider.acceptsFile('application/pdf')).toBe(true)
    expect(geminiProvider.acceptsFile('image/png')).toBe(true)
    expect(geminiProvider.acceptsFile('application/msword')).toBe(false)
  })
})
