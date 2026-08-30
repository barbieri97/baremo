/**
 * Normalização posicional de escores (spec §7.3).
 *
 * É a régua que permite pôr percentil, z-score e escore ponderado no mesmo
 * gráfico. Erro aqui não estoura: produz um perfil plausível e errado, que é a
 * pior forma de falhar num documento clínico. Daí os testes de extremidade e,
 * sobretudo, os de inversão — o caso em que um acerto silencioso e um erro
 * silencioso são visualmente idênticos.
 */

import { describe, expect, it } from 'vitest'
import { averageNormalized, EXPECTED_BAND, normalizeScore } from '../../src/shared/domain/normalize'
import { SCORE_TYPES, SCORE_TYPE_DOMAINS } from '../../src/shared/domain/score-types'

describe('normalizeScore — escala direta', () => {
  it('mapeia os extremos do domínio em 0 e 100', () => {
    expect(normalizeScore(0, 'percentile', false)).toBe(0)
    expect(normalizeScore(100, 'percentile', false)).toBe(100)
    expect(normalizeScore(-5, 'zScore', false)).toBe(0)
    expect(normalizeScore(5, 'zScore', false)).toBe(100)
    expect(normalizeScore(1, 'scaledScore', false)).toBe(0)
    expect(normalizeScore(19, 'scaledScore', false)).toBe(100)
  })

  it('põe o centro de cada escala em 50', () => {
    expect(normalizeScore(50, 'percentile', false)).toBe(50)
    expect(normalizeScore(0, 'zScore', false)).toBe(50)
    expect(normalizeScore(50, 'tScore', false)).toBe(50)
    expect(normalizeScore(100, 'standardScore', false)).toBe(50)
    expect(normalizeScore(10, 'scaledScore', false)).toBe(50)
  })

  it('produz 0–100 para qualquer tipo com domínio limitado', () => {
    for (const scoreType of SCORE_TYPES) {
      const domain = SCORE_TYPE_DOMAINS[scoreType]
      if (domain.min === null || domain.max === null) continue

      const middle = (domain.min + domain.max) / 2
      const value = normalizeScore(middle, scoreType, false)

      expect(value, scoreType).not.toBeNull()
      expect(value!, scoreType).toBeGreaterThanOrEqual(0)
      expect(value!, scoreType).toBeLessThanOrEqual(100)
    }
  })
})

describe('normalizeScore — escala invertida', () => {
  it('espelha o eixo: 100 continua sendo o melhor desempenho', () => {
    // Num inventário de sintomas, T-score 80 é o pior achado possível. Sem a
    // inversão ele apareceria no topo do gráfico, ao lado dos melhores
    // desempenhos — e o perfil diria o contrário do que os dados dizem.
    expect(normalizeScore(80, 'tScore', true)).toBe(20)
    expect(normalizeScore(20, 'tScore', true)).toBe(80)
  })

  it('mantém o centro no lugar', () => {
    expect(normalizeScore(50, 'tScore', true)).toBe(50)
  })

  it('é simétrica em relação à escala direta', () => {
    for (const value of [0, 10, 33.3, 50, 87.5, 100]) {
      const direct = normalizeScore(value, 'percentile', false)!
      const inverted = normalizeScore(value, 'percentile', true)!
      expect(direct + inverted).toBeCloseTo(100, 10)
    }
  })
})

describe('normalizeScore — casos sem resposta', () => {
  it('devolve null em escore bruto, que não tem domínio', () => {
    // Escore bruto não tem mínimo nem máximo declarados: não existe posição
    // relativa a calcular, e inventar uma seria pior do que omitir o ponto.
    expect(normalizeScore(42, 'raw', false)).toBeNull()
  })

  it('devolve null sem valor', () => {
    expect(normalizeScore(null, 'percentile', false)).toBeNull()
  })

  it('devolve null para valor não finito', () => {
    expect(normalizeScore(Number.NaN, 'percentile', false)).toBeNull()
    expect(normalizeScore(Number.POSITIVE_INFINITY, 'percentile', false)).toBeNull()
  })

  it('trava valor fora do domínio nas bordas, em vez de estourar a escala', () => {
    expect(normalizeScore(-10, 'percentile', false)).toBe(0)
    expect(normalizeScore(180, 'percentile', false)).toBe(100)
    expect(normalizeScore(-10, 'percentile', true)).toBe(100)
  })
})

describe('faixa esperada', () => {
  it('é o intervalo interquartil, dentro da régua', () => {
    expect(EXPECTED_BAND.min).toBe(25)
    expect(EXPECTED_BAND.max).toBe(75)
    expect(EXPECTED_BAND.min).toBeLessThan(EXPECTED_BAND.max)
  })
})

describe('averageNormalized', () => {
  it('ignora os pontos sem valor em vez de contá-los como zero', () => {
    expect(averageNormalized([80, null, 40])).toBe(60)
  })

  it('devolve null quando não há nenhum ponto conhecido', () => {
    expect(averageNormalized([null, null])).toBeNull()
    expect(averageNormalized([])).toBeNull()
  })
})
