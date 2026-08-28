/**
 * CSS de impressão dos relatórios (spec §7.2).
 *
 * Vive numa string, e não num arquivo `.css`, porque a janela de impressão roda
 * sob `default-src 'none'`: nada é buscado pela rede ou pelo disco, o estilo
 * viaja embutido no próprio HTML. `style-src 'unsafe-inline'` na CSP daquela
 * janela é o que permite isso — e é seguro ali porque a janela não executa
 * script algum.
 */

export const REPORT_CSS = `
  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }

  :root {
    --ink: #1a202c;
    --muted: #4a5568;
    --line: #cbd5e0;
    --soft: #f7fafc;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    color: var(--ink);
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Cabeçalho e rodapé de página são desenhados pelo printToPDF a partir dos
     templates em render.ts; este é o cabeçalho de conteúdo, na primeira página. */
  .doc-header {
    display: flex;
    gap: 12mm;
    align-items: flex-start;
    border-bottom: 1.5pt solid var(--ink);
    padding-bottom: 4mm;
    margin-bottom: 6mm;
  }

  .doc-header__logo {
    max-height: 22mm;
    max-width: 40mm;
    object-fit: contain;
  }

  .doc-header__identity { flex: 1; }

  .doc-header__name {
    font-size: 13pt;
    font-weight: 700;
    margin: 0 0 1mm;
  }

  .doc-header__meta {
    margin: 0;
    color: var(--muted);
    font-size: 9pt;
  }

  .doc-title {
    font-size: 14pt;
    font-weight: 700;
    margin: 0 0 4mm;
  }

  .patient-card {
    background: var(--soft);
    border: 0.5pt solid var(--line);
    border-radius: 2mm;
    padding: 4mm 5mm;
    margin-bottom: 6mm;
  }

  .patient-card dl {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2mm 6mm;
    margin: 0;
  }

  .patient-card dt {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }

  .patient-card dd {
    margin: 0 0 1mm;
    font-size: 10pt;
  }

  .section { margin-bottom: 6mm; }

  .section__title {
    font-size: 11.5pt;
    font-weight: 700;
    margin: 0 0 2mm;
    padding-bottom: 1mm;
    border-bottom: 0.75pt solid var(--line);
  }

  .section__note {
    color: var(--muted);
    font-size: 9pt;
    margin: 0 0 2mm;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }

  /* Cabeçalho repetido em tabela que atravessa páginas (§7.2). */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }

  th, td {
    border: 0.5pt solid var(--line);
    padding: 1.6mm 2.2mm;
    text-align: left;
    vertical-align: top;
  }

  th {
    background: var(--soft);
    font-weight: 600;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  td.numeric { text-align: right; font-variant-numeric: tabular-nums; }

  .classification {
    display: inline-block;
    padding: 0.6mm 2mm;
    border-radius: 1mm;
    font-size: 8.5pt;
    font-weight: 600;
    white-space: nowrap;
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
  .doc-content h1 { font-size: 13pt; margin: 5mm 0 2mm; }
  .doc-content h2 { font-size: 12pt; margin: 4mm 0 2mm; }
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
