/**
 * Gráficos do PDF em SVG estático (spec §7.3).
 *
 * Este é o gate da decisão estrutural da visualização de resultados. A janela
 * de impressão roda com `javascript: false` e CSP `default-src 'none'`: se o
 * ECharts não conseguir renderizar sem DOM, no processo principal, então tela e
 * PDF precisariam de dois desenhos diferentes — e é exatamente essa duplicação
 * que a arquitetura escolhida existe para evitar.
 *
 * O ambiente do Vitest é `node`, sem DOM e sem canvas. É de propósito: é a
 * mesma condição do processo principal gerando o relatório.
 */

import { describe, expect, it } from 'vitest'
import { CHART_SIZE, renderChartSvg } from '../../src/main/pdf/charts'
import {
  CHART_KINDS,
  comparisonOption,
  evolutionOption,
  functionRadarOption
} from '../../src/shared/charts/options'
import type { ChartKind } from '../../src/shared/charts/options'
import type {
  FunctionSummary,
  OverviewAssessment,
  ResultPoint,
  TestGroup
} from '../../src/shared/contracts/results'

function point(overrides: Partial<ResultPoint>): ResultPoint {
  return {
    resultId: '11111111-1111-4111-8111-111111111111',
    assessmentId: '22222222-2222-4222-8222-222222222222',
    instrumentId: '33333333-3333-4333-8333-333333333333',
    instrumentName: 'Subteste',
    instrumentAcronym: null,
    instrumentPath: 'Teste › Subteste',
    scoreType: 'percentile',
    scoreTypeLabel: 'Pc',
    value: 30,
    normalized: 30,
    classificationName: 'Média inferior',
    colorHex: '#DD6B20',
    classificationLevel: 2,
    status: 'applied',
    statusLabel: 'Aplicado',
    manuallyOverridden: false,
    notes: null,
    cognitiveFunctionId: null,
    cognitiveFunctionName: null,
    ...overrides
  }
}

const ASSESSMENT_A: OverviewAssessment = {
  id: '22222222-2222-4222-8222-222222222222',
  date: '2026-03-10',
  dateLabel: '10/03/2026',
  isPrimary: true
}

const ASSESSMENT_B: OverviewAssessment = {
  id: '44444444-4444-4444-8444-444444444444',
  date: '2026-08-10',
  dateLabel: '10/08/2026',
  isPrimary: false
}

/** Um teste com quatro subtestes, que é o caso em que o gráfico serve. */
const GROUP: TestGroup = {
  instrumentId: '55555555-5555-4555-8555-555555555555',
  name: 'Escala Wechsler',
  acronym: 'WAIS',
  label: 'Escala Wechsler (WAIS)',
  inverted: false,
  comparable: true,
  entries: [
    {
      key: 'a::percentile',
      label: 'Vocabulário',
      instrumentId: '33333333-3333-4333-8333-333333333333',
      scoreType: 'percentile',
      scoreTypeLabel: 'Pc',
      values: [point({ normalized: 80, classificationLevel: 4 }), point({ normalized: 84 })]
    },
    {
      key: 'b::percentile',
      label: 'Dígitos',
      instrumentId: '33333333-3333-4333-8333-333333333334',
      scoreType: 'percentile',
      scoreTypeLabel: 'Pc',
      values: [point({ normalized: 12, classificationLevel: 1 }), point({ normalized: 30 })]
    },
    {
      key: 'c::percentile',
      label: 'Cubos',
      instrumentId: '33333333-3333-4333-8333-333333333335',
      scoreType: 'percentile',
      scoreTypeLabel: 'Pc',
      // Lacuna real: o subteste não foi aplicado na segunda avaliação.
      values: [point({ normalized: 55, classificationLevel: 3 }), null]
    },
    {
      key: 'd::percentile',
      label: 'Raciocínio matricial com nome bem longo',
      instrumentId: '33333333-3333-4333-8333-333333333336',
      scoreType: 'percentile',
      scoreTypeLabel: 'Pc',
      values: [point({ normalized: 45, classificationLevel: null }), point({ normalized: 48 })]
    }
  ]
}

const FUNCTIONS: FunctionSummary[] = [
  {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Memória',
    depth: 0,
    points: [],
    averageLevel: 1.5,
    averageNormalized: 20,
    distribution: { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, unknown: 0 },
    belowExpected: 2
  },
  {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Linguagem',
    depth: 0,
    points: [],
    averageLevel: 4,
    averageNormalized: 78,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, unknown: 0 },
    belowExpected: 0
  }
]

const PRINT = { forPrint: true } as const

function isSvg(markup: string): boolean {
  return markup.trimStart().startsWith('<svg') && markup.trimEnd().endsWith('</svg>')
}

describe('renderChartSvg — sem DOM, sem canvas', () => {
  it('renderiza cada tipo de gráfico oferecido na UI', () => {
    // Se um tipo novo entrar em CHART_KINDS e não sobreviver ao SSR, o laudo
    // sairia com um buraco onde deveria estar o gráfico. Este laço é a trava.
    for (const { kind } of CHART_KINDS) {
      const svg = renderChartSvg(
        comparisonOption(GROUP, [ASSESSMENT_A], kind satisfies ChartKind, PRINT),
        CHART_SIZE.comparison
      )
      expect(isSvg(svg), `tipo ${kind} não produziu SVG`).toBe(true)
      expect(svg.length, `tipo ${kind} produziu SVG vazio`).toBeGreaterThan(500)
    }
  })

  it('renderiza o radar do panorama por função', () => {
    const svg = renderChartSvg(functionRadarOption(FUNCTIONS, PRINT), CHART_SIZE.radar)
    expect(isSvg(svg)).toBe(true)
    expect(svg).toContain('Memória')
  })

  it('renderiza a evolução entre duas avaliações', () => {
    const svg = renderChartSvg(
      evolutionOption(GROUP, [ASSESSMENT_A, ASSESSMENT_B], PRINT),
      CHART_SIZE.evolution
    )
    expect(isSvg(svg)).toBe(true)
    expect(svg).toContain('10/03/2026')
  })

  it('desenha a faixa esperada quando pedida', () => {
    const withBand = renderChartSvg(
      comparisonOption(GROUP, [ASSESSMENT_A], 'column', { forPrint: true, showNormBand: true }),
      CHART_SIZE.comparison
    )
    expect(withBand).toContain('Faixa esperada')
  })

  it('não emite animação para dentro do PDF', () => {
    // A janela de impressão não executa script, mas o SVG do ECharts carrega
    // animação por CSS — que apareceria como um estado intermediário congelado
    // na hora em que o `printToPDF` captura a página.
    const svg = renderChartSvg(
      comparisonOption(GROUP, [ASSESSMENT_A], 'column', PRINT),
      CHART_SIZE.comparison
    )
    expect(svg).not.toContain('<animate')
    expect(svg).not.toContain('@keyframes')
  })

  it('não emite script — o SVG entra inline no HTML do laudo', () => {
    const svg = renderChartSvg(functionRadarOption(FUNCTIONS, PRINT), CHART_SIZE.radar)
    expect(svg.toLowerCase()).not.toContain('<script')
  })

  it('trunca rótulo longo em vez de deixar o layout decidir', () => {
    // Em SSR a medição de texto do zrender não conhece a fonte real: quem corta
    // é o nosso código, por contagem de caracteres, que é previsível.
    const svg = renderChartSvg(
      comparisonOption(GROUP, [ASSESSMENT_A], 'column', PRINT),
      CHART_SIZE.comparison
    )
    expect(svg).not.toContain('Raciocínio matricial com nome bem longo')
    expect(svg).toContain('…')
  })

  it('aguenta um teste sem nenhum valor normalizado', () => {
    const empty: TestGroup = {
      ...GROUP,
      entries: GROUP.entries.map((entry) => ({
        ...entry,
        values: [point({ normalized: null, value: null })]
      }))
    }

    expect(() =>
      renderChartSvg(
        comparisonOption(empty, [ASSESSMENT_A], 'column', PRINT),
        CHART_SIZE.comparison
      )
    ).not.toThrow()
  })
})
