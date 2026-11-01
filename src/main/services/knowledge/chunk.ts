/**
 * Divisão do texto extraído em trechos para a base de referências.
 *
 * Função pura: recebe as páginas e devolve os trechos com a página de origem.
 * Quebra por parágrafo, junta parágrafos até ~1200 caracteres e repete ~200
 * caracteres do fim do trecho anterior no começo do próximo. Sem essa
 * sobreposição, uma frase cortada na fronteira não seria encontrada por nenhum
 * dos dois trechos.
 */

export interface PageText {
  /** Número da página (1-based), ou `null` quando o formato não tem páginas (DOCX, TXT). */
  readonly page: number | null
  readonly text: string
}

export interface Chunk {
  readonly ordinal: number
  readonly page: number | null
  readonly text: string
}

export interface ChunkOptions {
  readonly maxChars?: number
  readonly overlapChars?: number
}

const DEFAULT_MAX = 1200
const DEFAULT_OVERLAP = 200

export function chunkPages(pages: readonly PageText[], options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX
  const overlapChars = Math.min(options.overlapChars ?? DEFAULT_OVERLAP, Math.floor(maxChars / 2))

  const chunks: Chunk[] = []

  for (const { page, text } of pages) {
    let current = ''

    const flush = (): void => {
      const trimmed = current.trim()
      if (trimmed.length > 0) chunks.push({ ordinal: chunks.length, page, text: trimmed })
      current = trimmed.length > overlapChars ? tail(trimmed, overlapChars) : ''
    }

    for (const piece of pieces(text, maxChars - overlapChars)) {
      if (current.length > 0 && current.length + piece.length + 2 > maxChars) flush()
      current = current.length > 0 ? `${current}\n\n${piece}` : piece
    }

    // O resto da página fecha um trecho; a sobreposição não atravessa páginas,
    // para que a página citada seja sempre a de onde o texto veio.
    if (current.trim().length > 0 && !isOnlyOverlap(current, chunks)) flush()
  }

  return chunks
}

/** Parágrafos normalizados; um parágrafo longo demais é quebrado por frase. */
function pieces(text: string, limit: number): string[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    // Hifenização de fim de linha comum em PDF: "neuro-\npsicologia".
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)

  return paragraphs.flatMap((paragraph) => split(paragraph, limit))
}

function split(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph]

  const sentences = paragraph.match(/[^.!?;]+[.!?;]+["')\]]*\s*|[^.!?;]+$/g) ?? [paragraph]
  const out: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (sentence.length > limit) {
      if (current.length > 0) out.push(current.trim())
      current = ''
      for (let start = 0; start < sentence.length; start += limit) {
        out.push(sentence.slice(start, start + limit).trim())
      }
      continue
    }
    if (current.length + sentence.length > limit) {
      out.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim().length > 0) out.push(current.trim())

  return out.filter((piece) => piece.length > 0)
}

/** Fim do texto, começando numa fronteira de palavra. */
function tail(text: string, size: number): string {
  const slice = text.slice(-size)
  const space = slice.indexOf(' ')
  return space > 0 && space < slice.length - 1 ? slice.slice(space + 1) : slice
}

/** O que sobrou é só a sobreposição do trecho anterior — não vira trecho novo. */
function isOnlyOverlap(current: string, chunks: readonly Chunk[]): boolean {
  const last = chunks.at(-1)
  return last !== undefined && last.text.endsWith(current.trim())
}
