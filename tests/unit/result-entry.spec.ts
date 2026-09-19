/**
 * Escolha do tipo de escore na entrada de resultados (spec §4.5, §16.4).
 *
 * O seletor só oferece o que o instrumento tem, e já vem no tipo certo: numa
 * bateria de dezenas de subtestes, cada troca manual de métrica é um clique a
 * mais e uma chance a mais de gravar no tipo errado.
 */

import { describe, expect, it } from 'vitest'
import {
  availableScoreTypes,
  defaultScoreType,
  formatDecimalInput,
  parseDecimalInput
} from '@shared/domain/result-entry'
import { SCORE_TYPES } from '@shared/domain/score-types'

describe('tipos de escore disponíveis', () => {
  it('sem faixa nenhuma, oferece todos os tipos', () => {
    expect(availableScoreTypes([])).toEqual([...SCORE_TYPES])
  })

  it('com faixas, oferece só os tipos cadastrados e o escore bruto, na ordem canônica', () => {
    expect(availableScoreTypes(['scaledScore', 'percentile'])).toEqual([
      'percentile',
      'scaledScore',
      'raw'
    ])
  })

  it('preserva o tipo de um resultado em edição mesmo sem faixa', () => {
    expect(availableScoreTypes(['percentile'], 'tScore')).toEqual(['percentile', 'tScore', 'raw'])
  })
})

describe('tipo de escore pré-selecionado', () => {
  it('usa o último escolhido quando ainda disponível', () => {
    const available = availableScoreTypes(['percentile', 'scaledScore'])
    expect(defaultScoreType(available, ['percentile', 'scaledScore'], 'scaledScore')).toBe(
      'scaledScore'
    )
  })

  it('ignora o lembrado que não está disponível e cai no primeiro com faixas', () => {
    const available = availableScoreTypes(['standardScore'])
    expect(defaultScoreType(available, ['standardScore'], 'percentile')).toBe('standardScore')
  })

  it('prefere um tipo com faixas ao escore bruto', () => {
    expect(defaultScoreType(['scaledScore', 'raw'], ['scaledScore'])).toBe('scaledScore')
  })

  it('sem faixas, fica no primeiro tipo', () => {
    expect(defaultScoreType(availableScoreTypes([]), [])).toBe(SCORE_TYPES[0])
  })
})

describe('valor digitado', () => {
  it('aceita vírgula decimal', () => {
    expect(parseDecimalInput(' 4,5 ')).toBe(4.5)
    expect(parseDecimalInput('10')).toBe(10)
  })

  it('vazio ou inválido vira null', () => {
    expect(parseDecimalInput('')).toBeNull()
    expect(parseDecimalInput('abc')).toBeNull()
  })

  it('formata de volta com vírgula', () => {
    expect(formatDecimalInput(1.5)).toBe('1,5')
    expect(formatDecimalInput(null)).toBe('')
  })
})
