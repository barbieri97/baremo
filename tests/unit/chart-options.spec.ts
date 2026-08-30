/**
 * Construtores de opções de gráfico (spec §7.3).
 *
 * As opções são puras e servem dois destinos que não podem divergir: o ECharts
 * interativo da tela e o SVG estático do PDF. `tests/unit/pdf-charts.spec.ts`
 * garante que cada uma RENDERIZA; este arquivo garante que ela diz a coisa
 * certa antes de ser renderizada.
 *
 * Duas famílias de asserção importam mais que as outras. As de `forPrint` fixam
 * a mitigação da medição de texto aproximada do SSR — sem margens fixas e sem
 * `containLabel: false`, rótulo vaza no laudo. E as de estrutura fixam que
 * `pie` e `radar` NÃO são `series[].type` trocado: têm forma de opção própria, e
 * tratá-los como variação do cartesiano produz um gráfico vazio.
 */

import { describe, expect, it } from 'vitest'
import {
  CHART_KINDS,
  comparisonOption,
  evolutionOption,
  functionRadarOption,
  truncateLabel
} from '../../src/shared/charts/options'
import { CLASSIFICATION_LEVELS } from '../../src/shared/domain/levels'
import type {
  FunctionSummary,
  OverviewAssessment,
  ResultPoint,
  TestGroup
} from '../../src/shared/contracts/results'

function point(normalized: number | null, level: 1 | 2 | 3 | 4 | 5 | null): ResultPoint {
  return {
    resultId: '11111111-1111-4111-8111-111111111111',
    assessmentId: '22222222-2222-4222-8222-222222222222',
    instrumentId: '33333333-3333-4333-8333-333333333333',
    instrumentName: 'Subteste',
    instrumentAcronym: null,
    instrumentPath: 'Teste › Subteste',
    scoreType: 'percentile',
    scoreTypeLabel: 'Pc',
    value: normalized,
    normalized,
    classificationName: 'Média',
    colorHex: '#ECC94B',
    classificationLevel: level,
    status: 'applied',
    statusLabel: 'Aplicado',
    manuallyOverridden: false,
    notes: null,
    cognitiveFunctionId: null,
    cognitiveFunctionName: null
  }
}

const A: OverviewAssessment = {
  id: '22222222-2222-4222-8222-222222222222',
  date: '2026-03-10',
  dateLabel: '10/03/2026',
  isPrimary: true
}

const B: OverviewAssessment = {
  id: '44444444-4444-4444-8444-444444444444',
  date: '2026-08-10',
  dateLabel: '10/08/2026',
  isPrimary: false
}

function group(entryCount: number): TestGroup {
  return {
    instrumentId: '55555555-5555-4555-8555-555555555555',
    name: 'Escala',
    acronym: 'ESC',
    label: 'Escala (ESC)',
    inverted: false,
    comparable: entryCount >= 2,
    entries: Array.from({ length: entryCount }, (_, index) => ({
      key: `e${index}::percentile`,
      label: `Subteste ${index + 1}`,
      instrumentId: `3333333${index}-3333-4333-8333-333333333333`,
      scoreType: 'percentile' as const,
      scoreTypeLabel: 'Pc',
      values: [point(20 + index * 10, 2), point(30 + index * 10, 3)]
    }))
  }
}

const FUNCTIONS: FunctionSummary[] = [
  {
    id: 'f1',
    name: 'Memória',
    depth: 0,
    points: [],
    averageLevel: 1.5,
    averageNormalized: 20,
    distribution: { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, unknown: 0 },
    belowExpected: 2
  },
  {
    id: 'f2',
    name: 'Função com um nome bastante comprido para o eixo',
    depth: 0,
    points: [],
    averageLevel: null,
    averageNormalized: null,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 2 },
    belowExpected: 0
  }
]

const PRINT = { forPrint: true } as const
const SCREEN = { forPrint: false } as const

/** O `grid` pode vir como objeto ou lista; normaliza para inspecionar. */
function gridOf(option: Record<string, unknown>): Record<string, unknown> {
  const grid = option.grid
  return (Array.isArray(grid) ? grid[0] : grid) as unknown as Record<string, unknown>
}

describe('estrutura por tipo', () => {
  it('bar, line, area e scatter usam eixo cartesiano', () => {
    for (const kind of ['column', 'bar', 'line', 'area', 'scatter'] as const) {
      const option = comparisonOption(group(3), [A], kind, SCREEN) as unknown as Record<
        string,
        unknown
      >
      expect(option.xAxis, kind).toBeDefined()
      expect(option.yAxis, kind).toBeDefined()
      expect(option.grid, kind).toBeDefined()
    }
  })

  it('barra horizontal troca os eixos, e não só o tipo da série', () => {
    const vertical = comparisonOption(group(3), [A], 'column', SCREEN) as unknown as Record<
      string,
      unknown
    >
    const horizontal = comparisonOption(group(3), [A], 'bar', SCREEN) as unknown as Record<
      string,
      unknown
    >

    expect((vertical.xAxis as { type: string }).type).toBe('category')
    expect((horizontal.yAxis as { type: string }).type).toBe('category')
    expect((horizontal.xAxis as { type: string }).type).toBe('value')
  })

  it('pizza não tem eixo nem grid — é outra forma de opção', () => {
    const option = comparisonOption(group(3), [A], 'pie', SCREEN) as unknown as Record<
      string,
      unknown
    >

    expect(option.xAxis).toBeUndefined()
    expect(option.yAxis).toBeUndefined()
    expect(option.grid).toBeUndefined()
    expect((option.series as { type: string }[])[0]!.type).toBe('pie')
  })

  it('radar exige o componente radar com indicadores', () => {
    const option = comparisonOption(group(3), [A], 'radar', SCREEN) as unknown as Record<
      string,
      unknown
    >

    expect(option.xAxis).toBeUndefined()
    expect(option.radar).toBeDefined()
    expect((option.radar as { indicator: unknown[] }).indicator).toHaveLength(3)
  })

  it('cobre todo tipo anunciado na UI', () => {
    // Um tipo no seletor sem ramo no construtor viraria um cartão vazio.
    for (const { kind } of CHART_KINDS) {
      const option = comparisonOption(group(3), [A], kind, SCREEN) as unknown as Record<
        string,
        unknown
      >
      expect(option.series, kind).toBeDefined()
      expect((option.series as unknown[]).length, kind).toBeGreaterThan(0)
    }
  })
})

describe('forPrint — a mitigação da medição de texto do SSR', () => {
  it('desliga a animação', () => {
    for (const { kind } of CHART_KINDS) {
      const option = comparisonOption(group(3), [A], kind, PRINT) as unknown as Record<
        string,
        unknown
      >
      expect(option.animation, kind).toBe(false)
    }
  })

  it('usa margens fixas, nunca containLabel', () => {
    // `containLabel` faz o ECharts medir o texto para decidir a margem, e é
    // essa medida que não é confiável sem canvas.
    for (const kind of ['column', 'bar', 'line'] as const) {
      const grid = gridOf(comparisonOption(group(6), [A], kind, PRINT) as Record<string, unknown>)
      expect(grid.containLabel, kind).toBe(false)
      expect(typeof grid.left, kind).toBe('number')
    }
  })

  it('não esconde categoria: interval 0 no eixo', () => {
    const option = comparisonOption(group(9), [A], 'column', PRINT) as unknown as Record<
      string,
      unknown
    >
    const axis = option.xAxis as { axisLabel: { interval: number; rotate: number } }

    expect(axis.axisLabel.interval).toBe(0)
    // Com nove categorias, o rótulo gira em vez de sumir.
    expect(axis.axisLabel.rotate).toBeGreaterThan(0)
  })

  it('não declara tooltip — a janela de impressão não executa script', () => {
    for (const { kind } of CHART_KINDS) {
      const option = comparisonOption(group(3), [A], kind, PRINT) as unknown as Record<
        string,
        unknown
      >
      expect(option.tooltip, kind).toBeUndefined()
    }
  })

  it('na tela, ao contrário, mantém animação e tooltip', () => {
    const option = comparisonOption(group(3), [A], 'column', SCREEN) as unknown as Record<
      string,
      unknown
    >
    expect(option.animation).toBe(true)
    expect(option.tooltip).toBeDefined()
  })
})

describe('cor', () => {
  it('com uma avaliação, a barra recebe a cor do nível do resultado', () => {
    const option = comparisonOption(group(3), [A], 'column', SCREEN) as unknown as Record<
      string,
      unknown
    >
    const series = (option.series as { itemStyle: { color: unknown } }[])[0]!

    // Função, e não cor fixa: cada ponto consulta o próprio nível.
    expect(typeof series.itemStyle.color).toBe('function')
  })

  it('com duas avaliações, a cor passa a identificar a avaliação', () => {
    // A pergunta muda de "quais caíram?" para "o que mudou?", e colorir por
    // nível apagaria a segunda leitura.
    const option = comparisonOption(group(3), [A, B], 'column', SCREEN) as unknown as Record<
      string,
      unknown
    >
    const series = option.series as { itemStyle: { color: unknown } }[]

    expect(series).toHaveLength(2)
    expect(typeof series[0]!.itemStyle.color).toBe('string')
    expect(series[0]!.itemStyle.color).not.toBe(series[1]!.itemStyle.color)
  })
})

describe('faixa esperada', () => {
  it('entra como markArea da primeira série quando pedida', () => {
    const option = comparisonOption(group(3), [A], 'column', {
      forPrint: false,
      showNormBand: true
    }) as unknown as Record<string, unknown>

    expect((option.series as { markArea?: unknown }[])[0]!.markArea).toBeDefined()
  })

  it('fica de fora quando não pedida', () => {
    const option = comparisonOption(group(3), [A], 'column', SCREEN) as unknown as Record<
      string,
      unknown
    >
    expect((option.series as { markArea?: unknown }[])[0]!.markArea).toBeUndefined()
  })
})

describe('radar do panorama', () => {
  it('usa a régua de nível, de 1 a 5', () => {
    const option = functionRadarOption(FUNCTIONS, SCREEN) as unknown as Record<string, unknown>
    const radar = option.radar as { indicator: { min: number; max: number }[] }

    expect(radar.indicator[0]).toMatchObject({ min: 1, max: 5 })
  })

  it('deixa de fora a função sem nível, em vez de plotá-la como zero', () => {
    // Plotar como zero afirmaria "muito rebaixado" sobre uma função que
    // ninguém classificou.
    const option = functionRadarOption(FUNCTIONS, SCREEN) as unknown as Record<string, unknown>
    const radar = option.radar as { indicator: { name: string }[] }

    expect(radar.indicator).toHaveLength(1)
    expect(radar.indicator[0]!.name).toBe('Memória')
  })

  it('pinta os anéis com as cores da escala', () => {
    const option = functionRadarOption(FUNCTIONS, SCREEN) as unknown as Record<string, unknown>
    const radar = option.radar as { splitArea: { areaStyle: { color: string[] } } }

    expect(radar.splitArea.areaStyle.color).toHaveLength(CLASSIFICATION_LEVELS.length)
  })
})

describe('evolução', () => {
  it('transpõe: as datas viram o eixo e cada subteste vira uma linha', () => {
    const option = evolutionOption(group(3), [A, B], SCREEN) as unknown as Record<string, unknown>

    expect((option.xAxis as { data: string[] }).data).toEqual(['10/03/2026', '10/08/2026'])
    expect(option.series as unknown[]).toHaveLength(3)
  })

  it('não liga os pontos por cima de uma lacuna', () => {
    // Uma lacuna é um subteste não aplicado naquela avaliação. Ligar os pontos
    // desenharia uma evolução que não foi medida.
    const option = evolutionOption(group(2), [A, B], SCREEN) as unknown as Record<string, unknown>
    for (const series of option.series as { connectNulls: boolean }[]) {
      expect(series.connectNulls).toBe(false)
    }
  })
})

describe('truncateLabel', () => {
  it('deixa passar o que cabe', () => {
    expect(truncateLabel('Dígitos', 20)).toBe('Dígitos')
  })

  it('corta com reticências no limite', () => {
    const cut = truncateLabel('Raciocínio matricial completo', 12)
    expect(cut).toHaveLength(12)
    expect(cut.endsWith('…')).toBe(true)
  })
})
