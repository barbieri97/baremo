/**
 * Conversão do Markdown simples produzido pelo agente para JSON do TipTap.
 *
 * O modelo devolve texto, e o editor guarda JSON (§9.4). Um parser mínimo e
 * fechado — títulos, listas, citação e parágrafos com ênfase e tokens — é
 * preferível a uma dependência de Markdown completo: tudo que não está aqui
 * simplesmente vira texto, e nada do que o modelo escreve consegue produzir um
 * nó que o serializador não conheça.
 */

interface TiptapJson {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapJson[]
  marks?: { type: string }[]
  text?: string
}

const TOKEN_PATTERN = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gi
const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g

export function markdownToTiptap(markdown: string): TiptapJson {
  const blocks: TiptapJson[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')

  let listBuffer: { ordered: boolean; items: string[] } | null = null
  let paragraphBuffer: string[] = []

  const flushParagraph = (): void => {
    if (paragraphBuffer.length === 0) return
    blocks.push({ type: 'paragraph', content: inlineContent(paragraphBuffer.join(' ')) })
    paragraphBuffer = []
  }

  const flushList = (): void => {
    if (listBuffer === null) return
    blocks.push({
      type: listBuffer.ordered ? 'orderedList' : 'bulletList',
      content: listBuffer.items.map((item) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inlineContent(item) }]
      }))
    })
    listBuffer = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'heading',
        attrs: { level: Math.min(heading[1]!.length, 3) },
        content: inlineContent(heading[2]!)
      })
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      flushParagraph()
      if (listBuffer === null || listBuffer.ordered) {
        flushList()
        listBuffer = { ordered: false, items: [] }
      }
      listBuffer.items.push(bullet[1]!)
      continue
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (ordered) {
      flushParagraph()
      if (listBuffer === null || !listBuffer.ordered) {
        flushList()
        listBuffer = { ordered: true, items: [] }
      }
      listBuffer.items.push(ordered[1]!)
      continue
    }

    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: inlineContent(quote[1]!) }]
      })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph()
      flushList()
      blocks.push({ type: 'horizontalRule' })
      continue
    }

    flushList()
    paragraphBuffer.push(trimmed)
  }

  flushParagraph()
  flushList()

  return {
    type: 'doc',
    content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
  }
}

/**
 * Divide o texto em nós de texto, marcas de ênfase e nós `variable`.
 *
 * Os tokens viram o nó `variable` do §9.2 — resolvido localmente na exportação.
 * É o que fecha o ciclo da pseudonimização: o agente escreve o token, o editor
 * põe o nome real, e o nome nunca sai da máquina.
 */
function inlineContent(text: string): TiptapJson[] {
  const nodes: TiptapJson[] = []

  const pushStyled = (segment: string): void => {
    if (segment.length === 0) return

    const bold = /^(\*\*|__)([\s\S]+)\1$/.exec(segment)
    if (bold) {
      pushTokenized(nodes, bold[2]!, [{ type: 'bold' }])
      return
    }

    const italic = /^(\*|_)([\s\S]+)\1$/.exec(segment)
    if (italic) {
      pushTokenized(nodes, italic[2]!, [{ type: 'italic' }])
      return
    }

    pushTokenized(nodes, segment, [])
  }

  let lastIndex = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) pushStyled(text.slice(lastIndex, index))
    pushStyled(match[0])
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) pushStyled(text.slice(lastIndex))

  return nodes.length > 0 ? nodes : [{ type: 'text', text: '' }]
}

function pushTokenized(
  nodes: TiptapJson[],
  text: string,
  marks: { type: string }[]
): void {
  let lastIndex = 0

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      pushText(nodes, text.slice(lastIndex, index), marks)
    }
    nodes.push({ type: 'variable', attrs: { token: match[1]!.toLowerCase() } })
    lastIndex = index + match[0].length
  }

  if (lastIndex < text.length) pushText(nodes, text.slice(lastIndex), marks)
}

function pushText(nodes: TiptapJson[], text: string, marks: { type: string }[]): void {
  if (text.length === 0) return
  nodes.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text })
}
