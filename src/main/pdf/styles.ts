/**
 * CSS de impressão dos relatórios (spec §7.2).
 *
 * Vive numa string, e não num arquivo `.css`, porque a janela de impressão roda
 * sob `default-src 'none'`: nada é buscado pela rede ou pelo disco, o estilo
 * viaja embutido no próprio HTML. `style-src 'unsafe-inline'` na CSP daquela
 * janela é o que permite isso — e é seguro ali porque a janela não executa
 * script algum.
 *
 * As fontes seguem a mesma lógica, um passo adiante: `font-src data:` na CSP e
 * o `@font-face` com o arquivo inteiro em base64, vindo de
 * `fonts.generated.ts`. Sem isso, o documento cairia na Helvetica do sistema —
 * que é o que ele fazia antes, e que dava a um laudo o mesmo peso tipográfico
 * de um formulário.
 *
 * A escolha é uma serifada para os títulos e a Inter para o corpo e as tabelas:
 * a serifada dá ao documento o registro de peça técnica, e a Inter tem
 * numerais tabulares, que é o que mantém uma coluna de escores alinhada.
 */

import { INTER_REGULAR, INTER_SEMIBOLD, SERIF_SEMIBOLD } from './fonts.generated'

const FONT_FACES = `
  @font-face {
    font-family: 'Inter';
    font-style: normal;
    font-weight: 400;
    font-display: block;
    src: url(data:font/woff2;base64,${INTER_REGULAR}) format('woff2');
  }

  @font-face {
    font-family: 'Inter';
    font-style: normal;
    font-weight: 600;
    font-display: block;
    src: url(data:font/woff2;base64,${INTER_SEMIBOLD}) format('woff2');
  }

  @font-face {
    font-family: 'Source Serif 4';
    font-style: normal;
    font-weight: 600;
    font-display: block;
    src: url(data:font/woff2;base64,${SERIF_SEMIBOLD}) format('woff2');
  }
`

export const REPORT_CSS = `
  ${FONT_FACES}

  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }

  :root {
    --ink: #1a202c;
    --muted: #4a5568;
    --line: #cbd5e0;
    --soft: #f7fafc;
    --zebra: #fbfcfd;
    --serif: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    --sans: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    color: var(--ink);
    font-family: var(--sans);
    font-size: 10pt;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Cabeçalho e rodapé de página são desenhados pelo printToPDF a partir dos
     templates em render.ts; este é o cabeçalho de conteúdo, na primeira página. */
  .doc-header {
    display: flex;
    gap: 10mm;
    align-items: center;
    border-bottom: 1.5pt solid var(--ink);
    padding-bottom: 4mm;
    margin-bottom: 7mm;
  }

  /* A imagem também é reduzida no upload (main/images/logo.ts); este limite é a
     segunda linha de defesa, para um perfil gravado antes disso. */
  .doc-header__logo {
    max-height: 22mm;
    max-width: 40mm;
    object-fit: contain;
  }

  .doc-header__identity { flex: 1; }

  .doc-header__name {
    font-family: var(--serif);
    font-size: 14pt;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0 0 1mm;
  }

  .doc-header__meta {
    margin: 0;
    color: var(--muted);
    font-size: 8.5pt;
  }

  .doc-title {
    font-family: var(--serif);
    font-size: 17pt;
    font-weight: 600;
    letter-spacing: -0.015em;
    margin: 0 0 5mm;
  }

  .patient-card {
    background: var(--soft);
    border: 0.5pt solid var(--line);
    border-radius: 2mm;
    padding: 4mm 5mm;
    margin-bottom: 7mm;
  }

  .patient-card dl {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2mm 6mm;
    margin: 0;
  }

  .patient-card dt {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .patient-card dd {
    margin: 0 0 1mm;
    font-size: 10pt;
  }

  .section { margin-bottom: 7mm; }

  .section__title {
    font-family: var(--serif);
    font-size: 12.5pt;
    font-weight: 600;
    margin: 0 0 2.5mm;
    padding-bottom: 1.2mm;
    border-bottom: 1pt solid var(--ink);
  }

  .section__subtitle {
    font-size: 10pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin: 0 0 1.5mm;
  }

  .section__note {
    color: var(--muted);
    font-size: 8.5pt;
    margin: 0 0 2.5mm;
  }

  .page-break-before { break-before: page; page-break-before: always; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
  }

  /* Cabeçalho repetido em tabela que atravessa páginas (§7.2). */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }

  th, td {
    border: 0.5pt solid var(--line);
    padding: 1.6mm 2.2mm;
    text-align: left;
    vertical-align: middle;
  }

  th {
    background: var(--soft);
    border-bottom-width: 1pt;
    border-bottom-color: var(--muted);
    font-weight: 600;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }

  /* Zebra: numa tabela de vinte subtestes é o que impede o olho de trocar de
     linha no meio da leitura. */
  tbody tr:nth-child(even) { background: var(--zebra); }

  td.numeric { text-align: right; font-variant-numeric: tabular-nums; }

  .classification {
    display: inline-block;
    padding: 0.6mm 2mm;
    border-radius: 1mm;
    font-size: 8pt;
    font-weight: 600;
    white-space: nowrap;
  }

  /* ── Visualização de resultados (§7.3) ─────────────────────────────────── */

  /* A tabela ocupa o espaço restante e o radar fica com a largura que declarou:
     o SVG do ECharts vem com width fixo, e deixá-lo encolher distorceria os
     rótulos que já foram posicionados na renderização. */
  .panorama {
    display: flex;
    align-items: flex-start;
    gap: 6mm;
  }

  .panorama__table { flex: 1; }

  .level-badge {
    display: inline-block;
    padding: 0.6mm 2mm;
    border-radius: 1mm;
    font-size: 8pt;
    font-weight: 600;
    white-space: nowrap;
    color: #ffffff;
  }

  .heat-bar {
    display: flex;
    width: 100%;
    height: 3mm;
    border-radius: 1.5mm;
    overflow: hidden;
    background: #edf2f7;
  }

  .heat-bar__part { display: block; height: 3mm; font-size: 0; }

  .level-inline {
    display: inline-flex;
    align-items: center;
    gap: 1.5mm;
    font-size: 8.5pt;
    color: var(--muted);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 1mm 4mm;
    margin: 2mm 0 0;
    font-size: 7.5pt;
    color: var(--muted);
  }

  .legend__item { display: inline-flex; align-items: center; gap: 1.2mm; }

  .legend__swatch {
    display: inline-block;
    width: 2.4mm;
    height: 2.4mm;
    border-radius: 0.5mm;
    flex: none;
  }

  .chart-figure {
    margin: 3mm 0 0;
    break-inside: avoid;
    page-break-inside: avoid;
    text-align: center;
  }

  .chart-figure svg { max-width: 100%; height: auto; }

  .chart-figure__caption {
    margin-top: 1mm;
    font-size: 7.5pt;
    color: var(--muted);
    text-align: left;
  }

  /* A função filha recua sob a raiz: a indentação é o que diz que a tabela
     pertence àquele bloco, e não é mais uma seção de mesmo nível. */
  .function-block {
    margin: 3mm 0 0;
    padding-left: 4mm;
    border-left: 0.3mm solid #e2e8f0;
  }

  .function-block__title {
    margin: 0 0 1.5mm;
    font-size: 9pt;
    font-weight: 600;
    color: var(--muted);
  }

  .indent-1 { padding-left: 5mm; }
  .indent-2 { padding-left: 10mm; }
  .indent-3 { padding-left: 15mm; }
  .indent-4 { padding-left: 20mm; }

  .tree-node { font-weight: 600; }
  .tree-leaf { font-weight: 400; }

  .empty {
    color: var(--muted);
    font-style: italic;
  }

  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .page-break { break-after: page; page-break-after: always; }

  .signature {
    margin-top: 16mm;
    text-align: center;
    break-inside: avoid;
  }

  .signature__line {
    width: 70mm;
    margin: 0 auto 2mm;
    border-top: 0.75pt solid var(--ink);
  }

  .signature__name { font-weight: 600; }
  .signature__meta { color: var(--muted); font-size: 9pt; }

  .delta-better { color: #2f855a; font-weight: 600; }
  .delta-worse { color: #c53030; font-weight: 600; }
  .delta-same { color: var(--muted); }

  /* Conteúdo vindo do editor de documentos (§9). */
  .doc-content h1 { font-family: var(--serif); font-size: 13.5pt; margin: 5mm 0 2mm; }
  .doc-content h2 { font-family: var(--serif); font-size: 12pt; margin: 4mm 0 2mm; }
  .doc-content h3 { font-size: 11pt; margin: 4mm 0 2mm; }
  .doc-content p { margin: 0 0 2.5mm; text-align: justify; }
  .doc-content ul, .doc-content ol { margin: 0 0 2.5mm 6mm; padding: 0; }
  .doc-content blockquote {
    margin: 0 0 2.5mm;
    padding-left: 4mm;
    border-left: 1pt solid var(--line);
    color: var(--muted);
  }
  .doc-content pre {
    background: var(--soft);
    padding: 2mm 3mm;
    border-radius: 1mm;
    font-size: 9pt;
    white-space: pre-wrap;
  }
  .doc-content img { max-width: 100%; }
  .doc-content hr { border: none; border-top: 0.5pt solid var(--line); margin: 4mm 0; }
  .doc-content table { margin-bottom: 3mm; }
`
