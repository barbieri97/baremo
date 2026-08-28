/**
 * Template de exportação de documento do editor (spec §7.1.3, §9.6).
 */

import { html, raw, toString } from './html'
import type { DocumentReport } from '../services/document-report'

/**
 * O aviso de assinatura (§9.6) fica no PDF, não só na tela.
 *
 * O app não implementa assinatura ICP-Brasil, exigida pela Res. CFP nº 11/2018
 * para documento psicológico em meio eletrônico. Quem receber o arquivo precisa
 * saber que ele ainda não está assinado — um aviso que só aparecesse na
 * interface se perderia no momento em que o PDF sai da máquina.
 */
const SIGNATURE_NOTICE = html`
  <aside class="signature-notice">
    <strong>Documento não assinado digitalmente.</strong>
    Este arquivo foi gerado pelo Baremo e não contém assinatura digital ICP-Brasil.
    Para validade em meio eletrônico (Res. CFP nº 11/2018), assine o PDF externamente —
    por exemplo, no gov.br ou no Assinador ITI — antes de entregá-lo.
  </aside>
`

export function renderDocumentReport(report: DocumentReport): string {
  return toString(html`
    <h1 class="doc-title">${report.title}</h1>
    <p class="section__note">${report.typeLabel}</p>
    ${report.requiresSignatureNotice ? SIGNATURE_NOTICE : null}
    <div class="doc-content">${raw(report.contentHtml)}</div>
  `)
}

/** Estilos exclusivos da exportação de documento, concatenados ao CSS base. */
export const DOCUMENT_CSS = `
  .signature-notice {
    border: 0.75pt solid #dd6b20;
    background: #fffaf0;
    border-radius: 2mm;
    padding: 3mm 4mm;
    margin: 0 0 5mm;
    font-size: 9pt;
    color: #7b341e;
  }

  .results-block { margin: 3mm 0 4mm; }
  .profile-chart { margin: 3mm 0 4mm; max-width: 100%; }
  .token-unresolved { background: #fed7d7; padding: 0 1mm; border-radius: 0.5mm; }
`
