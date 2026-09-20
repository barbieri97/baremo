/**
 * Handlers de `reports:*` (spec §7).
 *
 * O diálogo de "salvar como" roda no processo principal, e o caminho escolhido
 * nunca volta ao renderer como algo utilizável: volta só para ser exibido.
 */

import { dialog, BrowserWindow } from 'electron'
import { getDatabase } from '../../db'
import { registerHandler, invalid, notFound } from '../register'
import { renderPdfToFile } from '../../pdf/render'
import { REPORT_CSS } from '../../pdf/styles'
import { renderComparativeReport, renderResultsReport } from '../../pdf/templates'
import { buildComparativeReport } from '../../services/reports'
import { buildResultsOverview } from '../../services/results-overview'
import { renderResultsCharts } from '../../pdf/results-charts'
import { DOCUMENT_CSS, renderDocumentReport } from '../../pdf/document-template'
import { buildDocumentReport } from '../../services/document-report'
import { recordAudit } from '../../services/audit'
import { formatIsoDate, today } from '@shared/domain/dates'
import { REPORT_KIND_LABELS } from '@shared/labels'
import type { ReportKind } from '@shared/labels'
import { slug } from '../../util/slug'

interface Prepared {
  readonly bodyHtml: string
  readonly title: string
  readonly patientName: string
  readonly suggestedFileName: string
}

export function registerReportHandlers(): void {
  registerHandler('reports:generate', async (input) => {
    const handle = getDatabase()
    const prepared = prepare(input)

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const target = await dialog.showSaveDialog(window!, {
      title: 'Salvar relatório em PDF',
      defaultPath: prepared.suggestedFileName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })

    if (target.canceled || !target.filePath) {
      return { filePath: '', cancelled: true }
    }

    await renderPdfToFile(
      {
        title: prepared.title,
        bodyHtml: prepared.bodyHtml,
        // Os dois, sempre. Passar só o REPORT_CSS deixava o aviso de
        // assinatura, o bloco de resultados e o gráfico de perfil de um
        // DOCUMENTO sem estilo nenhum quando exportado por este caminho — só o
        // zip do prontuário concatenava certo.
        css: REPORT_CSS + DOCUMENT_CSS,
        header: { left: prepared.patientName, right: prepared.title },
        issuedAt: formatIsoDate(today())
      },
      target.filePath
    )

    recordAudit(handle, {
      entity: 'report',
      entityId: input.assessmentId ?? input.documentId,
      action: 'export',
      summary: `${REPORT_KIND_LABELS[input.kind as ReportKind]} exportado em PDF.`
    })

    return { filePath: target.filePath, cancelled: false }
  })
}

function prepare(input: {
  kind: ReportKind
  assessmentId: string | null
  comparisonAssessmentId: string | null
  comparisonAssessmentIds: readonly string[]
  documentId: string | null
}): Prepared {
  const handle = getDatabase()

  switch (input.kind) {
    case 'results': {
      if (input.assessmentId === null) throw invalid('Informe a avaliação do relatório.')
      const overview = buildResultsOverview(
        handle,
        input.assessmentId,
        input.comparisonAssessmentIds
      )
      return {
        bodyHtml: renderResultsReport(overview, renderResultsCharts(overview)),
        title: 'Relatório de Resultados',
        patientName: overview.patient.fullName,
        suggestedFileName: fileName(overview.patient.fullName, 'resultados')
      }
    }

    case 'comparative': {
      if (input.assessmentId === null || input.comparisonAssessmentId === null) {
        throw invalid('O relatório comparativo exige duas avaliações.')
      }
      if (input.assessmentId === input.comparisonAssessmentId) {
        throw invalid('Selecione duas avaliações diferentes para comparar.')
      }
      const report = buildComparativeReport(
        handle,
        input.assessmentId,
        input.comparisonAssessmentId
      )
      return {
        bodyHtml: renderComparativeReport(report),
        title: 'Relatório Comparativo',
        patientName: report.patient.fullName,
        suggestedFileName: fileName(report.patient.fullName, 'comparativo')
      }
    }

    case 'document': {
      if (input.documentId === null) throw notFound('Documento não informado.')
      const report = buildDocumentReport(handle, input.documentId)
      return {
        bodyHtml: renderDocumentReport(report),
        title: report.title,
        patientName: report.patient.fullName,
        suggestedFileName: fileName(report.patient.fullName, slug(report.title))
      }
    }
  }
}

/**
 * Nome sugerido do arquivo.
 *
 * O nome do paciente entra aqui, então passa por `slug` antes: um nome com
 * barra ou dois pontos quebraria o diálogo em alguns sistemas.
 */
function fileName(patientName: string, suffix: string): string {
  return `${slug(patientName)}-${suffix}-${today()}.pdf`
}
