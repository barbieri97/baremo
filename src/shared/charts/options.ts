/**
 * Construtores de opções de gráfico (spec §7.3).
 *
 * Funções puras: recebem o view-model e devolvem um `EChartsOption`. Não tocam
 * no DOM, não instanciam nada, não fazem I/O. É o que permite que a MESMA opção
 * alimente o ECharts interativo na tela e o SVG estático do PDF — a janela de
 * impressão roda sem JavaScript, então lá o gráfico é renderizado no processo
 * principal, em modo SSR, a partir daqui.
 *
 * O parâmetro `forPrint` não é cosmético. Sem canvas, o zrender mede a largura
 * do texto por uma tabela aproximada, e o layout automático do ECharts —
 * `containLabel`, decisão de esconder ou girar rótulo por sobreposição — passa a
 * depender de uma medida que não corresponde à fonte real. Rótulo cortado no
 * laudo é falha silenciosa. Por isso, em impressão: margens de grid fixas,
 * `containLabel` desligado, `interval: 0` para não esconder categoria, rótulo
 * truncado por nós antes de entrar na opção, e animação desligada.
 *
 * Duas réguas convivem, de propósito, e cada gráfico diz qual usa:
 *
 * **Nível (1–5)** é a classificação, e é o que o panorama por função mostra.
 * **Normalizado (0–100)** é a posição no domínio do tipo de escore, e é o que
 * os gráficos por teste mostram — é a única régua em que a faixa esperada pode
 * ser desenhada e em que instrumentos de escalas diferentes se comparam.
 */

import type { EChartsOption } from 'echarts'
import type { FunctionSummary, TestGroup, OverviewAssessment } from '../contracts/results'
import { CLASSIFICATION_LEVELS, levelColor, LEVEL_UNKNOWN_HEX } from '../domain/levels'
import { EXPECTED_BAND } from '../domain/normalize'

export type ChartKind = 'column' | 'bar' | 'line' | 'area' | 'scatter' | 'radar' | 'pie'

export interface ChartKindOption {
  readonly kind: ChartKind
  readonly label: string
}

/**
 * Os tipos oferecidos na UI.
 *
 * `boxplot` ficou de fora de propósito: com um valor por subteste, a caixa
 * degenera num traço e o gráfico não diz nada. Oferecer um tipo que não pode
 * comunicar é pior do que não oferecê-lo.
 */
export const CHART_KINDS: readonly ChartKindOption[] = [
  { kind: 'column', label: 'Colunas' },
  { kind: 'bar', label: 'Barras horizontais' },
  { kind: 'line', label: 'Linha' },
  { kind: 'area', label: 'Área' },
  { kind: 'scatter', label: 'Pontos' },
  { kind: 'radar', label: 'Radar' },
  { kind: 'pie', label: 'Pizza' }
]

export interface ChartStyle {
  /** Ajusta layout e desliga interação para o SVG que vai ao PDF. */
  readonly forPrint: boolean
  /** Desenha a faixa esperada (25–75) ao fundo. Só na régua normalizada. */
  readonly showNormBand?: boolean
}

const PRINT_FONT = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'
const SCREEN_FONT = 'Inter, system-ui, sans-serif'
const INK = '#2d3748'
const MUTED = '#4a5568'
const LINE = '#cbd5e0'
const SOFT = '#f7fafc'
const BRAND = '#2b6cb0'

/** Paleta das avaliações comparadas: a principal em destaque, as demais atrás. */
const ASSESSMENT_COLORS = ['#2b6cb0', '#dd6b20', '#2f855a', '#805ad5', '#c53030', '#2c7a7b']

function base(style: ChartStyle): EChartsOption {
  return {
    animation: !style.forPrint,
    backgroundColor: style.forPrint ? '#ffffff' : 'transparent',
    textStyle: {
      fontFamily: style.forPrint ? PRINT_FONT : SCREEN_FONT,
      fontSize: style.forPrint ? 10 : 12,
      color: INK
    },
    ...(style.forPrint ? {} : { tooltip: { trigger: 'item', confine: true } })
  }
}

/**
 * Trunca o rótulo aqui, e não pelo `axisLabel.overflow` do ECharts.
 *
 * Em SSR a decisão de corte do ECharts se apoia numa medição de texto que não
 * conhece a fonte real. Cortar por contagem de caracteres é grosseiro, mas é
 * previsível — e previsível é o que um laudo precisa ser.
 */
export function truncateLabel(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

// ─── Panorama por função ─────────────────────────────────────────────────────

/**
 * Radar do perfil por função cognitiva, na régua de NÍVEL (1–5).
 *
 * É a mesma métrica dos cartões do panorama, de propósito: o radar é a versão
 * de relance da mesma leitura, e trocar de régua entre um e outro obrigaria a
 * reinterpretar a figura a cada olhada.
 */
export function functionRadarOption(
  functions: readonly FunctionSummary[],
  style: ChartStyle
): EChartsOption {
  const withLevel = functions.filter((entry) => entry.averageLevel !== null)

  return {
    ...base(style),
    radar: {
      shape: 'polygon',
      // O raio é modesto de propósito: os nomes das funções cognitivas são
      // longos ("Velocidade de processamento"), e o rótulo do radar fica FORA
      // do polígono. Um raio maior é um polígono maior com os nomes cortados
      // pela borda do gráfico.
      radius: style.forPrint ? '58%' : '52%',
      center: ['50%', '52%'],
      indicator: withLevel.map((entry) => ({
        name: truncateLabel(entry.name, style.forPrint ? 20 : 18),
        min: 1,
        max: 5
      })),
      axisName: { color: MUTED, fontSize: style.forPrint ? 8.5 : 11 },
      splitLine: { lineStyle: { color: LINE } },
      axisLine: { lineStyle: { color: LINE } },
      // As áreas entre os anéis recebem a cor do nível: o fundo já conta a
      // história antes de o polígono ser lido.
      splitArea: {
        show: true,
        areaStyle: {
          color: CLASSIFICATION_LEVELS.map((entry) => withAlpha(entry.hex, 0.1))
        }
      }
    },
    series: [
      {
        type: 'radar',
        symbolSize: 5,
        lineStyle: { width: 2, color: BRAND },
        itemStyle: { color: BRAND },
        areaStyle: { color: withAlpha(BRAND, 0.18) },
        data: [
          {
            name: 'Nível médio',
            value: withLevel.map((entry) => round(entry.averageLevel ?? 0, 2))
          }
        ]
      }
    ]
  }
}

// ─── Comparação dentro de um teste ───────────────────────────────────────────

/**
 * Compara as entradas de um teste — os subtestes — na régua normalizada.
 *
 * Com uma avaliação só, cada barra recebe a cor do NÍVEL do seu resultado: o
 * gráfico passa a responder "quais subtestes caíram?" sem legenda. Com mais de
 * uma avaliação, a cor passa a identificar a avaliação, porque a pergunta muda
 * para "o que mudou entre elas?" e colorir por nível apagaria essa leitura.
 */
export function comparisonOption(
  group: TestGroup,
  assessments: readonly OverviewAssessment[],
  kind: ChartKind,
  style: ChartStyle
): EChartsOption {
  const categories = group.entries.map((entry) =>
    truncateLabel(entry.label, style.forPrint ? 22 : 30)
  )
  const multi = assessments.length > 1

  if (kind === 'pie') return pieOption(group, categories, style)
  if (kind === 'radar') return radarOption(group, assessments, style)

  const series = assessments.map((assessment, index) => ({
    name: assessment.dateLabel,
    type: kind === 'column' || kind === 'bar' ? ('bar' as const) : cartesianType(kind),
    ...(kind === 'area' ? { areaStyle: { opacity: 0.18 } } : {}),
    ...(kind === 'line' || kind === 'area' ? { smooth: false, symbolSize: 6 } : {}),
    ...(kind === 'scatter' ? { symbolSize: 11 } : {}),
    barMaxWidth: 34,
    itemStyle: multi
      ? { color: ASSESSMENT_COLORS[index % ASSESSMENT_COLORS.length]! }
      : {
          color: (params: { dataIndex: number }): string =>
            levelColor(group.entries[params.dataIndex]?.values[index]?.classificationLevel ?? null)
        },
    data: group.entries.map((entry) => {
      const point = entry.values[index]
      return point?.normalized === null || point === null || point === undefined
        ? null
        : round(point.normalized, 1)
    })
  }))

  const valueAxis = {
    type: 'value' as const,
    min: 0,
    max: 100,
    name: 'Posição na escala (0–100)',
    nameTextStyle: { color: MUTED, fontSize: style.forPrint ? 8 : 10 },
    nameGap: 14,
    axisLabel: { color: MUTED },
    splitLine: { lineStyle: { color: LINE, type: 'dashed' as const } }
  }

  const categoryAxis = {
    type: 'category' as const,
    data: categories,
    axisLabel: {
      color: MUTED,
      // Sem isto, o ECharts esconde categorias que ele "acha" que não cabem —
      // com uma medição de texto que, em SSR, não conhece a fonte real.
      interval: 0,
      rotate: kind === 'bar' ? 0 : rotationFor(categories.length, style.forPrint),
      fontSize: style.forPrint ? 8 : 10
    },
    axisLine: { lineStyle: { color: LINE } },
    boundaryGap: kind === 'column' || kind === 'bar'
  }

  const horizontal = kind === 'bar'

  return {
    ...base(style),
    ...(style.forPrint ? {} : { tooltip: { trigger: 'axis', confine: true } }),
    ...(multi
      ? {
          legend: {
            top: 0,
            textStyle: { color: MUTED, fontSize: style.forPrint ? 8.5 : 11 }
          }
        }
      : {}),
    grid: gridFor(style, { horizontal, multi, categories }),
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: style.showNormBand === true ? withNormBand(series, horizontal) : series
  }
}

function cartesianType(kind: ChartKind): 'line' | 'scatter' {
  return kind === 'scatter' ? 'scatter' : 'line'
}

/**
 * Desenha a faixa esperada (25–75) ao fundo, pendurada na primeira série.
 *
 * `markArea` pertence a uma série, não ao grid: pendurar numa série invisível
 * extra custaria uma entrada na legenda. Vai na primeira, que sempre existe.
 */
function withNormBand<T extends Record<string, unknown>>(series: T[], horizontal: boolean): T[] {
  const first = series[0]
  if (first === undefined) return series

  const bounds = horizontal
    ? [[{ xAxis: EXPECTED_BAND.min }, { xAxis: EXPECTED_BAND.max }]]
    : [[{ yAxis: EXPECTED_BAND.min }, { yAxis: EXPECTED_BAND.max }]]

  return [
    {
      ...first,
      markArea: {
        silent: true,
        itemStyle: { color: '#48BB78', opacity: 0.1 },
        label: {
          show: true,
          // À DIREITA, e não `insideTopLeft`: encostado na borda esquerda do
          // grid o rótulo é cortado pelo clip do gráfico, e sai do laudo como
          // "Faixa es".
          position: 'insideTopRight' as const,
          color: MUTED,
          fontSize: 8,
          padding: [2, 4, 0, 0],
          formatter: 'Faixa esperada'
        },
        data: bounds
      }
    },
    ...series.slice(1)
  ]
}

function pieOption(
  group: TestGroup,
  categories: readonly string[],
  style: ChartStyle
): EChartsOption {
  // Pizza não usa eixo nem grid — é outra estrutura de opção, não um `type`
  // trocado. Só a avaliação principal entra: fatias de duas datas no mesmo
  // círculo somariam coisas que não se somam.
  const data = group.entries
    .map((entry, index) => ({
      name: categories[index] ?? entry.label,
      value: entry.values[0]?.normalized ?? null,
      itemStyle: { color: levelColor(entry.values[0]?.classificationLevel ?? null) }
    }))
    .filter((slice): slice is typeof slice & { value: number } => slice.value !== null)
    .map((slice) => ({ ...slice, value: round(slice.value, 1) }))

  return {
    ...base(style),
    series: [
      {
        type: 'pie',
        radius: style.forPrint ? ['32%', '62%'] : ['34%', '68%'],
        center: ['50%', '54%'],
        avoidLabelOverlap: true,
        label: {
          color: INK,
          fontSize: style.forPrint ? 8 : 10,
          formatter: '{b}: {c}'
        },
        labelLine: { length: 8, length2: 8 },
        data
      }
    ]
  }
}

function radarOption(
  group: TestGroup,
  assessments: readonly OverviewAssessment[],
  style: ChartStyle
): EChartsOption {
  // Radar exige o componente `radar` com os indicadores, e um item de dado por
  // polígono — estrutura própria, e não `series[].type` trocado.
  return {
    ...base(style),
    ...(assessments.length > 1
      ? { legend: { top: 0, textStyle: { color: MUTED, fontSize: 10 } } }
      : {}),
    radar: {
      shape: 'polygon',
      radius: style.forPrint ? '60%' : '66%',
      center: ['50%', '56%'],
      indicator: group.entries.map((entry) => ({
        name: truncateLabel(entry.label, style.forPrint ? 18 : 24),
        min: 0,
        max: 100
      })),
      axisName: { color: MUTED, fontSize: style.forPrint ? 8 : 10 },
      splitLine: { lineStyle: { color: LINE } },
      axisLine: { lineStyle: { color: LINE } },
      splitArea: { show: true, areaStyle: { color: [SOFT, '#ffffff'] } }
    },
    series: [
      {
        type: 'radar',
        symbolSize: 5,
        data: assessments.map((assessment, index) => ({
          name: assessment.dateLabel,
          value: group.entries.map((entry) =>
            entry.values[index]?.normalized === null ||
            entry.values[index] === null ||
            entry.values[index] === undefined
              ? null
              : round(entry.values[index]!.normalized!, 1)
          ),
          lineStyle: { color: ASSESSMENT_COLORS[index % ASSESSMENT_COLORS.length]!, width: 2 },
          itemStyle: { color: ASSESSMENT_COLORS[index % ASSESSMENT_COLORS.length]! },
          ...(index === 0 ? { areaStyle: { color: withAlpha(ASSESSMENT_COLORS[0]!, 0.16) } } : {})
        }))
      }
    ]
  }
}

// ─── Evolução no tempo ───────────────────────────────────────────────────────

/**
 * Transpõe a comparação: as datas viram o eixo, cada subteste vira uma linha.
 *
 * É a mesma matriz de `comparisonOption`, lida na outra direção. Aqui a
 * pergunta é "para onde isto está indo?", e só faz sentido com mais de uma
 * avaliação selecionada.
 */
export function evolutionOption(
  group: TestGroup,
  assessments: readonly OverviewAssessment[],
  style: ChartStyle
): EChartsOption {
  const dates = assessments.map((assessment) => assessment.dateLabel)

  return {
    ...base(style),
    ...(style.forPrint ? {} : { tooltip: { trigger: 'axis', confine: true } }),
    legend: {
      top: 0,
      type: 'scroll',
      textStyle: { color: MUTED, fontSize: style.forPrint ? 8.5 : 11 }
    },
    grid: {
      top: 46,
      left: style.forPrint ? 52 : 56,
      right: 20,
      bottom: 34,
      containLabel: false
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: { color: MUTED, interval: 0, fontSize: style.forPrint ? 8 : 10 },
      axisLine: { lineStyle: { color: LINE } }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      name: 'Posição na escala (0–100)',
      nameTextStyle: { color: MUTED, fontSize: style.forPrint ? 8 : 10 },
      axisLabel: { color: MUTED },
      splitLine: { lineStyle: { color: LINE, type: 'dashed' } }
    },
    series: group.entries.map((entry, index) => ({
      name: truncateLabel(entry.label, 24),
      type: 'line' as const,
      symbolSize: 7,
      // Uma lacuna é um subteste que não foi aplicado naquela avaliação. Ligar
      // os pontos por cima dela desenharia uma evolução que não foi medida.
      connectNulls: false,
      lineStyle: { width: 2, color: ASSESSMENT_COLORS[index % ASSESSMENT_COLORS.length]! },
      itemStyle: { color: ASSESSMENT_COLORS[index % ASSESSMENT_COLORS.length]! },
      data: entry.values.map((point) =>
        point === null || point.normalized === null ? null : round(point.normalized, 1)
      )
    }))
  }
}

// ─── Auxiliares ──────────────────────────────────────────────────────────────

/**
 * Margens fixas, calculadas do conteúdo — nunca `containLabel: true`.
 *
 * `containLabel` deixa o ECharts medir o texto para decidir a margem, e é
 * exatamente essa medição que não é confiável em SSR.
 */
function gridFor(
  style: ChartStyle,
  context: { horizontal: boolean; multi: boolean; categories: readonly string[] }
): EChartsOption['grid'] {
  const top = context.multi ? 46 : 28
  if (context.horizontal) {
    const longest = context.categories.reduce((max, label) => Math.max(max, label.length), 0)
    return {
      top,
      left: Math.min(190, 16 + longest * (style.forPrint ? 4.6 : 6.2)),
      right: 24,
      bottom: 40,
      containLabel: false
    }
  }

  const rotated = rotationFor(context.categories.length, style.forPrint) !== 0
  return {
    top,
    left: style.forPrint ? 52 : 58,
    right: 20,
    bottom: rotated ? 74 : 40,
    containLabel: false
  }
}

/** Gira o rótulo quando as categorias começam a se encostar. */
function rotationFor(count: number, forPrint: boolean): number {
  const threshold = forPrint ? 5 : 7
  return count > threshold ? 35 : 0
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Cor com alfa, em `#RRGGBBAA` — aceito tanto pelo canvas quanto pelo SVG. */
function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha))
  const suffix = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? `${hex}${suffix}` : hex
}

export { LEVEL_UNKNOWN_HEX }
