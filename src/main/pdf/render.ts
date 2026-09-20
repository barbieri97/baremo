/**
 * Geração de PDF (spec §7, §13.4).
 *
 * Com a entrada do editor, o conteúdo que vai para a janela de impressão passa a
 * incluir texto produzido ou COLADO pelo usuário — o que torna esta etapa um
 * vetor de XSS. As defesas, em camadas:
 *
 *  1. o HTML é montado por template com escape por padrão (`pdf/html.ts`) e, no
 *     caso de documentos, por um serializador com allowlist (`pdf/serialize.ts`);
 *  2. passa por DOMPurify antes de sair daqui;
 *  3. é servido a uma janela offscreen, sandbox, sem preload e sem integração
 *     com Node, sob `default-src 'none'` — sem script, sem rede;
 *  4. o HTML é entregue por um esquema próprio, servido da memória, e não por
 *     `file://` nem por um arquivo temporário em disco.
 */

import { BrowserWindow, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import {
  buildPrintDocument,
  PRINT_CSP,
  PRINT_PAGE_OPTIONS,
  printFooterTemplate,
  printHeaderTemplate
} from './document-html'
import type { PdfHeader } from './document-html'

/** A configuração de página vive em `document-html.ts`, que não importa
 *  `electron` — ver o comentário lá. Reexportada porque este continua sendo o
 *  módulo que os chamadores conhecem. */
export type { PdfHeader }

export const PRINT_SCHEME = 'baremo-print'

/** Jobs em voo, por id. O HTML nunca toca o disco. */
const jobs = new Map<string, string>()

export function registerPrintScheme(): void {
  protocol.handle(PRINT_SCHEME, async (request) => {
    const url = new URL(request.url)
    const body = jobs.get(url.host)

    if (body === undefined) return new Response('Not found', { status: 404 })

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': PRINT_CSP
      }
    })
  })
}

/** Precisa ser chamado antes de `app.whenReady()`, junto dos demais esquemas. */
export const PRINT_SCHEME_PRIVILEGES = {
  scheme: PRINT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true }
} as const

export interface RenderOptions {
  readonly title: string
  /** HTML do corpo, já montado pelos templates. */
  readonly bodyHtml: string
  readonly css: string
  readonly header: PdfHeader
  /** Data de emissão do rodapé (§7.2). */
  readonly issuedAt: string
}

/**
 * Sanitiza, renderiza e devolve os bytes do PDF.
 *
 * A janela é criada e destruída por chamada: um `BrowserWindow` persistente
 * carregaria estado de um relatório para o próximo.
 */
export async function renderPdf(options: RenderOptions): Promise<Buffer> {
  const jobId = randomUUID()
  const document = buildPrintDocument(options)

  jobs.set(jobId, document)

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      javascript: false,
      images: true,
      // Nenhum preload: esta janela não conversa com o processo principal.
      preload: undefined
    }
  })

  try {
    await window.loadURL(`${PRINT_SCHEME}://${jobId}/`)

    return await window.webContents.printToPDF({
      ...PRINT_PAGE_OPTIONS,
      headerTemplate: printHeaderTemplate(options.header),
      footerTemplate: printFooterTemplate(options.issuedAt)
    })
  } finally {
    jobs.delete(jobId)
    window.destroy()
  }
}

export async function renderPdfToFile(options: RenderOptions, filePath: string): Promise<void> {
  const buffer = await renderPdf(options)
  await writeFile(filePath, buffer)
}
