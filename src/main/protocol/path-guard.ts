/**
 * Guarda de caminho (spec §13.3).
 *
 * Funções puras, deliberadamente separadas de `schemes.ts`: este módulo não
 * importa `electron`, o que permite que o gate de segurança do §13.5 rode em
 * Node puro, sem levantar o runtime do Electron para testar aritmética de
 * string. É o núcleo da defesa contra path traversal no protocolo
 * `baremo-file://`, e por isso vale isolá-lo do resto.
 */

import { resolve, sep } from 'node:path'

/**
 * Resolve um caminho pedido para dentro de uma raiz, ou devolve `null`.
 *
 * A entrada é o *pathname* de uma URL — sempre com barras normais, sempre
 * POSIX — e NÃO um caminho do sistema. Por isso a normalização é feita à mão,
 * segmento a segmento, em vez de delegar a `path.normalize`:
 *
 *  - no Windows, `path.normalize` é `path.win32`, que interpreta `//algo` como
 *    caminho UNC (`\\servidor\compartilhamento`) e se recusa a colapsar `..`
 *    além da raiz do compartilhamento — um `/a/b/../c` sairia de lá como
 *    `/a/b/c`, com o `..` engolido;
 *  - a mesma entrada produziria resultados diferentes em Windows e em POSIX, e
 *    um resolvedor de segurança que muda de comportamento conforme o sistema é
 *    um resolvedor que não dá para revisar.
 *
 * O laço abaixo não tem essas armadilhas: `..` desempilha, e desempilhar uma
 * pilha vazia não faz nada — então nenhuma sequência de `..` alcança fora da
 * raiz, em nenhuma plataforma. `isWithinRoot` confere o resultado como segunda
 * barreira.
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

  // A contrabarra é tratada como separador, e não como caractere de nome: é o
  // que o Chromium faz ao normalizar URLs, e é a leitura conservadora — um
  // segmento literal `..\..` nunca chega a virar nome de arquivo.
  const segments: string[] = []

  for (const segment of decoded.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue

    if (segment === '..') {
      segments.pop()
      continue
    }

    segments.push(segment)
  }

  const normalizedRoot = resolve(root)
  const candidate = resolve(normalizedRoot, ...segments)

  // Segunda barreira. Pega, entre outros, o caso do Windows em que um segmento
  // como `C:` seria interpretado por `resolve` como designador de unidade e
  // levaria para fora da raiz.
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
