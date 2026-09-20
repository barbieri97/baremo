/**
 * Gera uma prévia do relatório de resultados, para inspeção visual.
 *
 * Não é teste: é a maneira de OLHAR o laudo sem abrir o app, empacotar e clicar
 * até a tela de avaliação. Monta um banco temporário com um caso realista e
 * escreve o mesmo HTML que a janela de impressão receberia, com o mesmo CSS e
 * os mesmos SVGs — e, por padrão, imprime também o PDF.
 *
 *   npx vite-node --config vitest.config.ts scripts/preview-report.mjs
 *   npx vite-node --config vitest.config.ts scripts/preview-report.mjs -- saida.html
 *   npx vite-node --config vitest.config.ts scripts/preview-report.mjs -- saida.html --comparar
 *   npx vite-node --config vitest.config.ts scripts/preview-report.mjs -- saida.html --sem-pdf
 *
 * Ou, pelo atalho: `npm run preview:pdf`.
 *
 * Roda pelo `vite-node`, e não pelo `tsx`, por dois motivos: é ele que resolve
 * o alias `@shared`, e é ele que faz a interoperação com o `electron` em CJS
 * que os repositórios importam por causa dos erros tipados de IPC.
 *
 * O HTML abre em qualquer navegador, mas NÃO reproduz a paginação: cabeçalho,
 * rodapé e quebras de página só existem no PDF. Como é justamente a paginação
 * que costuma quebrar num laudo de cartões, o PDF é o padrão e o HTML é o
 * subproduto. A impressão em si acontece em `print-preview.mjs`, num processo
 * Electron — o `printToPDF` não existe fora dele.
 *
 * Por padrão a prévia sai com UMA avaliação, que é o caso da tela de
 * resultados; `--comparar` acrescenta a segunda e exercita as colunas de
 * comparação e os gráficos de evolução.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import { openDatabase } from '../src/main/db/gateway'
import { seedDemo } from './demo-data.mjs'
import { buildResultsOverview } from '../src/main/services/results-overview'
import { renderResultsReport } from '../src/main/pdf/templates'
import { renderResultsCharts } from '../src/main/pdf/results-charts'
import { REPORT_CSS } from '../src/main/pdf/styles'
import { DOCUMENT_CSS } from '../src/main/pdf/document-template'
import {
  buildPrintDocument,
  PRINT_PAGE_OPTIONS,
  printFooterTemplate,
  printHeaderTemplate
} from '../src/main/pdf/document-html'
import { formatIsoDate, today } from '../src/shared/domain/dates'

const args = process.argv.slice(2)
const flags = args.filter((argument) => argument.startsWith('--'))
const positional = args.filter((argument) => !argument.startsWith('--'))

const comparing = flags.includes('--comparar')
const withPdf = !flags.includes('--sem-pdf')

const TITLE = 'Relatório de Resultados'

const directory = mkdtempSync(join(tmpdir(), 'baremo-preview-'))
const dbPath = join(directory, 'preview.db')
const { first, second } = seedDemo(dbPath)
const handle = openDatabase(dbPath)

// ── Monta o relatório, exatamente como o handler faz ──
const overview = buildResultsOverview(handle, first, comparing ? [second] : [])
const charts = renderResultsCharts(overview)

// `REPORT_CSS + DOCUMENT_CSS`, como em `ipc/handlers/reports.ts`: é o que o
// laudo recebe de verdade, e passar só um dos dois daria uma prévia otimista.
const html = buildPrintDocument({
  title: TITLE,
  bodyHtml: renderResultsReport(overview, charts),
  css: REPORT_CSS + DOCUMENT_CSS
})

const htmlOutput = resolve(positional[0] ?? 'preview-relatorio.html')
writeFileSync(htmlOutput, html, 'utf8')
handle.close()

console.log('prévia em HTML escrita em', htmlOutput)
console.log(
  `funções: ${overview.functions.length} · testes: ${overview.tests.length} · ` +
    `avaliações: ${overview.assessments.length} · ` +
    `gráficos: ${Object.keys(charts.comparison).length + Object.keys(charts.evolution).length}` +
    ` + ${Object.keys(charts.functionRadars).length} radares por função` +
    `${charts.radar ? ' + radar geral' : ''} · resultados: ${overview.totalResults}`
)

if (!withPdf) {
  rmSync(directory, { recursive: true, force: true })
  process.exit(0)
}

// ── Imprime, num processo Electron ──
const pdfOutput = htmlOutput.replace(/\.html$/, '') + '.pdf'
const jobPath = join(directory, 'job.json')

writeFileSync(
  jobPath,
  JSON.stringify({
    htmlPath: htmlOutput,
    output: pdfOutput,
    printOptions: {
      ...PRINT_PAGE_OPTIONS,
      headerTemplate: printHeaderTemplate({
        left: overview.patient.fullName,
        right: TITLE
      }),
      footerTemplate: printFooterTemplate(formatIsoDate(today()))
    }
  }),
  'utf8'
)

// `createRequire` em vez de `import`: o pacote `electron` exporta uma STRING (o
// caminho do binário) como `module.exports`, e a interoperação CJS do vite-node
// entregaria um objeto de namespace no lugar dela.
const electronBinary = createRequire(import.meta.url)('electron')

const environment = { ...process.env }
// O terminal integrado do VS Code exporta esta variável. Com ela, o binário do
// Electron sobe como Node puro: `app` chega indefinido e nenhuma janela abre.
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(
  electronBinary,
  [
    resolve('scripts/print-preview.mjs'),
    jobPath,
    // Nunca tocar o perfil real do app: a prévia não pode herdar (nem sujar) o
    // estado da instalação de quem está rodando.
    `--user-data-dir=${join(directory, 'electron-profile')}`,
    ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
  ],
  { stdio: 'inherit', env: environment }
)

child.on('exit', (code) => {
  rmSync(directory, { recursive: true, force: true })
  if (code !== 0) {
    console.error('a impressão falhou (código', code + ')')
    process.exit(code ?? 1)
  }
})
