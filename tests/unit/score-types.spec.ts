/**
 * Domínio dos tipos de escore normativo (spec §4.5).
 *
 * A tabela de domínios é o que impede entrada incoerente — um z-score 47,
 * digitado onde se queria 4,7, é o erro que estes limites pegam.
 */

import { describe, expect, it } from 'vitest'
import {
  SCORE_TYPES,
  SCORE_TYPE_DOMAINS,
  toScaled,
  validateScoreValue
} from '@shared/domain/score-types'
import { ageAt, formatAge, formatIsoDate, isIsoDate } from '@shared/domain/dates'

describe('domínios dos tipos de escore', () => {
  it('cobre todos os tipos declarados', () => {
    for (const type of SCORE_TYPES) {
      expect(SCORE_TYPE_DOMAINS[type]).toBeDefined()
    }
  })

  it('reflete a tabela da spec', () => {
    expect(SCORE_TYPE_DOMAINS.percentile).toMatchObject({ min: 0, max: 100, decimals: 1 })
    expect(SCORE_TYPE_DOMAINS.zScore).toMatchObject({ min: -5, max: 5, decimals: 2 })
    expect(SCORE_TYPE_DOMAINS.tScore).toMatchObject({ min: 0, max: 100, decimals: 1 })
    expect(SCORE_TYPE_DOMAINS.standardScore).toMatchObject({ min: 40, max: 160, decimals: 0 })
    expect(SCORE_TYPE_DOMAINS.scaledScore).toMatchObject({ min: 1, max: 19, decimals: 0 })
    expect(SCORE_TYPE_DOMAINS.stanine).toMatchObject({ min: 1, max: 9, decimals: 0 })
    expect(SCORE_TYPE_DOMAINS.decile).toMatchObject({ min: 1, max: 10, decimals: 0 })
  })

  it('marca escore bruto como livre e sem classificação automática', () => {
    expect(SCORE_TYPE_DOMAINS.raw.autoClassify).toBe(false)
    expect(SCORE_TYPE_DOMAINS.raw.min).toBeNull()
    expect(SCORE_TYPE_DOMAINS.raw.max).toBeNull()
  })
})

describe('validateScoreValue', () => {
  it('aceita valores dentro do domínio', () => {
    expect(validateScoreValue(0, 'percentile')).toBeNull()
    expect(validateScoreValue(100, 'percentile')).toBeNull()
    expect(validateScoreValue(-5, 'zScore')).toBeNull()
    expect(validateScoreValue(1.75, 'zScore')).toBeNull()
  })

  it('recusa valor abaixo do mínimo', () => {
    expect(validateScoreValue(-1, 'percentile')?.code).toBe('out_of_range')
    expect(validateScoreValue(0, 'scaledScore')?.code).toBe('out_of_range')
  })

  it('recusa valor acima do máximo', () => {
    expect(validateScoreValue(101, 'percentile')?.code).toBe('out_of_range')
    // O caso real: 47 onde se queria 4,7.
    expect(validateScoreValue(47, 'zScore')?.code).toBe('out_of_range')
  })

  it('recusa precisão maior que a declarada', () => {
    expect(validateScoreValue(10.5, 'scaledScore')?.code).toBe('too_precise')
    expect(validateScoreValue(1.234, 'zScore')?.code).toBe('too_precise')
    expect(validateScoreValue(50.25, 'percentile')?.code).toBe('too_precise')
  })

  it('aceita a precisão exata', () => {
    expect(validateScoreValue(50.2, 'percentile')).toBeNull()
    expect(validateScoreValue(1.23, 'zScore')).toBeNull()
    expect(validateScoreValue(10, 'scaledScore')).toBeNull()
  })

  it('aceita qualquer valor finito em escore bruto', () => {
    expect(validateScoreValue(9999, 'raw')).toBeNull()
    expect(validateScoreValue(-9999, 'raw')).toBeNull()
  })

  it('recusa valores não finitos', () => {
    expect(validateScoreValue(Number.NaN, 'percentile')?.code).toBe('out_of_range')
    expect(validateScoreValue(Number.POSITIVE_INFINITY, 'raw')?.code).toBe('out_of_range')
  })
})

describe('toScaled', () => {
  it('converte para inteiro pela precisão do tipo', () => {
    expect(toScaled(25, 'percentile')).toBe(2500)
    expect(toScaled(1.23, 'zScore')).toBe(123)
    expect(toScaled(10, 'scaledScore')).toBe(1000)
  })

  it('arredonda para a precisão antes de escalar', () => {
    // Escore ponderado é inteiro: 10,6 vira 11.
    expect(toScaled(10.6, 'scaledScore')).toBe(1100)
  })

  it('produz o mesmo inteiro para valores equivalentes com ruído binário', () => {
    expect(toScaled(0.1 + 0.2, 'zScore')).toBe(toScaled(0.3, 'zScore'))
  })
})

describe('datas do domínio', () => {
  it('valida o formato ISO de data civil', () => {
    expect(isIsoDate('2026-08-28')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false) // 2026 não é bissexto
    expect(isIsoDate('2024-02-29')).toBe(true)
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('28/08/2026')).toBe(false)
  })

  it('calcula idade em anos e meses', () => {
    expect(ageAt('1990-05-15', '2026-08-28')).toEqual({ years: 36, months: 3, days: 13 })
  })

  it('trata o aniversário no próprio dia', () => {
    expect(ageAt('1990-08-28', '2026-08-28')).toEqual({ years: 36, months: 0, days: 0 })
  })

  it('trata o dia anterior ao aniversário', () => {
    const age = ageAt('1990-08-29', '2026-08-28')
    expect(age?.years).toBe(35)
    expect(age?.months).toBe(11)
  })

  it('devolve null quando a referência é anterior ao nascimento', () => {
    expect(ageAt('2026-08-28', '1990-01-01')).toBeNull()
  })

  it('formata a idade em português', () => {
    expect(formatAge({ years: 36, months: 3, days: 0 })).toBe('36 anos e 3 meses')
    expect(formatAge({ years: 1, months: 1, days: 0 })).toBe('1 ano e 1 mês')
    expect(formatAge({ years: 8, months: 0, days: 0 })).toBe('8 anos')
  })

  it('formata data no padrão brasileiro', () => {
    expect(formatIsoDate('2026-08-28')).toBe('28/08/2026')
  })
})
