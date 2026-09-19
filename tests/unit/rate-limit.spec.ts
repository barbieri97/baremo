/**
 * 429 do Gemini — a mensagem precisa dizer QUAL limite estourou.
 *
 * O caso real que motivou isto: o teto mensal do projeto com folga e, mesmo
 * assim, recusa por cota — por ser um limite por minuto, por dia ou de um
 * modelo sem cota no nível gratuito.
 */

import { describe, expect, it } from 'vitest'
import { describeRateLimit, parseRateLimit } from '../../src/main/ai/rate-limit'

function geminiError(violations: object[], retryDelay: string | null): string {
  const details: object[] = [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations }
  ]
  if (retryDelay !== null) {
    details.push({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay })
  }
  return JSON.stringify({
    error: {
      code: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
      status: 'RESOURCE_EXHAUSTED',
      details
    }
  })
}

describe('parseRateLimit', () => {
  it('extrai limite, modelo e espera do corpo estruturado', () => {
    const info = parseRateLimit(
      geminiError(
        [
          {
            quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_input_token_count',
            quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier',
            quotaDimensions: { location: 'global', model: 'gemini-2.5-flash-lite' },
            quotaValue: '250000'
          }
        ],
        '37s'
      )
    )

    expect(info.violations[0]).toMatchObject({ model: 'gemini-2.5-flash-lite', limit: '250000' })
    expect(info.retryAfterSeconds).toBe(37)
  })

  it('aceita a mensagem precedida de texto, como o SDK às vezes monta', () => {
    const info = parseRateLimit(
      `got status: RESOURCE_EXHAUSTED. ${geminiError([{ quotaId: 'X', quotaValue: '5' }], '2.4s')}`
    )
    expect(info.violations).toHaveLength(1)
    expect(info.retryAfterSeconds).toBe(3)
  })

  it('sem JSON, ainda aproveita o "retry in" do texto', () => {
    const info = parseRateLimit('429 Too Many Requests. Please retry in 12.2s.')
    expect(info.violations).toHaveLength(0)
    expect(info.retryAfterSeconds).toBe(13)
  })
})

describe('describeRateLimit', () => {
  it('limite zero: o modelo não está disponível para a chave', () => {
    const message = describeRateLimit(
      parseRateLimit(
        geminiError(
          [
            {
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaDimensions: { model: 'gemini-2.5-pro' },
              quotaValue: '0'
            }
          ],
          null
        )
      )
    )
    expect(message).toContain('gemini-2.5-pro não tem cota disponível')
    expect(message).toContain('nível gratuito')
    expect(message).toContain('Troque o modelo')
  })

  it('limite por minuto de tokens: diz a janela e a espera', () => {
    const message = describeRateLimit(
      parseRateLimit(
        geminiError(
          [
            {
              quotaId: 'GenerateContentInputTokensPerModelPerMinute-FreeTier',
              quotaDimensions: { model: 'gemini-2.5-flash' },
              quotaValue: '250000'
            }
          ],
          '20s'
        )
      )
    )
    expect(message).toContain('limite de tokens de entrada por minuto do modelo gemini-2.5-flash')
    expect(message).toContain('20 s')
  })

  it('limite diário de requisições: avisa que só volta no dia seguinte', () => {
    const message = describeRateLimit(
      parseRateLimit(
        geminiError(
          [
            {
              quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quotaDimensions: { model: 'gemini-2.5-flash' },
              quotaValue: '20'
            }
          ],
          null
        )
      )
    )
    expect(message).toContain('limite de requisições por dia')
    expect(message).toContain('dia seguinte')
  })

  it('sem detalhe, ainda explica que os limites são por modelo e janela', () => {
    const message = describeRateLimit(parseRateLimit('429'))
    expect(message).toContain('sem informar qual limite')
    expect(message).toContain('por modelo e por minuto/dia')
  })
})
