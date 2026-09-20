/**
 * Imprime um HTML já montado em PDF, usando o Electron.
 *
 * Segunda metade de `preview-report.mjs`, e um arquivo separado por uma razão
 * dura: o `printToPDF` só existe dentro do Electron, e o Electron não carrega
 * os fontes em TypeScript. Então a primeira metade roda no `vite-node`, que
 * entende o `@shared` e o `.ts`, monta o HTML e escreve um arquivo de tarefa;
 * esta aqui roda no Electron e não importa NADA de `src/`.
 *
 *   electron scripts/print-preview.mjs caminho/da/tarefa.json
 *
 * Normalmente não se chama à mão: quem chama é o `preview-report.mjs`.
 *
 * Duas diferenças conhecidas em relação ao caminho de verdade (`pdf/render.ts`),
 * e nenhuma delas afeta o layout: o HTML é carregado por `file://` em vez do
 * esquema `baremo-print:` servido da memória, e imagens de anexo
 * (`baremo-file:`) não resolvem. A sanitização não é uma delas — o HTML já
 * chega passado pelo `buildPrintDocument`, que roda o DOMPurify.
 *
 * `app.whenReady()` e não `app.on('ready')`: num entrypoint ESM o evento pode
 * disparar antes de o módulo terminar de avaliar, e o ouvinte registrado tarde
 * nunca seria chamado.
 */

import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'

const jobPath = process.argv[2]

if (jobPath === undefined) {
  console.error('uso: electron scripts/print-preview.mjs <tarefa.json>')
  process.exit(1)
}

const job = JSON.parse(readFileSync(jobPath, 'utf8'))

app.whenReady().then(print).catch(fail)

async function print() {
  // As mesmas travas da janela de impressão do app: sem script, sem Node, sem
  // preload. Aqui elas não protegem nada (o HTML é nosso), mas uma prévia que
  // roda com outras permissões pode renderizar o que o app não renderizaria.
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      images: true
    }
  })

  try {
    await window.loadFile(job.htmlPath)
    writeFileSync(job.output, await window.webContents.printToPDF(job.printOptions))
    console.log('PDF escrito em', job.output)
    app.exit(0)
  } finally {
    window.destroy()
  }
}

function fail(error) {
  console.error(error)
  app.exit(1)
}
