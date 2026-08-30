/**
 * Gráficos do PDF, em SVG estático (spec §7.3).
 *
 * A janela de impressão roda com `javascript: false` e CSP `default-src 'none'`
 * (ver `render.ts`): nenhuma biblioteca de gráfico executa lá dentro. O ECharts
 * entra por outro caminho — o modo SSR, que roda aqui no processo principal, sem
 * DOM, e devolve uma string de SVG que viaja embutida no HTML como qualquer
 * outra marcação.
 *
 * O ganho não é só técnico: a opção que gera este SVG é a MESMA que a tela usa
 * (`@shared/charts/options`). O gráfico do laudo e o gráfico da tela não são
 * duas implementações que combinaram de parecer iguais — são a mesma, desenhada
 * duas vezes.
 *
 * Uma limitação a conhecer, verificada no código do `echarts@6`: sem canvas, o
 * zrender mede a largura do texto por uma tabela de aproximação que não conhece
 * a fonte real. Todo layout que dependa dessa medida fica frouxo. Por isso os
 * construtores de opção usam margens fixas e `containLabel: false` quando
 * `forPrint` — a mitigação está lá, e este módulo só precisa não desfazê-la.
 */

import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

/** Proporções usadas pelos gráficos do relatório, em pixels de layout. */
export const CHART_SIZE = {
  radar: { width: 460, height: 320 },
  comparison: { width: 640, height: 300 },
  evolution: { width: 640, height: 280 }
} as const

/**
 * Renderiza uma opção como SVG.
 *
 * `ssr: true` desliga o laço de animação e os módulos de evento — sem isso o
 * ECharts deixaria temporizadores pendurados a cada relatório gerado. O
 * `dispose` fecha a instância: um relatório com vinte gráficos criaria vinte
 * instâncias vivas por exportação.
 */
export function renderChartSvg(
  option: EChartsOption,
  size: { width: number; height: number }
): string {
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: size.width,
    height: size.height
  })

  try {
    // Redundante com o `forPrint` dos construtores, e deliberado: nenhuma opção
    // que chegue aqui deve conseguir emitir animação CSS para dentro do PDF.
    chart.setOption({ ...option, animation: false })
    return chart.renderToSVGString()
  } finally {
    chart.dispose()
  }
}
