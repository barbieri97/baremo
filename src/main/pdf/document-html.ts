/**
 * Montagem e sanitização do HTML de impressão (spec §13.4).
 *
 * Separado de `render.ts` de propósito: ali entra `electron`, e um módulo que
 * importa `electron` não pode ser exercitado pelo Vitest, que roda em Node
 * puro. A segunda camada de defesa contra XSS mora aqui, então ela precisa ser
 * testável — `tests/security/print-html.spec.ts` é o gate.
 */

import DOMPurify from 'isomorphic-dompurify'

/**
 * CSP da janela de impressão (§13.4).
 *
 * Sem `script-src`: com `default-src 'none'`, script nenhum executa. `font-src
 * data:` existe para o `@font-face` embutido em base64 do `styles.ts` — a fonte
 * não pode vir da rede nem do disco, então viaja dentro do próprio CSS.
 */
export const PRINT_CSP =
  "default-src 'none'; img-src baremo-file: data:; style-src 'unsafe-inline'; font-src data:"

export interface PrintDocument {
  readonly title: string
  readonly bodyHtml: string
  readonly css: string
}

export function buildPrintDocument(options: PrintDocument): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">
<title>${escapeAttribute(options.title)}</title>
<style>${options.css}</style>
</head>
<body>${sanitizeBody(options.bodyHtml)}</body>
</html>`
}

/**
 * Terceira camada: mesmo o HTML que nós mesmos montamos passa pelo sanitizador.
 *
 * É o que protege o caminho do editor, onde parte do conteúdo veio de fora — e
 * não custa nada nos relatórios, onde não veio.
 */
export function sanitizeBody(bodyHtml: string): string {
  return DOMPurify.sanitize(bodyHtml, {
    // O perfil `svg` é o que deixa passar os gráficos do relatório de
    // resultados, que chegam como SVG inline renderizado pelo ECharts em modo
    // SSR (`pdf/charts.ts`). Sem ele o sanitizador removeria a figura inteira e
    // o laudo sairia com um buraco onde estava o gráfico.
    //
    // `svgFilters` fica FORA de propósito, e `foreignObject` é barrado abaixo:
    // é por dentro de um `foreignObject` que HTML arbitrário voltaria a entrar
    // por baixo de um `<svg>`.
    USE_PROFILES: { html: true, svg: true },
    // Esquemas permitidos: `baremo-file:` é o dos anexos do usuário e `data:`
    // cobre a logo do perfil. É esta lista que barra um `javascript:` — não uma
    // proibição de `href`, que quebraria os links dos documentos.
    //
    // As duas últimas alternativas NÃO são decoração, e removê-las quebra o
    // documento inteiro em silêncio. O DOMPurify aplica esta expressão ao valor
    // de TODO atributo que não esteja na lista de "URI safe" — não apenas aos
    // que carregam URI. Sem uma alternativa que aceite texto comum, `fill`,
    // `width`, `d` e `x` de um SVG (e qualquer atributo fora de class/style/id)
    // são descartados, e o gráfico chega ao laudo como uma forma invisível.
    // O formato é o da expressão padrão do DOMPurify, com a lista de esquemas
    // trocada pela nossa: `tests/security/print-html.spec.ts` fixa os dois
    // lados disso.
    ALLOWED_URI_REGEXP:
      /^(?:(?:baremo-file|https?|mailto|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'link',
      'foreignObject',
      // Os gráficos são gerados com `animation: false`; nenhum SVG legítimo
      // deste app anima. Barrar aqui impede que o `printToPDF` capture um
      // estado intermediário de uma animação que não deveria existir.
      'set',
      'animate',
      'animateTransform',
      'animateMotion'
    ],
    FORBID_ATTR: ['srcset', 'formaction', 'form', 'ping']
  })
}

export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}
