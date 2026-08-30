/**
 * GATE DE CI — sanitização do HTML de impressão (spec §13.4).
 *
 * A visualização de resultados fez o sanitizador aceitar SVG inline, para que
 * os gráficos do ECharts cheguem ao laudo. Isso alarga a superfície: o perfil
 * `svg` do DOMPurify traz consigo elementos que, mal configurados, reabrem a
 * porta que a camada existe para fechar — `foreignObject` volta a permitir HTML
 * arbitrário por baixo de um `<svg>`, e `<script>` dentro de SVG é `<script>`
 * do mesmo jeito.
 *
 * A janela de impressão roda com `javascript: false` e `default-src 'none'`, o
 * que já tornaria um script inerte. Estes testes existem para que a defesa não
 * dependa de uma única camada: se um dia aquela janela ganhar JavaScript, é
 * aqui que o vetor continua barrado.
 */

import { describe, expect, it } from 'vitest'
import { buildPrintDocument, PRINT_CSP, sanitizeBody } from '../../src/main/pdf/document-html'

describe('SVG dos gráficos', () => {
  it('preserva o desenho legítimo do ECharts', () => {
    // Sem isto, o laudo sairia com um buraco no lugar do gráfico — e sem erro
    // nenhum, porque remover é o comportamento normal do sanitizador.
    const svg = sanitizeBody(
      '<figure class="chart-figure"><svg width="640" height="300" xmlns="http://www.w3.org/2000/svg">' +
        '<g><rect x="10" y="20" width="30" height="40" fill="#2b6cb0"></rect>' +
        '<path d="M0 0L10 10" stroke="#cbd5e0"></path>' +
        '<text x="5" y="15" font-size="10">Vocabulário</text>' +
        '<circle cx="4" cy="4" r="2"></circle>' +
        '<polyline points="0,0 5,5"></polyline></g></svg></figure>'
    )

    expect(svg).toContain('<svg')
    expect(svg).toContain('<rect')
    expect(svg).toContain('<path')
    expect(svg).toContain('Vocabulário')
    expect(svg).toContain('#2b6cb0')
  })

  it('remove script escondido dentro do SVG', () => {
    const svg = sanitizeBody('<svg><script>alert(1)</script><rect /></svg>')

    expect(svg.toLowerCase()).not.toContain('<script')
    expect(svg).not.toContain('alert(1)')
  })

  it('remove foreignObject — a porta de volta para HTML arbitrário', () => {
    const svg = sanitizeBody(
      '<svg><foreignObject><iframe src="https://exemplo.test"></iframe></foreignObject></svg>'
    )

    expect(svg.toLowerCase()).not.toContain('foreignobject')
    expect(svg.toLowerCase()).not.toContain('<iframe')
  })

  it('remove os elementos de animação', () => {
    // Os gráficos são gerados com `animation: false`. Um SVG animado no laudo
    // seria capturado pelo printToPDF num estado intermediário qualquer.
    const svg = sanitizeBody(
      '<svg><rect><animate attributeName="width" to="100" /><set to="9" /></rect>' +
        '<animateTransform type="rotate" /></svg>'
    )

    expect(svg).not.toContain('<animate')
    expect(svg).not.toContain('<set')
    expect(svg).not.toContain('animateTransform')
  })

  it('remove handler de evento em elemento SVG', () => {
    const svg = sanitizeBody('<svg><rect onload="alert(1)" onclick="alert(2)" /></svg>')

    expect(svg).not.toContain('onload')
    expect(svg).not.toContain('onclick')
  })

  it('recusa javascript: dentro de um link SVG', () => {
    const svg = sanitizeBody('<svg><a xlink:href="javascript:alert(1)"><rect /></a></svg>')
    expect(svg).not.toContain('javascript:')
  })
})

describe('o que já valia continua valendo', () => {
  it('remove script, iframe e style do corpo', () => {
    const html = sanitizeBody(
      '<p>ok</p><script>alert(1)</script><iframe></iframe><style>*{}</style>'
    )

    expect(html).toContain('<p>ok</p>')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html.toLowerCase()).not.toContain('<iframe')
    expect(html.toLowerCase()).not.toContain('<style')
  })

  it('preserva os links dos documentos do editor', () => {
    // Regressão: barrar `href` para fechar o vetor do SVG teria quebrado todo
    // link escrito no editor. Quem barra `javascript:` é a lista de esquemas.
    const html = sanitizeBody('<p><a href="https://exemplo.test">referência</a></p>')

    expect(html).toContain('href="https://exemplo.test"')
    expect(html).toContain('referência')
  })

  it('preserva a logo em data URI e os anexos em baremo-file:', () => {
    const html = sanitizeBody(
      '<img src="data:image/png;base64,iVBORw0KGgo=" /><img src="baremo-file://abc/x.png" />'
    )

    expect(html).toContain('data:image/png;base64')
    expect(html).toContain('baremo-file://abc/x.png')
  })

  it('recusa esquema fora da lista', () => {
    const html = sanitizeBody(
      '<a href="javascript:alert(1)">x</a><a href="file:///etc/passwd">y</a>' +
        '<a href="vbscript:msgbox">z</a>'
    )

    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('file:///')
    expect(html).not.toContain('vbscript:')
  })

  it('preserva atributo de valor comum, que não é URI', () => {
    // Regressão real: a expressão de URI do DOMPurify é aplicada ao valor de
    // TODO atributo fora da lista "URI safe", não só aos que carregam URI. Uma
    // lista de esquemas sem alternativa para texto comum descarta `fill`,
    // `width` e `d` — e o gráfico chega ao laudo como forma invisível, sem
    // erro nenhum para denunciar.
    const html = sanitizeBody('<table><tr><td colspan="3" class="numeric">7</td></tr></table>')

    expect(html).toContain('colspan="3"')
    expect(html).toContain('class="numeric"')
  })
})

describe('documento montado', () => {
  it('carrega a CSP da janela de impressão', () => {
    const document = buildPrintDocument({ title: 'Relatório', bodyHtml: '<p>x</p>', css: 'p{}' })

    expect(document).toContain(PRINT_CSP)
    expect(PRINT_CSP).toContain("default-src 'none'")
    // A fonte embutida em base64 depende disto; sem `font-src`, o `@font-face`
    // cai no `default-src 'none'` e o laudo volta para a Helvetica do sistema.
    expect(PRINT_CSP).toContain('font-src data:')
  })

  it('escapa o título antes de colocá-lo no documento', () => {
    const document = buildPrintDocument({
      title: '</title><script>alert(1)</script>',
      bodyHtml: '',
      css: ''
    })

    expect(document).not.toContain('<script>alert(1)</script>')
    expect(document).toContain('&lt;script&gt;')
  })
})
