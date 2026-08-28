/**
 * Resolução de faixas de classificação (spec §4.6, gate do §15.1).
 *
 * O que estes testes protegem é a fronteira. A convenção `[min, max)` com a
 * última faixa inclusiva é fácil de implementar quase certo — e "quase certo"
 * aqui significa classificar um percentil 25 como "Média inferior" em vez de
 * "Média" num laudo assinado.
 */

import { describe, expect, it } from 'vitest'
import { describeRange, resolveRange, suggestNextMin, validateRangeSet } from '@shared/domain/ranges'
import type { RangeLike } from '@shared/domain/ranges'

function range(
  id: string,
  name: string,
  min: number,
  max: number,
  colorHex = '#000000'
): RangeLike {
  return { id, classificationName: name, minValue: min, maxValue: max, colorHex, version: 1 }
}

/** Série de percentil cobrindo 0–100 sem lacuna nem sobreposição. */
const PERCENTILE_SERIES: RangeLike[] = [
  range('r1', 'Inferior', 0, 5),
  range('r2', 'Limítrofe', 5, 10),
  range('r3', 'Média inferior', 10, 25),
  range('r4', 'Média', 25, 75),
  range('r5', 'Média superior', 75, 90),
  range('r6', 'Superior', 90, 98),
  range('r7', 'Muito superior', 98, 100)
]

describe('resolveRange — convenção [min, max)', () => {
  it('inclui o limite inferior da faixa', () => {
    expect(resolveRange(25, PERCENTILE_SERIES, 'percentile')?.classificationName).toBe('Média')
    expect(resolveRange(75, PERCENTILE_SERIES, 'percentile')?.classificationName).toBe(
      'Média superior'
    )
  })

  it('exclui o limite superior, empurrando o valor para a faixa seguinte', () => {
    // 24,9 ainda é "Média inferior"; 25 já é "Média". Este é o par que quebra
    // quando alguém troca `<` por `<=`.
    expect(resolveRange(24.9, PERCENTILE_SERIES, 'percentile')?.classificationName).toBe(
      'Média inferior'
    )
    expect(resolveRange(25, PERCENTILE_SERIES, 'percentile')?.classificationName).toBe('Média')
  })

  it('inclui o máximo APENAS na última faixa da série', () => {
    // 100 é o topo do domínio: sem a exceção, o valor máximo seria inclassificável.
    expect(resolveRange(100, PERCENTILE_SERIES, 'percentile')?.classificationName).toBe(
      'Muito superior'
    )
  })

  it('classifica o mínimo do domínio', () => {
    expect(resolveRange(0, PERCENTILE_SERIES, 'percentile')?.classificationName).toBe('Inferior')
  })

  it('devolve null fora da cobertura', () => {
    expect(resolveRange(101, PERCENTILE_SERIES, 'percentile')).toBeNull()
    expect(resolveRange(-1, PERCENTILE_SERIES, 'percentile')).toBeNull()
  })

  it('devolve null para conjunto vazio', () => {
    expect(resolveRange(50, [], 'percentile')).toBeNull()
  })
})

describe('resolveRange — aritmética de ponto flutuante', () => {
  const zSeries: RangeLike[] = [
    range('z1', 'Muito abaixo', -5, -2),
    range('z2', 'Abaixo', -2, -1),
    range('z3', 'Média', -1, 1),
    range('z4', 'Acima', 1, 2),
    range('z5', 'Muito acima', 2, 5)
  ]

  it('classifica corretamente valores que a soma binária deslocaria', () => {
    // 0.1 + 0.2 === 0.30000000000000004. Comparando floats diretamente, um valor
    // calculado assim poderia cair fora da faixa que o contém.
    expect(resolveRange(0.1 + 0.2, zSeries, 'zScore')?.classificationName).toBe('Média')
  })

  it('trata a fronteira exata em z-score', () => {
    expect(resolveRange(-1, zSeries, 'zScore')?.classificationName).toBe('Média')
    expect(resolveRange(-1.01, zSeries, 'zScore')?.classificationName).toBe('Abaixo')
    expect(resolveRange(1, zSeries, 'zScore')?.classificationName).toBe('Acima')
  })

  it('arredonda para a precisão declarada antes de comparar', () => {
    // z-score tem 2 casas: 0,999 arredonda para 1,00 e passa a ser "Acima".
    expect(resolveRange(0.999, zSeries, 'zScore')?.classificationName).toBe('Acima')
    expect(resolveRange(0.994, zSeries, 'zScore')?.classificationName).toBe('Média')
  })

  it('classifica os extremos do domínio de z-score', () => {
    expect(resolveRange(-5, zSeries, 'zScore')?.classificationName).toBe('Muito abaixo')
    expect(resolveRange(5, zSeries, 'zScore')?.classificationName).toBe('Muito acima')
  })
})

describe('resolveRange — escalas invertidas', () => {
  /**
   * Escala de sintomas em T-score: valor ALTO indica pior. A spec diz que isso
   * é expresso naturalmente pelo cadastro, sem flag — estes testes fixam essa
   * garantia.
   */
  const symptomSeries: RangeLike[] = [
    range('s1', 'Não clínico', 0, 60),
    range('s2', 'Limítrofe', 60, 70),
    range('s3', 'Clinicamente significativo', 70, 100)
  ]

  it('resolve pela posição numérica, sem tratamento especial', () => {
    expect(resolveRange(45, symptomSeries, 'tScore')?.classificationName).toBe('Não clínico')
    expect(resolveRange(65, symptomSeries, 'tScore')?.classificationName).toBe('Limítrofe')
    expect(resolveRange(70, symptomSeries, 'tScore')?.classificationName).toBe(
      'Clinicamente significativo'
    )
    expect(resolveRange(100, symptomSeries, 'tScore')?.classificationName).toBe(
      'Clinicamente significativo'
    )
  })
})

describe('resolveRange — faixas fora de ordem', () => {
  it('não depende da ordem do array de entrada', () => {
    const shuffled = [...PERCENTILE_SERIES].reverse()
    expect(resolveRange(50, shuffled, 'percentile')?.classificationName).toBe('Média')
    expect(resolveRange(100, shuffled, 'percentile')?.classificationName).toBe('Muito superior')
  })
})

describe('validateRangeSet', () => {
  it('aceita a série completa', () => {
    expect(validateRangeSet(PERCENTILE_SERIES, 'percentile')).toEqual([])
  })

  it('detecta sobreposição', () => {
    const overlapping = [range('a', 'A', 0, 50), range('b', 'B', 40, 100)]
    const codes = validateRangeSet(overlapping, 'percentile').map((issue) => issue.code)
    expect(codes).toContain('overlap')
  })

  it('detecta lacuna entre faixas', () => {
    const gapped = [range('a', 'A', 0, 40), range('b', 'B', 50, 100)]
    const codes = validateRangeSet(gapped, 'percentile').map((issue) => issue.code)
    expect(codes).toContain('gap')
  })

  it('aceita faixas contíguas — o máximo de uma é o mínimo da seguinte', () => {
    const contiguous = [range('a', 'A', 0, 50), range('b', 'B', 50, 100)]
    expect(validateRangeSet(contiguous, 'percentile')).toEqual([])
  })

  it('detecta extremidade inferior descoberta', () => {
    const partial = [range('a', 'A', 10, 100)]
    const codes = validateRangeSet(partial, 'percentile').map((issue) => issue.code)
    expect(codes).toContain('uncovered_start')
  })

  it('detecta extremidade superior descoberta', () => {
    const partial = [range('a', 'A', 0, 90)]
    const codes = validateRangeSet(partial, 'percentile').map((issue) => issue.code)
    expect(codes).toContain('uncovered_end')
  })

  it('recusa faixa com mínimo maior ou igual ao máximo', () => {
    const inverted = [range('a', 'A', 50, 50), range('b', 'B', 80, 20)]
    const codes = validateRangeSet(inverted, 'percentile').map((issue) => issue.code)
    expect(codes.filter((code) => code === 'inverted_bounds')).toHaveLength(2)
  })

  it('recusa faixa fora do domínio do tipo de escore', () => {
    const outside = [range('a', 'A', 0, 150)]
    const codes = validateRangeSet(outside, 'percentile').map((issue) => issue.code)
    expect(codes).toContain('above_domain')
  })

  it('sinaliza conjunto vazio', () => {
    expect(validateRangeSet([], 'percentile').map((issue) => issue.code)).toEqual(['empty'])
  })

  it('recusa faixas para escore bruto, que não classifica automaticamente', () => {
    const codes = validateRangeSet([range('a', 'A', 0, 10)], 'raw').map((issue) => issue.code)
    expect(codes).toEqual(['not_classifiable'])
  })

  it('valida o domínio inteiro de escore ponderado', () => {
    const scaled = [
      range('a', 'Inferior', 1, 7),
      range('b', 'Média', 7, 13),
      range('c', 'Superior', 13, 19)
    ]
    expect(validateRangeSet(scaled, 'scaledScore')).toEqual([])
    expect(resolveRange(19, scaled, 'scaledScore')?.classificationName).toBe('Superior')
    expect(resolveRange(1, scaled, 'scaledScore')?.classificationName).toBe('Inferior')
  })
})

describe('suggestNextMin', () => {
  it('parte do mínimo do domínio quando não há faixas', () => {
    expect(suggestNextMin([], 'percentile')).toBe(0)
    expect(suggestNextMin([], 'zScore')).toBe(-5)
    expect(suggestNextMin([], 'scaledScore')).toBe(1)
  })

  it('continua a partir do maior máximo existente', () => {
    expect(suggestNextMin(PERCENTILE_SERIES.slice(0, 3), 'percentile')).toBe(25)
  })
})

describe('describeRange', () => {
  it('marca a última faixa como fechada no topo', () => {
    expect(describeRange(PERCENTILE_SERIES[6]!, PERCENTILE_SERIES, 'percentile')).toBe('[98, 100]')
  })

  it('marca as demais como abertas no topo', () => {
    expect(describeRange(PERCENTILE_SERIES[3]!, PERCENTILE_SERIES, 'percentile')).toBe('[25, 75[')
  })
})
