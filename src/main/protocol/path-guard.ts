/**
 * Guarda de caminho (spec §13.3).
 *
 * Funções puras, deliberadamente separadas de `schemes.ts`: este módulo não
 * importa `electron`, o que permite que o gate de segurança do §13.5 rode em
 * Node puro, sem levantar o runtime do Electron para testar aritmética de
 * string. É o núcleo da defesa contra path traversal no protocolo
 * `baremo-file://`, e por isso vale isolá-lo do resto.
 */

import { normalize, resolve, sep } from 'node:path'

/**
 * Resolve um caminho pedido para dentro de uma raiz, ou devolve `null`.
 *
 * Trabalha sobre o caminho decodificado e compara o resultado de `resolve` com a
 * raiz — comparação por prefixo COM separador, para que `/dados/arquivos-outros`
 * não passe por começar com `/dados/arquivos`.
 */
export function resolveWithinRoot(root: string, requestedPath: string): string | null {
  let decoded: string
  try {
    // Decodifica UMA vez. `%252e%252e` vira `%2e%2e`, que não é separador de
    // caminho e portanto não escapa — decodificar em laço é que abriria a porta.
    decoded = decodeURIComponent(requestedPath)
  } catch {
    return null
  }

  // Bytes nulos truncam caminhos em algumas camadas nativas.
  if (decoded.includes('\0')) return null

  const normalizedRoot = resolve(root)

  // O `.` inicial força o caminho a ser relativo à raiz, mesmo quando o pedido
  // é absoluto; `normalize` colapsa os `..` antes disso.
  const candidate = resolve(normalizedRoot, `.${normalize(`/${decoded}`)}`)

  return isWithinRoot(normalizedRoot, candidate) ? candidate : null
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
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep

  return candidate === normalizedRoot || candidate.startsWith(rootWithSeparator)
}
