/**
 * Os gráficos do relatório de resultados (spec §7.3).
 *
 * Vive num módulo próprio, e não dentro do handler de `reports:*`, por um
 * motivo concreto: o script de prévia (`scripts/preview-report.mjs`) precisa
 * montar os MESMOS gráficos, não pode importar o handler — que abre banco e
 * diálogo — e por isso mantinha uma cópia da lógica. A cópia envelheceu: ficou
 * desenhando o radar geral a partir de `overview.functions`, quando o
 * view-model já entregava `overallRadar`, e nunca soube dos radares por função.
 *
 * Uma prévia que desenha outra coisa não é prévia. O módulo existe para que
 * exista um lugar só.
 */

import { CHART_SIZE, renderChartSvg } from './charts'
import { comparisonOption, evolutionOption, functionRadarOption } from '@shared/charts/options'
import type { ResultsOverview } from '@shared/contracts/results'
import type { EChartsOption } from 'echarts'
import type { ResultsReportCharts } from './templates'

/**
 * Desenha os gráficos do relatório, em SVG.
 *
 * Só entra gráfico que tem o que dizer: a comparação exige duas entradas, e a
 * evolução só existe com mais de uma avaliação selecionada. Um gráfico
 * degenerado num laudo é pior do que a sua ausência — ocupa a página e sugere
 * uma leitura que os dados não sustentam.
 *
 * O corte de eixo mínimo do radar NÃO é repetido aqui: ele já veio aplicado do
 * view-model. Se o radar existe, ele é desenhável. Repetir a regra seria como a
 * tela e o laudo passariam a mostrar conjuntos diferentes de gráficos.
 */
export function renderResultsCharts(overview: ResultsOverview): ResultsReportCharts {
  const style = { forPrint: true } as const
  const comparison: Record<string, string> = {}
  const evolution: Record<string, string> = {}

  for (const group of overview.tests) {
    if (!group.comparable) continue

    comparison[group.instrumentId] = renderChartSvg(
      comparisonOption(group, overview.assessments, 'column', {
        ...style,
        showNormBand: true
      }),
      CHART_SIZE.comparison
    )

    if (overview.assessments.length > 1) {
      evolution[group.instrumentId] = renderChartSvg(
        evolutionOption(group, overview.assessments, style),
        CHART_SIZE.evolution
      )
    }
  }

  const functionRadars: Record<string, string> = {}
  for (const group of overview.functionGroups) {
    for (const radar of group.radars) {
      if (radar.parentId === null) continue
      functionRadars[radar.parentId] = renderChartSvg(
        withRadarRadius(functionRadarOption(radar.axes, style), '66%'),
        CHART_SIZE.radar
      )
    }
  }

  return {
    // O radar geral ocupa a largura do conteúdo (`.chart-card--wide`), numa
    // figura baixa: sobra lado para os nomes das funções, e o raio pode crescer
    // até a altura sem que o cartão empurre o panorama para outra página.
    radar:
      overview.overallRadar === null
        ? null
        : renderChartSvg(
            withRadarRadius(functionRadarOption(overview.overallRadar.axes, style), '74%'),
            CHART_SIZE.radarOverall
          ),
    functionRadars,
    comparison,
    evolution
  }
}

/**
 * Ajusta o raio do radar à moldura em que ele cai no laudo.
 *
 * O raio da opção compartilhada é conservador, porque serve a qualquer
 * proporção. Aqui a proporção é conhecida — `CHART_SIZE` é largo e baixo —, e o
 * raio pode ocupar a altura: os nomes ficam nas laterais, onde há folga.
 */
function withRadarRadius(option: EChartsOption, radius: string): EChartsOption {
  const radar = option.radar
  if (radar === undefined || Array.isArray(radar)) return option
  return { ...option, radar: { ...radar, radius } }
}
