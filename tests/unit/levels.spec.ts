/**
 * Escala de níveis de classificação (spec §4.6).
 *
 * O nível é o que dá ordem ao nome livre da faixa, e é dele que sai toda a
 * leitura por cor: o panorama por função, a barra de calor e a cor das séries
 * nos gráficos. Um erro aqui não aparece como exceção — aparece como uma função
 * pintada de verde quando o paciente está rebaixado, que é exatamente o tipo de
 * engano que a visualização existe para evitar. Daí os testes de fronteira.
 */

import { describe, expect, it } from 'vitest'
import {
  aggregateLevel,
  CLASSIFICATION_LEVELS,
  countBelowExpected,
  levelColor,
  levelColorContinuous,
  levelDistribution,
  LEVEL_UNKNOWN_HEX,
  suggestLevels,
  toClassificationLevel
} from '../../src/shared/domain/levels'
import type { ClassificationLevel } from '../../src/shared/domain/levels'

describe('a escala', () => {
  it('tem cinco níveis, do mais rebaixado ao mais elevado', () => {
    expect(CLASSIFICATION_LEVELS.map((entry) => entry.level)).toEqual([1, 2, 3, 4, 5])
  })

  it('usa cores válidas em #RRGGBB', () => {
    for (const entry of CLASSIFICATION_LEVELS) {
      expect(entry.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('toClassificationLevel — a fronteira com o banco', () => {
  it('aceita 1 a 5', () => {
    expect([1, 2, 3, 4, 5].map(toClassificationLevel)).toEqual([1, 2, 3, 4, 5])
  })

  it('recusa qualquer outra coisa, virando "sem nível"', () => {
    // A coluna é um INTEGER solto: um banco editado à mão não pode conseguir
    // pintar uma função de verde com um valor fora da escala.
    for (const value of [0, 6, -1, 2.5, null, undefined, '3', NaN]) {
      expect(toClassificationLevel(value)).toBeNull()
    }
  })
})

describe('aggregateLevel', () => {
  it('é a média dos níveis conhecidos', () => {
    expect(aggregateLevel([1, 2, 3])).toBe(2)
    expect(aggregateLevel([2, 5])).toBe(3.5)
  })

  it('ignora os resultados sem nível em vez de contá-los como zero', () => {
    // Contar como zero puxaria a média para baixo e faria uma função sem
    // níveis cadastrados parecer a mais comprometida de todas.
    expect(aggregateLevel([4, null, 4])).toBe(4)
  })

  it('devolve null quando nenhum resultado tem nível', () => {
    expect(aggregateLevel([null, null])).toBeNull()
    expect(aggregateLevel([])).toBeNull()
  })
})

describe('levelDistribution e countBelowExpected', () => {
  it('conta por nível e separa os desconhecidos', () => {
    expect(levelDistribution([1, 1, 3, 5, null])).toEqual({
      1: 2,
      2: 0,
      3: 1,
      4: 0,
      5: 1,
      unknown: 1
    })
  })

  it('conta como abaixo do esperado apenas os níveis 1 e 2', () => {
    expect(countBelowExpected([1, 2, 3, 4, 5, null])).toBe(2)
  })
})

describe('cor', () => {
  it('dá cinza neutro ao resultado sem nível — nunca verde nem vermelho', () => {
    expect(levelColor(null)).toBe(LEVEL_UNKNOWN_HEX)
    expect(levelColorContinuous(null)).toBe(LEVEL_UNKNOWN_HEX)
  })

  it('interpola o nível médio, que é fracionário', () => {
    // Arredondar 2,1 e 2,9 para o mesmo nível apagaria justamente a diferença
    // que o panorama existe para mostrar.
    const low = levelColorContinuous(2.1)
    const high = levelColorContinuous(2.9)
    expect(low).not.toBe(high)
    expect(low).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('nos valores inteiros devolve exatamente a cor do nível', () => {
    expect(levelColorContinuous(3)).toBe(levelColor(3))
    expect(levelColorContinuous(5)).toBe(levelColor(5))
  })

  it('não estoura fora da escala', () => {
    expect(levelColorContinuous(0.2)).toBe(levelColor(1))
    expect(levelColorContinuous(9)).toBe(levelColor(5))
  })
})

describe('suggestLevels', () => {
  it('espalha as pontas nos extremos', () => {
    expect(suggestLevels(3, false)).toEqual([1, 3, 5])
    expect(suggestLevels(5, false)).toEqual([1, 2, 3, 4, 5])
  })

  it('acomoda um conjunto de sete faixas sem inventar níveis', () => {
    const levels = suggestLevels(7, false)
    expect(levels).toHaveLength(7)
    expect(levels[0]).toBe(1)
    expect(levels[6]).toBe(5)
    // Monotônica: uma faixa de valor maior nunca sugere nível menor.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!)
    }
  })

  it('inverte a série numa escala de sintoma', () => {
    // Escore alto = pior. A faixa de maior valor é a que recebe o nível 1.
    expect(suggestLevels(3, true)).toEqual([5, 3, 1])
    expect(suggestLevels(5, true)).toEqual([5, 4, 3, 2, 1])
  })

  it('trata os casos degenerados', () => {
    expect(suggestLevels(0, false)).toEqual([])
    expect(suggestLevels(1, false)).toEqual([3])
  })

  it('só produz níveis dentro da escala', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 12, 20]) {
      for (const level of suggestLevels(count, false)) {
        expect(CLASSIFICATION_LEVELS.map((e) => e.level)).toContain(
          level satisfies ClassificationLevel
        )
      }
    }
  })
})
