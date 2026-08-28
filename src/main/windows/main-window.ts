/**
 * Janela principal e endurecimento (spec §13.1).
 *
 * Todas as travas ficam aqui, juntas, para que uma revisão consiga conferir a
 * §13.1 item a item sem caçar configuração espalhada.
 */

import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { APP_ORIGIN } from '../protocol/schemes'

/** Protocolos que podem ser abertos no navegador do sistema (§13.1). */
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

/**
 * CSP de produção.
 *
 * `style-src-attr 'unsafe-inline'` é a única concessão, e é deliberada:
 * `style-src` cobre também atributos `style=`, que o Vue emite em todo binding
 * `:style` e as bibliotecas de posicionamento usam para colocar um popover na
 * tela. Separar a diretiva mantém `<style>` e folhas externas travados em
 * `'self'` — que é onde script poderia entrar — sem quebrar a interface.
 */
const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: baremo-file:",
  "media-src 'self' baremo-file:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/**
 * Em desenvolvimento o Vite injeta estilos e usa `eval` no HMR, e o dev server é
 * HTTP em localhost. A política é afrouxada só aqui — a de produção acima é a
 * que vai para o usuário.
 */
function developmentCsp(devServerUrl: string): string {
  const origin = new URL(devServerUrl).origin
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-eval' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' data: baremo-file: ${origin}`,
    `media-src 'self' baremo-file: ${origin}`,
    `font-src 'self' data: ${origin}`,
    `connect-src 'self' ${origin} ws://localhost:* ws://127.0.0.1:*`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

export interface MainWindowOptions {
  readonly preloadPath: string
  /** URL do dev server; ausente em produção. */
  readonly devServerUrl?: string | undefined
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'Baremo',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Sem isso, uma janela pop-up herdaria o preload e a sessão.
      nodeIntegrationInSubFrames: false,
      spellcheck: true
    }
  })

  applyCsp(window, options.devServerUrl)
  applyNavigationGuards(window)

  window.once('ready-to-show', () => window.show())

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl)
  } else {
    void window.loadURL(`${APP_ORIGIN}/index.html`)
  }

  return window
}

function applyCsp(window: BrowserWindow, devServerUrl?: string): void {
  const policy = devServerUrl ? developmentCsp(devServerUrl) : PRODUCTION_CSP

  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

function applyNavigationGuards(window: BrowserWindow): void {
  // Nenhuma navegação sai da aplicação: um link externo que escapasse da UI
  // trocaria o conteúdo da janela que tem o preload.
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL()
    if (new URL(url).origin !== safeOrigin(current)) {
      event.preventDefault()
      void openExternal(url)
    }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url)
    return { action: 'deny' }
  })

  // Nenhuma permissão de dispositivo é usada pelo app.
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Abre no navegador do sistema, com allowlist de protocolo (§13.1). */
export async function openExternal(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }

  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return
  await shell.openExternal(parsed.toString())
}

export function preloadPath(): string {
  // `import.meta.dirname` porque o main é ESM; `__dirname` não existe aqui.
  return join(import.meta.dirname, '../preload/index.cjs')
}
