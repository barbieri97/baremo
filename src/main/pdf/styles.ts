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
 *  - a **folha de tela** (`.cover`, `.kpi-strip`, `.card-grid`, `.fn-card`,
 *    `.chart-card`, `.group-card`, `.test-card`) veste o relatório de
 *    resultados, e reproduz no papel o desenho de `ResultsView.vue` — cartão,
 *    barra de calor e selo coloridos.
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

  /* Tokens próprios desta folha. O azul é o \`brand-500\` da interface: aqui ele
     marca só a estrutura (sobretítulos, filetes), nunca dado — a cor com
     significado no laudo continua sendo a dos níveis. */
  :root {
    --brand: #2b6cb0;
    --brand-strong: #1a365d;
    --brand-soft: #eff6ff;
    --brand-line: #bfdbfe;
    --surface-muted: #f8fafc;
    --info-bg: #eff6ff;
    --info-line: #bfdbfe;
    --info-ink: #1a365d;
  }

  .text-danger { color: var(--danger); }

  /* ── Capa ─────────────────────────────────────────────────────────────── */

  .cover { break-after: page; page-break-after: always; }

  .letterhead {
    display: flex;
    gap: 6mm;
    align-items: center;
    padding-bottom: 3.5mm;
    margin-bottom: 8mm;
    border-bottom: 0.6mm solid var(--brand);
  }

  .letterhead__logo {
    max-height: 20mm;
    max-width: 38mm;
    object-fit: contain;
  }

  .letterhead__identity { flex: 1; }

  .letterhead__name {
    font-family: var(--serif);
    font-size: 13pt;
    font-weight: 600;
    margin: 0 0 0.8mm;
    color: var(--ink);
  }

  .letterhead__meta {
    margin: 0;
    color: var(--muted);
    font-size: 8.5pt;
    line-height: 1.45;
  }

  .cover__hero { margin: 0 0 6mm; }

  .cover__eyebrow {
    margin: 0 0 2.5mm;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--brand);
  }

  .cover__title {
    font-family: var(--serif);
    font-size: 22pt;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin: 0 0 2mm;
    color: var(--ink);
  }

  .cover__meta {
    margin: 0;
    color: var(--muted);
    font-size: 10pt;
  }

  /* ── Faixa de indicadores ─────────────────────────────────────────────── */

  .kpi-strip {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 2fr;
    gap: 3mm;
    margin: 0 0 5mm;
    break-inside: avoid;
  }

  .kpi {
    border: 0.3mm solid var(--border);
    border-top: 0.9mm solid var(--brand);
    border-radius: 2mm;
    background: #ffffff;
    padding: 3mm 3.5mm;
  }

  .kpi--danger { border-top-color: var(--danger); }
  .kpi--danger .kpi__value { color: var(--danger); }

  .kpi__value {
    margin: 0;
    font-size: 20pt;
    font-weight: 600;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }

  .kpi__label {
    margin: 1mm 0 0;
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-500);
  }

  .kpi--wide .kpi__label { margin: 0 0 2mm; }

  .kpi__fn {
    display: flex;
    align-items: center;
    gap: 2.5mm;
    margin: 0;
  }

  .kpi__fn-name {
    font-size: 11pt;
    font-weight: 600;
    line-height: 1.25;
    color: var(--ink);
  }

  /* ── Blocos da capa ───────────────────────────────────────────────────── */

  .surface-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: var(--surface-muted);
    padding: 4mm 5mm;
    margin: 0 0 6mm;
    break-inside: avoid;
  }

  .block-title {
    break-after: avoid;
    page-break-after: avoid;
    margin: 0 0 3mm;
    font-size: 8pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--brand-strong);
  }

  .block-title--spaced {
    margin-top: 3.5mm;
    padding-top: 3mm;
    border-top: 0.3mm solid var(--border);
  }

  .data-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2.5mm 6mm;
    margin: 0;
  }

  .data-grid__item { break-inside: avoid; }

  .data-grid dt {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-500);
    margin-bottom: 0.5mm;
  }

  .data-grid dd {
    margin: 0;
    font-size: 10pt;
    color: var(--ink);
  }

  /* Sem \`break-inside: avoid\` de propósito: uma queixa longa passa da
     altura da página, e o Chromium recortaria o que não coubesse. O que se
     evita é o título órfão no pé da página (\`.block-title\`). */
  .text-block {
    margin: 0 0 4.5mm;
    padding-left: 4mm;
    border-left: 0.6mm solid var(--brand-line);
  }

  /* O texto veio de um \`textarea\`: as quebras que o profissional digitou são
     dele, e colapsá-las juntaria num bloco só o que ele escreveu apartado. */
  .text-block__body {
    margin: 0;
    font-size: 10pt;
    line-height: 1.5;
    white-space: pre-wrap;
    text-align: justify;
  }

  /* ── Seções ───────────────────────────────────────────────────────────── */

  .report-section { margin: 0 0 6mm; }

  .section-head {
    margin: 0 0 5mm;
    padding-top: 3mm;
    border-top: 0.9mm solid var(--brand);
    break-after: avoid;
    page-break-after: avoid;
  }

  .section-head__eyebrow {
    margin: 0 0 1mm;
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--brand);
  }

  .section-head__title {
    font-family: var(--serif);
    font-size: 17pt;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.2;
    margin: 0;
    color: var(--ink);
  }

  .section-head__note {
    margin: 1.5mm 0 0;
    max-width: 150mm;
    font-size: 8.5pt;
    color: var(--ink-500);
  }

  .notice {
    border-radius: 2mm;
    padding: 2.5mm 3.5mm;
    margin: 0 0 4mm;
    font-size: 8.5pt;
    break-inside: avoid;
  }

  .notice--warn {
    border: 0.3mm solid var(--warn-line);
    background: var(--warn-bg);
    color: var(--warn-ink);
  }

  .notice--info {
    border: 0.3mm solid var(--info-line);
    background: var(--info-bg);
    color: var(--info-ink);
  }

  .footnote {
    margin: 4mm 0 0;
    padding-top: 2mm;
    border-top: 0.3mm solid var(--border);
    font-size: 8pt;
    color: var(--ink-500);
  }

  /* ── Panorama: a grade de cartões ─────────────────────────────────────── */

  .card-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3mm;
  }

  .fn-card {
    border: 0.3mm solid var(--border);
    border-left: 1.2mm solid var(--ink-400);
    border-radius: 2mm;
    background: #ffffff;
    padding: 3mm 3mm 2.6mm 3.2mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .fn-card__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 2mm;
    margin-bottom: 2.4mm;
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
    margin: 0.6mm 0 0;
    font-size: 7.5pt;
    color: var(--ink-500);
  }

  .fn-card__foot {
    margin: 2.2mm 0 0;
    font-size: 7.5pt;
    line-height: 1.35;
    color: var(--ink-500);
  }

  .fn-card__foot--danger { color: var(--danger); font-weight: 600; }

  /* O selo do nível médio — o \`rounded-chip\` com número em negrito da tela. */
  .level-pill {
    flex: none;
    display: inline-block;
    min-width: 10mm;
    text-align: center;
    border-radius: 1.2mm;
    padding: 1.1mm 1.8mm;
    font-size: 12pt;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .level-pill--sm {
    min-width: 8mm;
    padding: 0.8mm 1.4mm;
    font-size: 8.5pt;
  }

  /* ── Barra de calor e régua de níveis ─────────────────────────────────── */

  .heat-bar {
    display: flex;
    width: 100%;
    height: 2.4mm;
    border-radius: 1.2mm;
    overflow: hidden;
    background: var(--wash);
  }

  .heat-bar__part { display: block; height: 100%; font-size: 0; }

  .level-scale {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.8mm;
    margin: 4mm 0 0;
    break-inside: avoid;
  }

  .level-scale__step { display: flex; flex-direction: column; gap: 1.2mm; }

  .level-scale__bar { display: block; height: 1.8mm; border-radius: 0.6mm; }

  .level-scale__label {
    font-size: 7.5pt;
    line-height: 1.3;
    color: var(--muted);
  }

  .level-scale__label strong { color: var(--ink); margin-right: 0.6mm; }

  /* ── Moldura de gráfico ───────────────────────────────────────────────── */

  .chart-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: #ffffff;
    padding: 3mm 3.5mm;
    margin: 4mm 0 0;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .chart-card__head { margin: 0 0 1.5mm; }

  .chart-card__title {
    margin: 0;
    font-size: 9.5pt;
    font-weight: 600;
    color: var(--ink);
  }

  .chart-card__subtitle {
    margin: 0.5mm 0 0;
    font-size: 7.5pt;
    color: var(--ink-500);
  }

  .chart-card__canvas { text-align: center; }

  /* O SVG do ECharts sai com \`viewBox\`, então encolher ou ampliar não deforma:
     é o que permite dimensionar o gráfico em pixels no SSR e deixar a página
     decidir. Os tamanhos de \`pdf/charts.ts\` já são os da coluna em que cada
     gráfico cai, para que o texto saia perto do corpo natural. */
  .chart-card__canvas svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
  .chart-card--wide .chart-card__canvas svg { width: 100%; }

  /* ── Detalhe por função: um cartão por função raiz ────────────────────── */

  .group-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: #ffffff;
    margin: 0 0 5mm;
  }

  .group-card__head {
    display: flex;
    align-items: center;
    gap: 3mm;
    padding: 3mm 3.5mm;
    background: var(--surface-muted);
    border-bottom: 0.3mm solid var(--border);
    border-radius: 2mm 2mm 0 0;
    break-after: avoid;
    page-break-after: avoid;
    break-inside: avoid;
  }

  .group-card__identity { flex: 1; min-width: 0; }

  .group-card__name {
    margin: 0;
    font-size: 11pt;
    font-weight: 600;
    line-height: 1.25;
    color: var(--ink);
  }

  .group-card__count {
    margin: 0.4mm 0 0;
    font-size: 7.5pt;
    color: var(--ink-500);
  }

  .group-card__bar { display: block; flex: none; width: 38mm; }

  /* Radar e resumo das subfunções lado a lado: o polígono e os nomes que o
     explicam ficam no mesmo relance. */
  .group-card__profile {
    display: grid;
    grid-template-columns: 96mm 1fr;
    gap: 4mm;
    align-items: center;
    padding: 3mm 3.5mm;
    border-bottom: 0.3mm solid var(--border);
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .group-card__radar { margin: 0; }

  .subfn-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2.2mm;
  }

  .subfn-list__item {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 2mm;
    row-gap: 0.8mm;
    align-items: center;
  }

  .subfn-list__item .level-pill { grid-row: 1 / span 2; }

  .subfn-list__name {
    font-size: 8.5pt;
    font-weight: 600;
    line-height: 1.25;
    color: var(--ink);
  }

  .subfn-list__bar { display: block; }
  .subfn-list__bar .heat-bar { height: 1.6mm; }

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

  .status-tag {
    display: inline-block;
    margin-left: 1.5mm;
    padding: 0 1.2mm;
    border: 0.25mm solid var(--line);
    border-radius: 0.8mm;
    font-size: 6.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    white-space: nowrap;
  }

  /* ── Tabelas ──────────────────────────────────────────────────────────── */

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
    background: #ffffff;
    padding: 2mm 3.5mm 1.6mm;
    font-size: 7pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-500);
  }

  .grid-table tbody td {
    border: none;
    border-top: 0.25mm solid var(--wash);
    padding: 1.7mm 3.5mm;
    vertical-align: middle;
    line-height: 1.35;
  }

  .grid-table tbody tr:first-child td { border-top: none; }
  .grid-table tbody tr:nth-child(even) { background: transparent; }

  .grid-table td.muted { color: var(--muted); }
  .grid-table td.strong { font-weight: 600; }

  /* A subfunção abre um trecho da tabela do grupo: faixa clara, nome em
     caixa-alta e a barra de calor dela — o mesmo papel do \`h4\` da tela. */
  .grid-table tr.subgroup-row td {
    background: var(--brand-soft);
    border-top: 0.3mm solid var(--brand-line);
    padding: 1.4mm 3.5mm;
  }

  .grid-table tr.subgroup-row:first-child td { border-top: none; }

  .subgroup-row__inner { display: flex; align-items: center; gap: 3mm; }

  .subgroup-row__name {
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--brand-strong);
  }

  .subgroup-row__bar { display: block; width: 26mm; flex: none; }
  .subgroup-row__bar .heat-bar { height: 1.6mm; }

  .subgroup-row__count {
    margin-left: auto;
    font-size: 7pt;
    color: var(--ink-500);
  }

  /* ── Por teste: tabela e gráficos no mesmo cartão ─────────────────────── */

  /* O cartão que cabe numa página (\`--compact\`) não se parte: a tabela e o
     gráfico ficam juntos. O longo pode quebrar entre linhas, com o \`thead\`
     repetido; pedir que não quebrasse só o empurrava para a página seguinte,
     deixando uma página vazia para trás. O gráfico nunca se parte. */
  .test-card {
    border: 0.3mm solid var(--border);
    border-radius: 2mm;
    background: #ffffff;
    margin: 0 0 5mm;
  }

  .test-card--compact { break-inside: avoid; page-break-inside: avoid; }

  .test-card__head {
    display: flex;
    align-items: baseline;
    gap: 3mm;
    padding: 2.8mm 3.5mm;
    background: var(--surface-muted);
    border-bottom: 0.3mm solid var(--border);
    border-radius: 2mm 2mm 0 0;
    break-after: avoid;
    page-break-after: avoid;
  }

  .test-card__name {
    margin: 0;
    font-size: 10.5pt;
    font-weight: 600;
    color: var(--ink);
  }

  .test-card__flag {
    padding: 0.3mm 1.6mm;
    border: 0.25mm solid var(--warn-line);
    border-radius: 0.8mm;
    background: var(--warn-bg);
    font-size: 7pt;
    font-weight: 600;
    color: var(--warn-ink);
  }

  .test-card__chart {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0;
    padding: 2.5mm 3.5mm 2mm;
    border-top: 0.3mm solid var(--border);
  }

  .test-card__chart-head {
    display: flex;
    align-items: baseline;
    gap: 2mm;
    margin: 0 0 1mm;
  }

  .test-card__chart-title {
    font-size: 7.5pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--brand-strong);
  }

  .test-card__chart-subtitle { font-size: 7.5pt; color: var(--ink-500); }

  .test-card__chart svg { width: 100%; }

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
