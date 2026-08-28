/**
 * Serializador TipTap JSON → HTML (spec §9.4, §13.4).
 *
 * O conteúdo do editor é o único caminho do app em que texto colado pelo
 * usuário — potencialmente vindo de um PDF, de um site, de qualquer lugar —
 * termina renderizado num `BrowserWindow`. Por isso o documento é guardado como
 * JSON, nunca como HTML, e o HTML só nasce aqui, por uma **allowlist explícita**:
 *
 *  - nó cujo `type` não está em `NODE_RENDERERS` é descartado, junto com o
 *    subárvore, e não renderizado;
 *  - marca cujo `type` não está em `MARK_RENDERERS` é ignorada, mas o texto que
 *    ela envolve permanece;
 *  - todo texto passa por escape;
 *  - todo atributo é reconstruído a partir de valores validados, nunca copiado.
 *
 * É allowlist, e não sanitização por remoção: um nó novo, desconhecido, sai de
 * fora por padrão. Depois disto, `render.ts` ainda passa DOMPurify — defesa em
 * profundidade, não a defesa principal.
 */

import { escapeHtml, html, raw, safeColor, toString } from './html'
import type { SafeHtml } from './html'

export interface TiptapNode {
  readonly type?: string
  readonly attrs?: Record<string, unknown>
  readonly content?: readonly TiptapNode[]
  readonly marks?: readonly TiptapMark[]
  readonly text?: string
}

export interface TiptapMark {
  readonly type?: string
  readonly attrs?: Record<string, unknown>
}

/** Contexto resolvido no momento da exportação, para os nós dinâmicos. */
export interface SerializeContext {
  /** Resolve `{{paciente.nome}}` e afins — §9.2. Roda LOCALMENTE. */
  readonly resolveToken: (token: string) => string | null
  /** Tabela do `bloco-resultados`, lida do banco na renderização. */
  readonly renderResultsBlock: (attrs: Record<string, unknown>) => string
  /** SVG do `bloco-grafico`. */
  readonly renderChartBlock: (attrs: Record<string, unknown>) => string
  /** Bloco de assinatura. */
  readonly renderSignature: () => string
}

type NodeRenderer = (node: TiptapNode, context: SerializeContext) => SafeHtml

const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])

function alignStyle(attrs: Record<string, unknown> | undefined): SafeHtml | null {
  const value = attrs?.['textAlign']
  if (typeof value !== 'string' || !TEXT_ALIGNMENTS.has(value)) return null
  return raw(` style="text-align:${value}"`)
}

function children(node: TiptapNode, context: SerializeContext): SafeHtml {
  return raw((node.content ?? []).map((child) => toString(renderNode(child, context))).join(''))
}

const HEADING_LEVELS = new Set([1, 2, 3, 4, 5, 6])

const NODE_RENDERERS: Readonly<Record<string, NodeRenderer>> = {
  doc: (node, context) => children(node, context),

  paragraph: (node, context) =>
    html`<p${alignStyle(node.attrs)}>${children(node, context)}</p>`,

  heading: (node, context) => {
    const rawLevel = node.attrs?.['level']
    const level = HEADING_LEVELS.has(Number(rawLevel)) ? Number(rawLevel) : 2
    return html`<h${raw(String(level))}${alignStyle(node.attrs)}>${children(node, context)}</h${raw(
      String(level)
    )}>`
  },

  text: (node) => {
    // O texto é escapado ANTES de receber as marcas; as marcas só envolvem.
    let out: SafeHtml = raw(escapeHtml(node.text ?? ''))
    for (const mark of node.marks ?? []) {
      const renderer = mark.type ? MARK_RENDERERS[mark.type] : undefined
      // Marca desconhecida some, mas o texto que ela envolvia fica.
      if (renderer) out = renderer(out, mark.attrs ?? {})
    }
    return out
  },

  hardBreak: () => raw('<br />'),
  horizontalRule: () => raw('<hr />'),

  bulletList: (node, context) => html`<ul>${children(node, context)}</ul>`,
  orderedList: (node, context) => {
    const start = Number(node.attrs?.['start'])
    const attr = Number.isInteger(start) && start > 1 ? raw(` start="${start}"`) : null
    return html`<ol${attr}>${children(node, context)}</ol>`
  },
  listItem: (node, context) => html`<li>${children(node, context)}</li>`,

  taskList: (node, context) => html`<ul class="task-list">${children(node, context)}</ul>`,
  taskItem: (node, context) =>
    html`<li class="task-item">${node.attrs?.['checked'] === true ? '☑ ' : '☐ '}${children(
      node,
      context
    )}</li>`,

  blockquote: (node, context) => html`<blockquote>${children(node, context)}</blockquote>`,

  codeBlock: (node, context) => html`<pre><code>${children(node, context)}</code></pre>`,

  table: (node, context) => html`<table>${children(node, context)}</table>`,
  tableRow: (node, context) => html`<tr>${children(node, context)}</tr>`,
  tableCell: (node, context) => cell('td', node, context),
  tableHeader: (node, context) => cell('th', node, context),

  image: (node) => {
    const src = safeImageSource(node.attrs?.['src'])
    if (src === null) return raw('')
    const alt = typeof node.attrs?.['alt'] === 'string' ? node.attrs['alt'] : ''
    return html`<img src="${src}" alt="${alt}" />`
  },

  // ─── Nós customizados do produto (§9.2) ───────────────────────────────────

  /**
   * Token resolvido LOCALMENTE na exportação.
   *
   * É isto que reconcilia a pseudonimização do §10.3 com a redação de
   * documentos: o agente escreve `{{paciente.nome}}`, e o nome real só entra
   * aqui, no processo principal, sem nunca ter saído da máquina.
   */
  variable: (node, context) => {
    const token = node.attrs?.['token']
    if (typeof token !== 'string') return raw('')
    const value = context.resolveToken(token)
    return value === null
      ? html`<span class="token-unresolved">${`{{${token}}}`}</span>`
      : html`${value}`
  },

  pageBreak: () => raw('<div class="page-break"></div>'),

  resultsBlock: (node, context) => raw(context.renderResultsBlock(node.attrs ?? {})),
  chartBlock: (node, context) => raw(context.renderChartBlock(node.attrs ?? {})),
  signature: (_node, context) => raw(context.renderSignature())
}

function cell(tag: 'td' | 'th', node: TiptapNode, context: SerializeContext): SafeHtml {
  const colspan = positiveInteger(node.attrs?.['colspan'])
  const rowspan = positiveInteger(node.attrs?.['rowspan'])
  return html`<${raw(tag)}${colspan !== null && colspan > 1 ? raw(` colspan="${colspan}"`) : null}${
    rowspan !== null && rowspan > 1 ? raw(` rowspan="${rowspan}"`) : null
  }>${children(node, context)}</${raw(tag)}>`
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null
}

type MarkRenderer = (inner: SafeHtml, attrs: Record<string, unknown>) => SafeHtml

const MARK_RENDERERS: Readonly<Record<string, MarkRenderer>> = {
  bold: (inner) => html`<strong>${inner}</strong>`,
  italic: (inner) => html`<em>${inner}</em>`,
  underline: (inner) => html`<u>${inner}</u>`,
  strike: (inner) => html`<s>${inner}</s>`,
  subscript: (inner) => html`<sub>${inner}</sub>`,
  superscript: (inner) => html`<sup>${inner}</sup>`,
  code: (inner) => html`<code>${inner}</code>`,

  highlight: (inner, attrs) => {
    const color = safeColor(attrs['color'] as string | undefined, '#fef08a')
    return html`<mark style="background-color:${raw(color)}">${inner}</mark>`
  },

  textStyle: (inner, attrs) => {
    const declarations: string[] = []

    const color = attrs['color']
    if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) {
      declarations.push(`color:${color}`)
    }

    // A família de fonte é reconstruída a partir de uma allowlist de nomes: um
    // valor livre entraria direto num atributo `style`.
    const fontFamily = attrs['fontFamily']
    if (typeof fontFamily === 'string' && ALLOWED_FONTS.has(fontFamily)) {
      declarations.push(`font-family:${fontFamily}`)
    }

    if (declarations.length === 0) return inner
    return html`<span style="${raw(declarations.join(';'))}">${inner}</span>`
  },

  /**
   * Link com allowlist de protocolo (§9.2): `javascript:` fica de fora, e
   * qualquer esquema não listado também.
   */
  link: (inner, attrs) => {
    const href = safeHref(attrs['href'])
    if (href === null) return inner
    return html`<a href="${href}">${inner}</a>`
  }
}

const ALLOWED_FONTS = new Set([
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'serif',
  'sans-serif',
  'monospace'
])

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

/**
 * Imagens vêm de duas fontes legítimas: um anexo do próprio app
 * (`baremo-file://`) ou um `data:` de tipo de imagem. Qualquer outra coisa —
 * inclusive `http(s)` — é recusada: a janela de impressão roda sem rede, e
 * aceitar URL externa só criaria expectativa que o PDF não cumpriria.
 */
export function safeImageSource(value: unknown): string | null {
  if (typeof value !== 'string') return null

  if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) {
    return value
  }

  try {
    const url = new URL(value)
    return url.protocol === 'baremo-file:' ? url.toString() : null
  } catch {
    return null
  }
}

function renderNode(node: TiptapNode, context: SerializeContext): SafeHtml {
  if (typeof node !== 'object' || node === null) return raw('')

  const type = node.type
  if (typeof type !== 'string') return raw('')

  const renderer = NODE_RENDERERS[type]
  // Nó fora da allowlist: descartado inteiro, com a subárvore. Não renderizar é
  // o comportamento correto — renderizar "só o texto" de um nó desconhecido
  // seria adivinhar a intenção de algo que não sabemos o que é.
  if (!renderer) return raw('')

  return renderer(node, context)
}

/** Converte o documento inteiro em HTML. */
export function serializeDocument(doc: unknown, context: SerializeContext): string {
  if (typeof doc !== 'object' || doc === null) return ''
  return toString(renderNode(doc as TiptapNode, context))
}

/** Texto plano do documento — usado pela tool `ler_documento` (§10.6). */
export function extractPlainText(doc: unknown): string {
  const parts: string[] = []

  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const typed = node as TiptapNode

    if (typed.type === 'text' && typeof typed.text === 'string') {
      parts.push(typed.text)
    }
    if (typed.type === 'variable' && typeof typed.attrs?.['token'] === 'string') {
      parts.push(`{{${String(typed.attrs['token'])}}}`)
    }

    for (const child of typed.content ?? []) walk(child)

    // Blocos terminam parágrafo: sem isso o texto plano vira uma linha só.
    if (typed.type && BLOCK_TYPES.has(typed.type)) parts.push('\n')
  }

  walk(doc)

  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'tableRow',
  'horizontalRule',
  'pageBreak'
])

/** Exposto para os testes de segurança: os tipos aceitos pela allowlist. */
export const ALLOWED_NODE_TYPES = Object.freeze(Object.keys(NODE_RENDERERS))
export const ALLOWED_MARK_TYPES = Object.freeze(Object.keys(MARK_RENDERERS))
