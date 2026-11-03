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
 * A impressão reproduz as condições do app (`pdf/render.ts`): o HTML é servido
 * da memória pelo esquema de impressão, com a `PRINT_CSP` no cabeçalho, e a
 * sessão recebe o mesmo `onHeadersReceived` que a janela principal instala com
 * a CSP de produção. Foi a ausência disto que deixou passar o bug da v0.18.0 —
 * no app, aquele gancho trocava a CSP da janela de impressão e o laudo saía
 * sem folha de estilo, enquanto a prévia, servida por `file://` e sem o
 * gancho, saía perfeita. A regra de exceção é a de `windows/csp.ts`
 * (`cspHeadersFor`), repetida aqui porque este arquivo não importa TS; o
 * valor do esquema e das políticas vem do `job.json`.
 *
 * Diferença que sobra: imagens de anexo (`baremo-file:`) não resolvem.
 *
 * `app.whenReady()` e não `app.on('ready')`: num entrypoint ESM o evento pode
 * disparar antes de o módulo terminar de avaliar, e o ouvinte registrado tarde
 * nunca seria chamado.
 */

import { app, BrowserWindow, protocol, session } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'

const jobPath = process.argv[2]

if (jobPath === undefined) {
  console.error('uso: electron scripts/print-preview.mjs <tarefa.json>')
  process.exit(1)
}

const job = JSON.parse(readFileSync(jobPath, 'utf8'))

// Antes do `ready`, como em `main/index.ts`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: job.printScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true }
  }
])

app.whenReady().then(print).catch(fail)

async function print() {
  const html = readFileSync(job.htmlPath, 'utf8')

  protocol.handle(
    job.printScheme,
    () =>
      new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': job.printCsp
        }
      })
  )

  // O gancho da janela principal (`windows/main-window.ts`), na sessão padrão.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const exempt = job.exemptPrintScheme && details.url.startsWith(`${job.printScheme}:`)
    callback({
      responseHeaders: exempt
        ? details.responseHeaders
        : { ...details.responseHeaders, 'Content-Security-Policy': [job.sessionCsp] }
    })
  })

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
    await window.loadURL(`${job.printScheme}://preview/`)
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
