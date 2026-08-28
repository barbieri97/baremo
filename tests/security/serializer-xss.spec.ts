/**
 * GATE DE CI — XSS no serializador de documentos (spec §13.4, §13.5).
 *
 * Com a entrada do editor, conteúdo produzido ou COLADO pelo usuário passa a ser
 * renderizado num `BrowserWindow` para virar PDF. Este arquivo é o que garante
 * que a allowlist do serializador segura o vetor.
 *
 * A regra que estes testes fixam: **allowlist, não sanitização por remoção**. Um
 * nó ou marca que o serializador não conhece não é renderizado de forma alguma —
 * o comportamento padrão é descartar, não adivinhar.
 */

import { describe, expect, it } from 'vitest'
import { safeHref, safeImageSource, serializeDocument } from '../../src/main/pdf/serialize'
import type { SerializeContext } from '../../src/main/pdf/serialize'
import { escapeHtml } from '../../src/main/pdf/html'

const context: SerializeContext = {
  resolveToken: (token) => (token === 'paciente.nome' ? 'Maria da Silva' : null),
  renderResultsBlock: () => '<table class="results-block"></table>',
  renderChartBlock: () => '<svg></svg>',
  renderSignature: () => '<div class="signature"></div>'
}

function serialize(doc: unknown): string {
  return serializeDocument(doc, context)
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'doc', content: [{ type: 'paragraph', content }] }
}

describe('escape de texto', () => {
  it('escapa marcação em texto colado', () => {
    const html = serialize(paragraph({ type: 'text', text: '<script>alert(1)</script>' }))

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapa aspas e e-comercial', () => {
    const html = serialize(paragraph({ type: 'text', text: `" & ' < >` }))

    expect(html).toContain('&quot;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&#39;')
    expect(html).not.toMatch(/<(?!\/?p)/)
  })

  it('escapa tentativa de fechar atributo e injetar handler', () => {
    const html = serialize(paragraph({ type: 'text', text: '" onerror="alert(1)' }))
    expect(html).not.toContain('onerror="alert(1)"')
  })

  it('escapa texto dentro de bloco de código', () => {
    const html = serialize({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }]
        }
      ]
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

describe('allowlist de nós', () => {
  it('descarta nó desconhecido inteiro, com a subárvore', () => {
    const html = serialize({
      type: 'doc',
      content: [
        {
          type: 'scriptNode',
          content: [{ type: 'text', text: 'conteúdo malicioso' }]
        }
      ]
    })

    expect(html).toBe('')
    expect(html).not.toContain('conteúdo malicioso')
  })

  it('descarta nó forjado que imita um elemento HTML', () => {
    const html = serialize({
      type: 'doc',
      content: [{ type: 'iframe', attrs: { src: 'https://exemplo.com' } }]
    })
    expect(html).toBe('')
  })

  it('mantém os nós conhecidos ao redor de um desconhecido', () => {
    const html = serialize({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'antes' }] },
        { type: 'objectNode' },
        { type: 'paragraph', content: [{ type: 'text', text: 'depois' }] }
      ]
    })

    expect(html).toContain('antes')
    expect(html).toContain('depois')
    expect(html).not.toContain('objectNode')
  })

  it('limita o nível de heading ao intervalo válido', () => {
    const html = serialize({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 99 }, content: [{ type: 'text', text: 'T' }] }]
    })
    expect(html).toMatch(/<h2>/)
  })

  it('ignora alinhamento fora da allowlist', () => {
    const html = serialize({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center; background:url(javascript:alert(1))' },
          content: [{ type: 'text', text: 'x' }]
        }
      ]
    })
    expect(html).toBe('<p>x</p>')
  })
})

describe('allowlist de marcas', () => {
  it('descarta a marca desconhecida mas preserva o texto', () => {
    const html = serialize(
      paragraph({
        type: 'text',
        text: 'texto importante',
        marks: [{ type: 'evilMark', attrs: { onclick: 'alert(1)' } }]
      })
    )

    expect(html).toContain('texto importante')
    expect(html).not.toContain('evilMark')
    expect(html).not.toContain('onclick')
  })

  it('aplica as marcas conhecidas', () => {
    const html = serialize(
      paragraph({ type: 'text', text: 'negrito', marks: [{ type: 'bold' }] })
    )
    expect(html).toContain('<strong>negrito</strong>')
  })
})

describe('links', () => {
  it('bloqueia javascript: e mantém o texto', () => {
    const html = serialize(
      paragraph({
        type: 'text',
        text: 'clique aqui',
        marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]
      })
    )

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a ')
    expect(html).toContain('clique aqui')
  })

  it('bloqueia data: em href', () => {
    const html = serialize(
      paragraph({
        type: 'text',
        text: 'x',
        marks: [{ type: 'link', attrs: { href: 'data:text/html,<script>alert(1)</script>' } }]
      })
    )
    expect(html).not.toContain('<a ')
  })

  it('bloqueia esquemas exóticos', () => {
    for (const href of ['vbscript:msgbox(1)', 'file:///etc/passwd', 'about:blank']) {
      expect(safeHref(href)).toBeNull()
    }
  })

  it('bloqueia javascript: com espaços e caixa alternada', () => {
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull()
    expect(safeHref('  javascript:alert(1)')).toBeNull()
  })

  it('aceita os protocolos da allowlist', () => {
    expect(safeHref('https://exemplo.com/a')).toBe('https://exemplo.com/a')
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
  })
})

describe('imagens', () => {
  it('recusa src com javascript:', () => {
    const html = serialize({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }]
    })
    expect(html).toBe('')
  })

  it('recusa data: que não seja imagem', () => {
    expect(safeImageSource('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
  })

  it('recusa imagem remota — a janela de impressão não tem rede', () => {
    expect(safeImageSource('https://exemplo.com/a.png')).toBeNull()
  })

  it('aceita anexo do próprio app', () => {
    expect(safeImageSource('baremo-file://abc/')).toBe('baremo-file://abc/')
  })

  it('aceita data: de imagem', () => {
    const source = 'data:image/png;base64,iVBORw0KGgo='
    expect(safeImageSource(source)).toBe(source)
  })

  it('escapa o texto alternativo', () => {
    const html = serialize({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: '" onerror="alert(1)' }
        }
      ]
    })
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).toContain('&quot;')
  })
})

describe('atributos reconstruídos, nunca copiados', () => {
  it('recusa família de fonte fora da allowlist', () => {
    const html = serialize(
      paragraph({
        type: 'text',
        text: 'x',
        marks: [{ type: 'textStyle', attrs: { fontFamily: 'x;background:url(javascript:1)' } }]
      })
    )
    expect(html).not.toContain('javascript')
    expect(html).toBe('<p>x</p>')
  })

  it('recusa cor que não seja hexadecimal', () => {
    const html = serialize(
      paragraph({
        type: 'text',
        text: 'x',
        marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(javascript:1)' } }]
      })
    )
    expect(html).toBe('<p>x</p>')
  })

  it('limita colspan e rowspan a valores plausíveis', () => {
    const html = serialize({
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colspan: 999999, rowspan: -1 },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c' }] }]
                }
              ]
            }
          ]
        }
      ]
    })

    expect(html).not.toContain('999999')
    expect(html).not.toContain('rowspan="-1"')
  })
})

describe('tokens de variável', () => {
  it('resolve o token localmente', () => {
    const html = serialize(paragraph({ type: 'variable', attrs: { token: 'paciente.nome' } }))
    expect(html).toContain('Maria da Silva')
  })

  it('escapa o valor resolvido do token', () => {
    const injecting: SerializeContext = {
      ...context,
      resolveToken: () => '<script>alert(1)</script>'
    }
    const html = serializeDocument(
      paragraph({ type: 'variable', attrs: { token: 'paciente.nome' } }),
      injecting
    )
    expect(html).not.toContain('<script>')
  })

  it('mostra o token não resolvido em vez de sumir com ele', () => {
    const html = serialize(paragraph({ type: 'variable', attrs: { token: 'inexistente.campo' } }))
    expect(html).toContain('{{inexistente.campo}}')
  })
})

describe('entradas degeneradas', () => {
  it('trata documento nulo', () => {
    expect(serialize(null)).toBe('')
    expect(serialize(undefined)).toBe('')
  })

  it('trata JSON que não é um documento', () => {
    expect(serialize({ foo: 'bar' })).toBe('')
    expect(serialize([1, 2, 3])).toBe('')
    expect(serialize('texto solto')).toBe('')
  })

  it('trata conteúdo com nós nulos', () => {
    expect(() => serialize({ type: 'doc', content: [null, undefined] })).not.toThrow()
  })
})

describe('escapeHtml', () => {
  it('cobre os cinco caracteres perigosos', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('trata null e undefined como string vazia', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})
