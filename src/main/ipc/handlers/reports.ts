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
import type { ResultsReportCharts } from '../../pdf/templates'
import { buildComparativeReport } from '../../services/reports'
import { buildResultsOverview } from '../../services/results-overview'
import { CHART_SIZE, renderChartSvg } from '../../pdf/charts'
import { comparisonOption, evolutionOption, functionRadarOption } from '@shared/charts/options'
import type { ResultsOverview } from '@shared/contracts/results'
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
        bodyHtml: renderResultsReport(overview, renderCharts(overview)),
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
 * Desenha os gráficos do relatório, em SVG.
 *
 * Só entra gráfico que tem o que dizer: o radar exige ao menos três funções com
 * nível (com duas, o "polígono" é um segmento de reta), e a comparação exige
 * duas entradas. A evolução só existe com mais de uma avaliação selecionada.
 * Um gráfico degenerado num laudo é pior do que a sua ausência — ocupa a página
 * e sugere uma leitura que os dados não sustentam.
 */
function renderCharts(overview: ResultsOverview): ResultsReportCharts {
  const style = { forPrint: true } as const
  const comparison: Record<string, string> = {}
  const evolution: Record<string, string> = {}

  for (const group of overview.tests) {
    if (!group.comparable) continue

    comparison[group.instrumentId] = renderChartSvg(
      comparisonOption(group, overview.assessments, 'column', {
        ...style,
        showNormBand: true
      }),
      CHART_SIZE.comparison
    )

    if (overview.assessments.length > 1) {
      evolution[group.instrumentId] = renderChartSvg(
        evolutionOption(group, overview.assessments, style),
        CHART_SIZE.evolution
      )
    }
  }

  const withLevel = overview.functions.filter((entry) => entry.averageLevel !== null)

  return {
    radar:
      withLevel.length >= 3
        ? renderChartSvg(functionRadarOption(overview.functions, style), CHART_SIZE.radar)
        : null,
    comparison,
    evolution
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
