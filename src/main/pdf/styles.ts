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
 *
 * Duas famílias de estilo convivem aqui, e é deliberado:
 *
 *  - a **folha clássica** (`.doc-header`, `.patient-card`, `.section`, `table`)
 *    veste o relatório comparativo e a exportação de documento do editor;
 *  - a **folha de tela** (`.cover`, `.card-grid`, `.fn-card`, `.chart-card`,
 *    `.table-card`) veste o relatório de resultados, e reproduz no papel o
 *    desenho de `ResultsView.vue` — cartão, barra de calor e selo coloridos.
 *
 * As medidas da segunda saem de uma conta só: a largura útil da página é de
 * ~179mm (A4 de 210mm menos as margens de 0,6pol de cada lado aplicadas pelo
 * `printToPDF`), e três colunas com 3mm de vão dão ~57,6mm por cartão — a mesma
 * largura que o cartão tem na tela. Não é coincidência: é o motivo de a grade
 * ser de três.
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

  /* Os tokens são os mesmos de \`renderer/src/assets/main.css\`, copiados e não
     importados: o Tailwind não chega aqui, e um laudo que mudasse de cor porque
     alguém mexeu no tema da interface seria pior do que a duplicação. */
  :root {
    --ink: #1a202c;
    --ink-700: #2d3748;
    --muted: #4a5568;
    --ink-500: #718096;
    --ink-400: #a0aec0;
    --line: #cbd5e0;
    --border: #e2e8f0;
    --wash: #f1f5f9;
    --soft: #f7fafc;
    --zebra: #fbfcfd;
    --danger: #c53030;
    --warn-bg: #fffaf0;
    --warn-line: #feebc8;
    --warn-ink: #7b341e;
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

  .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  .page-break { break-after: page; page-break-after: always; }
  .page-break-before { break-before: page; page-break-before: always; }

  .empty {
    color: var(--ink-400);
    font-style: italic;
  }

  /* ═══ Folha clássica: comparativo e documentos ═══════════════════════════ */

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

  td.numeric, th.numeric { text-align: right; font-variant-numeric: tabular-nums; }

  .indent-1 { padding-left: 5mm; }
  .indent-2 { padding-left: 10mm; }
  .indent-3 { padding-left: 15mm; }
  .indent-4 { padding-left: 20mm; }

  .delta-better { color: #2f855a; font-weight: 600; }
  .delta-worse { color: #c53030; font-weight: 600; }
  .delta-same { color: var(--muted); }

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

  /* Selo da faixa de classificação — a cor vem do cadastro, e o texto escolhe
     preto ou branco pelo contraste (§5). Vale nas duas folhas. */
  .classification {
    display: inline-block;
    padding: 0.6mm 2mm;
    border-radius: 1mm;
    font-size: 8pt;
    font-weight: 600;
    white-space: nowrap;
  }

  /* ═══ Folha de tela: relatório de resultados (§7.3) ══════════════════════ */

  /* ── Capa ─────────────────────────────────────────────────────────────── */

  .cover { break-after: page; page-break-after: always; }

  .cover__letterhead {
    display: flex;
    gap: 8mm;
    align-items: center;
    border-bottom: 1pt solid var(--ink);
    padding-bottom: 4mm;
    margin-bottom: 14mm;
  }

  .cover__logo {
    max-height: 22mm;
    max-width: 40mm;
    object-fit: contain;
  }

  .cover__identity { flex: 1; }

  .cover__professional {
    font-family: var(--serif);
    font-size: 13pt;
    font-weight: 600;
    margin: 0 0 1mm;
  }

  .cover__contact {
    margin: 0;
    color: var(--muted);
    font-size: 8.5pt;
  }

  .cover__eyebrow {
    margin: 0 0 2mm;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-500);
  }

  .cover__title {
    font-family: var(--serif);
    font-size: 22pt;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin: 0 0 2mm;
  }

  .cover__meta {
    margin: 0 0 12mm;
    color: var(--muted);
    font-size: 10pt;
  }

  .cover__block { margin: 0 0 7mm; }

  /* Sem \`break-inside: avoid\` de propósito: uma queixa longa passa da
     altura da página, e o Chromium recortaria o que não coubesse. O que se
     evita aqui é o título órfão no pé da página. */
  .cover__block-title {
    break-after: avoid;
    page-break-after: avoid;
    margin: 0 0 2.5mm;
    padding-bottom: 1.2mm;
    border-bottom: 0.3mm solid var(--border);
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-500);
  }

  /* O texto veio de um \`textarea\`: as quebras que o profissional digitou são
     dele, e colapsá-las juntaria num bloco só o que ele escreveu apartado. */
  .cover__text {
    margin: 0;
    font-size: 10pt;
    white-space: pre-wrap;
    text-align: justify;
  }

  .data-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3.5mm 6mm;
    margin: 0;
  }

  .data-grid__item { break-inside: avoid; }

  .data-grid dt {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-500);
    margin-bottom: 0.6mm;
  }

  .data-grid dd {
    margin: 0;
    font-size: 10pt;
  }

  /* ── Seções e avisos ──────────────────────────────────────────────────── */

  .screen-section { margin: 0 0 9mm; }

  .screen-section__title {
    font-family: var(--serif);
    font-size: 14pt;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0 0 1.5mm;
    break-after: avoid;
  }

  .screen-section__note {
    margin: 0 0 3.5mm;
    font-size: 8.5pt;
    color: var(--ink-500);
  }

  .notice {
    border-radius: 2mm;
    padding: 3mm 4mm;
    margin: 0 0 6mm;
    font-size: 9pt;
    break-inside: avoid;
  }

  .notice--warn {
    border: 0.3mm solid var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  /* ── Panorama: a grade de cartões ─────────────────────────────────────── */

  .card-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3mm;
  }

  .fn-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: #ffffff;
    padding: 3mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .fn-card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2mm;
    margin-bottom: 2.5mm;
  }

  .fn-card__identity { min-width: 0; }

  .fn-card__name {
    margin: 0;
    font-size: 9.5pt;
    font-weight: 600;
    line-height: 1.25;
    color: var(--ink);
  }

  .fn-card__count {
    margin: 0.7mm 0 0;
    font-size: 7.5pt;
    color: var(--ink-500);
  }

  .fn-card__level {
    flex: none;
    border-radius: 1mm;
    padding: 1mm 1.8mm;
    font-size: 12.5pt;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .fn-card__foot {
    margin: 2.5mm 0 0;
    font-size: 7.5pt;
    line-height: 1.35;
    color: var(--ink-500);
  }

  .fn-card__foot--danger { color: var(--danger); }

  /* ── Barra de calor e legenda ─────────────────────────────────────────── */

  .heat-bar {
    display: flex;
    width: 100%;
    height: 2.6mm;
    border-radius: 1.3mm;
    overflow: hidden;
    background: var(--wash);
  }

  .heat-bar__part { display: block; height: 100%; font-size: 0; }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 1mm 4mm;
    margin: 3.5mm 0 0;
    font-size: 7.5pt;
    color: var(--ink-500);
  }

  .legend__item { display: inline-flex; align-items: center; gap: 1.2mm; }

  .legend__swatch {
    display: inline-block;
    width: 2.4mm;
    height: 2.4mm;
    border-radius: 0.5mm;
    flex: none;
  }

  /* ── Moldura de gráfico ───────────────────────────────────────────────── */

  .chart-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: #ffffff;
    padding: 3mm;
    margin: 4mm 0 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .chart-card__head { margin: 0 0 2mm; }

  .chart-card__title {
    margin: 0;
    font-size: 9.5pt;
    font-weight: 600;
    color: var(--ink);
  }

  .chart-card__subtitle {
    margin: 0.7mm 0 0;
    font-size: 7.5pt;
    color: var(--ink-500);
  }

  .chart-card__canvas { text-align: center; }

  /* O SVG do ECharts sai com \`viewBox\`, então encolher não deforma: é o que
     permite dimensionar o gráfico em pixels no SSR e deixar a página decidir. */
  .chart-card__canvas svg { max-width: 100%; height: auto; }

  /* O radar do panorama é AMPLIADO até a largura do conteúdo. Como o SVG traz
     \`viewBox\`, a figura escala inteira — texto junto. Em tamanho natural os
     nomes das funções sairiam a 6,4pt: legíveis com esforço, que é justamente
     o que um gráfico de relance não pode exigir. */
  .chart-card--wide .chart-card__canvas svg { display: block; width: 100%; height: auto; }

  /* ── Detalhe por função ───────────────────────────────────────────────── */

  .fn-group { margin: 0 0 7mm; }

  .fn-group__head {
    display: flex;
    align-items: center;
    gap: 3mm;
    margin: 0 0 2.5mm;
    break-after: avoid;
  }

  .fn-group__name {
    margin: 0;
    font-size: 10.5pt;
    font-weight: 600;
    color: var(--ink);
  }

  .fn-group__bar, .fn-detail__bar {
    display: block;
    flex: none;
    width: 34mm;
  }

  .fn-group__count {
    font-size: 8pt;
    color: var(--ink-500);
  }

  /* A função filha recua sob a raiz: a indentação é o que diz que a tabela
     pertence àquele bloco, e não é mais uma seção de mesmo nível. */
  .fn-detail {
    margin: 0 0 5mm;
    padding-left: 3.5mm;
    border-left: 0.3mm solid var(--border);
  }

  .fn-detail__head {
    display: flex;
    align-items: center;
    gap: 3mm;
    margin: 0 0 1.8mm;
    break-after: avoid;
  }

  .fn-detail__name {
    margin: 0;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-500);
  }

  .level-chip {
    display: inline-flex;
    align-items: center;
    gap: 1.5mm;
    font-size: 7.5pt;
    color: var(--muted);
  }

  .level-chip__swatch {
    display: inline-block;
    width: 2.4mm;
    height: 2.4mm;
    border-radius: 0.5mm;
    flex: none;
  }

  /* ── Tabelas emolduradas ──────────────────────────────────────────────── */

  /* Sem \`overflow: hidden\` de propósito, apesar do raio: uma tabela longa
     atravessa a página, e recortar o que passa da moldura apagaria linhas. */
  .table-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: #ffffff;
  }

  .table-card__caption {
    margin: 0;
    padding: 2mm 3mm;
    border-bottom: 0.3mm solid var(--border);
    background: var(--soft);
    font-size: 9.5pt;
    font-weight: 600;
    color: var(--ink);
  }

  .table-card__flag {
    margin-left: 2mm;
    font-size: 7.5pt;
    font-weight: 400;
    color: var(--warn-ink);
  }

  /* A tabela da tela não tem grade nem zebra: as linhas se separam por um fio
     só, e a hierarquia fica com o cabeçalho. É mais leve ao lado dos cartões. */
  .grid-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
  }

  .grid-table thead th {
    border: none;
    border-bottom: 0.3mm solid var(--border);
    background: var(--wash);
    padding: 1.8mm 3mm;
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-500);
  }

  .grid-table tbody td {
    border: none;
    border-top: 0.3mm solid var(--border);
    padding: 1.8mm 3mm;
    vertical-align: middle;
  }

  .grid-table tbody tr:first-child td { border-top: none; }
  .grid-table tbody tr:nth-child(even) { background: transparent; }

  .grid-table td.muted { color: var(--muted); }
  .grid-table td.strong { font-weight: 600; }

  .test-group { margin: 0 0 7mm; }

  /* ═══ Conteúdo vindo do editor de documentos (§9) ════════════════════════ */

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
