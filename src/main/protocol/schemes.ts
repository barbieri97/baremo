/**
 * Esquemas customizados (spec §13.1, §13.3).
 *
 * Dois esquemas, com propósitos distintos:
 *
 * `app://baremo/…` serve o renderer em produção. Carregar a interface por
 * `file://` daria a ela uma origem opaca — e origem opaca torna `'self'` na CSP
 * um valor sem significado e impossibilita a validação de `senderFrame` na
 * fronteira IPC. Com um esquema standard e seguro, as duas defesas passam a
 * valer de verdade.
 *
 * `baremo-file://<id>` serve os anexos do usuário, resolvendo exclusivamente
 * dentro do diretório de arquivos do app. `file://` livre fica bloqueado.
 */

import { protocol, net } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

export const APP_SCHEME = 'app'
export const APP_HOST = 'baremo'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

export const FILE_SCHEME = 'baremo-file'

/** Precisa rodar ANTES de `app.whenReady()`. */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    },
    {
      scheme: FILE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * Resolve um caminho pedido para dentro de uma raiz, ou devolve `null`.
 *
 * É o guarda contra path traversal do §13.3, e o alvo do teste de segurança
 * correspondente. Trabalha sobre o caminho já decodificado e compara o resultado
 * de `resolve` com a raiz — checagem baseada em prefixo com separador, para que
 * `/dados/arquivos-outros` não passe por estar sob `/dados/arquivos`.
 */
export function resolveWithinRoot(root: string, requestedPath: string): string | null {
  let decoded: string
  try {
    // Decodifica uma vez; `%252e%252e` vira `%2e%2e`, que não é separador de
    // caminho e portanto não escapa — decodificar em laço é que abriria a porta.
    decoded = decodeURIComponent(requestedPath)
  } catch {
    return null
  }

  // Bytes nulos truncam caminhos em algumas camadas nativas.
  if (decoded.includes('\0')) return null

  const normalizedRoot = resolve(root)
  const candidate = resolve(normalizedRoot, `.${normalize(`/${decoded}`)}`)

  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep
  if (candidate !== normalizedRoot && !candidate.startsWith(rootWithSep)) return null

  return candidate
}

/**
 * Confere se um caminho ABSOLUTO já resolvido cai dentro da raiz.
 *
 * Complementa `resolveWithinRoot`, que trata caminhos vindos de uma URL. Aqui a
 * entrada já é um caminho do nosso próprio resolvedor — a checagem existe para
 * que um bug em outra camada não vire leitura arbitrária de disco.
 */
export function isWithinRoot(root: string, absolutePath: string): boolean {
  const normalizedRoot = resolve(root)
  const candidate = resolve(absolutePath)
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep
  return candidate === normalizedRoot || candidate.startsWith(rootWithSep)
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase()
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

/** Serve os assets do renderer buildado. */
export function registerAppScheme(rendererDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })

    const target = resolveWithinRoot(rendererDir, url.pathname)
    if (target === null) return new Response('Forbidden', { status: 403 })

    // SPA: rota desconhecida cai no index, e não em 404.
    const file =
      existsSync(target) && statSync(target).isFile() ? target : join(rendererDir, 'index.html')

    return net.fetch(pathToFileURL(file).toString())
  })
}

/**
 * Serve os anexos. O caminho vem de um resolvedor injetado, que traduz o ID do
 * anexo para o blob correspondente — o renderer nunca informa um caminho.
 */
export function registerFileScheme(
  attachmentsRoot: string,
  resolveAttachment: (id: string) => { path: string; mime: string } | null
): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    const url = new URL(request.url)
    // `baremo-file://<id>` — o host é o ID. Nada de caminho de disco na URL.
    const id = url.host

    const found = resolveAttachment(id)
    if (found === null) return new Response('Not found', { status: 404 })

    // Cinto e suspensórios: mesmo vindo do nosso resolvedor, o caminho é
    // reconferido contra a raiz antes de qualquer leitura.
    const safe = resolve(found.path)
    if (!isWithinRoot(attachmentsRoot, safe) || !existsSync(safe)) {
      return new Response('Not found', { status: 404 })
    }

    const stream = Readable.toWeb(createReadStream(safe)) as ReadableStream
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': found.mime || mimeFor(safe),
        'content-length': String(statSync(safe).size),
        // Anexo é dado do usuário: nunca deve ser interpretado como documento
        // ativo pelo renderer.
        'x-content-type-options': 'nosniff'
      }
    })
  })
}
