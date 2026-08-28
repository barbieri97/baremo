/**
 * Handlers de `documents:*` (spec §9).
 */

import { getDatabase } from '../../db'
import { registerHandler } from '../register'
import {
  createDocument,
  deleteDocument,
  deleteTemplate,
  getDocument,
  getVersion,
  listDocuments,
  listTemplates,
  listVersions,
  markReviewed,
  restoreVersion,
  saveContent,
  saveTemplate,
  setStatus,
  updateMeta
} from '../../repositories/documents'
import { listResults } from '../../repositories/assessments'
import { getAssessment } from '../../repositories/assessments'
import { computeProfile } from '../../services/document-report'
import { recordAudit } from '../../services/audit'
import { RESULT_STATUS_LABELS, SCORE_TYPE_SHORT_LABELS } from '@shared/labels'
import { ancestorPath } from '@shared/domain/tree'
import { listInstruments } from '../../repositories/trees'

export function registerDocumentHandlers(): void {
  registerHandler('documents:list', ({ patientId, assessmentId }) =>
    listDocuments(getDatabase(), patientId, assessmentId)
  )

  registerHandler('documents:get', ({ id }) => getDocument(getDatabase(), id))

  registerHandler('documents:create', (input) => createDocument(getDatabase(), input))

  registerHandler('documents:saveContent', ({ id, contentJson }) =>
    saveContent(getDatabase(), id, contentJson)
  )

  registerHandler('documents:updateMeta', ({ id, title, type, assessmentId }) =>
    updateMeta(getDatabase(), id, { title, type, assessmentId })
  )

  registerHandler('documents:setStatus', ({ id, status }) => {
    const handle = getDatabase()
    const document = setStatus(handle, id, status)

    if (status === 'finalized') {
      recordAudit(handle, {
        entity: 'document',
        entityId: id,
        action: 'update',
        summary: `Documento "${document.title}" finalizado.`
      })
    }

    return document
  })

  registerHandler('documents:markReviewed', ({ id }) => {
    const handle = getDatabase()
    const document = markReviewed(handle, id)
    recordAudit(handle, {
      entity: 'document',
      entityId: id,
      action: 'update',
      summary: `Revisão registrada para o documento "${document.title}" (assistido por IA).`
    })
    return document
  })

  registerHandler('documents:listVersions', ({ documentId }) =>
    listVersions(getDatabase(), documentId)
  )
  registerHandler('documents:getVersion', ({ versionId }) => getVersion(getDatabase(), versionId))
  registerHandler('documents:restoreVersion', ({ documentId, versionId }) =>
    restoreVersion(getDatabase(), documentId, versionId)
  )

  registerHandler('documents:delete', ({ id }) => {
    const handle = getDatabase()
    const document = getDocument(handle, id)
    deleteDocument(handle, id)
    recordAudit(handle, {
      entity: 'document',
      entityId: id,
      action: 'delete',
      summary: `Documento "${document.title}" excluído.`
    })
    return { ok: true as const }
  })

  registerHandler('documents:listTemplates', () => listTemplates(getDatabase()))
  registerHandler('documents:saveTemplate', (input) => saveTemplate(getDatabase(), input))
  registerHandler('documents:deleteTemplate', ({ id }) => {
    deleteTemplate(getDatabase(), id)
    return { ok: true as const }
  })

  /**
   * Dados do NodeView `bloco-resultados` (§9.2).
   *
   * Lidos a cada renderização, tanto na tela quanto na exportação: o JSON do
   * documento guarda só a referência à avaliação, então não existe cópia dos
   * resultados dentro do documento para divergir do banco.
   */
  registerHandler('documents:resultsBlock', ({ assessmentId, cognitiveFunctionId }) => {
    const handle = getDatabase()
    const assessment = getAssessment(handle, assessmentId)
    const catalog = listInstruments(handle)

    const rows = listResults(handle, assessmentId)
      .filter(
        (result) =>
          cognitiveFunctionId === null || result.cognitiveFunctionId === cognitiveFunctionId
      )
      .map((result) => ({
        // Caminho completo do instrumento: num relatório, "Semelhanças" sozinho
        // não diz de qual bateria veio.
        instrumentPath: ancestorPath(catalog, result.instrumentId)
          .map((node) => node.name)
          .join(' › '),
        cognitiveFunctionName: result.cognitiveFunctionName,
        scoreTypeLabel: SCORE_TYPE_SHORT_LABELS[result.scoreType],
        value: result.value,
        statusLabel: RESULT_STATUS_LABELS[result.status],
        classificationName: result.classificationName,
        colorHex: result.colorHex
      }))

    return { assessmentDate: assessment.date, rows }
  })

  registerHandler('documents:profileChart', ({ assessmentId }) => ({
    points: computeProfile(getDatabase(), assessmentId).map((point) => ({ ...point }))
  }))
}
