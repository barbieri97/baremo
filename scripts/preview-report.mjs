/**
 * Gera uma prévia HTML do relatório de resultados, para inspeção visual.
 *
 * Não é teste: é a maneira de OLHAR o laudo sem abrir o app, empacotar e clicar
 * até a tela de avaliação. Monta um banco temporário com um caso realista —
 * duas funções cognitivas, um teste com quatro subtestes, uma escala de sintoma
 * invertida — e escreve o mesmo HTML que a janela de impressão receberia, com o
 * mesmo CSS e os mesmos SVGs.
 *
 *   npx vite-node --config vitest.config.ts scripts/preview-report.mjs -- [saida.html]
 *
 * Roda pelo `vite-node`, e não pelo `tsx`, por dois motivos: é ele que resolve
 * o alias `@shared`, e é ele que faz a interoperação com o `electron` em CJS
 * que os repositórios importam por causa dos erros tipados de IPC.
 *
 * O arquivo resultante abre em qualquer navegador. O que ele NÃO reproduz é a
 * paginação do `printToPDF` — cabeçalho, rodapé e quebras de página só aparecem
 * no PDF de verdade.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { openDatabase } from '../src/main/db/gateway'
import { seedDemo } from './demo-data.mjs'
import { buildResultsOverview } from '../src/main/services/results-overview'
import { renderResultsReport } from '../src/main/pdf/templates'
import { REPORT_CSS } from '../src/main/pdf/styles'
import { CHART_SIZE, renderChartSvg } from '../src/main/pdf/charts'
import { comparisonOption, evolutionOption, functionRadarOption } from '../src/shared/charts/options'
import { buildPrintDocument } from '../src/main/pdf/document-html'

const directory = mkdtempSync(join(tmpdir(), 'baremo-preview-'))
const dbPath = join(directory, 'preview.db')
const { first, second } = seedDemo(dbPath)
const handle = openDatabase(dbPath)

// ── Monta o relatório, exatamente como o handler faz ──
const overview = buildResultsOverview(handle, first, [second])

const style = { forPrint: true }
const comparison = {}
const evolution = {}

for (const group of overview.tests) {
  if (!group.comparable) continue
  comparison[group.instrumentId] = renderChartSvg(
    comparisonOption(group, overview.assessments, 'column', { ...style, showNormBand: true }),
    CHART_SIZE.comparison
  )
  if (overview.assessments.length > 1) {
    evolution[group.instrumentId] = renderChartSvg(
      evolutionOption(group, overview.assessments, style),
      CHART_SIZE.evolution
    )
  }
}

const withLevel = overview.functions.filter((entry) => entry.averageLevel !== null)
const charts = {
  radar:
    withLevel.length >= 3
      ? renderChartSvg(functionRadarOption(overview.functions, style), CHART_SIZE.radar)
      : null,
  comparison,
  evolution
}

const html = buildPrintDocument({
  title: 'Relatório de Resultados',
  bodyHtml: renderResultsReport(overview, charts),
  css: REPORT_CSS
})

const output = resolve(process.argv[2] ?? 'preview-relatorio.html')
writeFileSync(output, html, 'utf8')
handle.close()

console.log('prévia escrita em', output)
console.log(
  `funções: ${overview.functions.length} · testes: ${overview.tests.length} · ` +
    `gráficos: ${Object.keys(comparison).length + Object.keys(evolution).length}` +
    `${charts.radar ? ' + radar' : ''} · resultados: ${overview.totalResults}`
)
