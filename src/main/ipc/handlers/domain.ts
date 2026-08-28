/**
 * Handlers do núcleo clínico: pacientes, árvores, faixas, avaliações e resultados.
 *
 * Os handlers são finos de propósito — resolvem o handle do banco, chamam o
 * repositório e auditam o que precisa ser auditado. A regra de negócio fica nos
 * repositórios e serviços, onde os testes a alcançam sem Electron.
 */

import { rm } from 'node:fs/promises'
import { getDatabase } from '../../db'
import { blobPath } from '../../paths'
import { registerHandler } from '../register'
import {
  createPatient,
  deletePatient,
  getPatient,
  listPatients,
  orphanBlobsIfPatientDeleted,
  patientImpact,
  setPatientArchived,
  updatePatient
} from '../../repositories/patients'
import {
  cognitiveFunctionImpact,
  createCognitiveFunction,
  createInstrument,
  deleteCognitiveFunction,
  deleteInstrument,
  instrumentImpact,
  listCognitiveFunctions,
  listInstruments,
  moveCognitiveFunction,
  moveInstrument,
  updateCognitiveFunction,
  updateInstrument
} from '../../repositories/trees'
import {
  listConfiguredScoreTypes,
  listRanges,
  saveRanges,
  validateDraft
} from '../../repositories/classification-ranges'
import {
  assessmentImpact,
  createAssessment,
  deleteAssessment,
  deleteResult,
  getAssessment,
  listAssessmentsByPatient,
  listResults,
  previewReprocess,
  reprocessAssessment,
  saveResult,
  setAssessmentArchived,
  updateAssessment
} from '../../repositories/assessments'
import { recordAudit } from '../../services/audit'

export function registerDomainHandlers(): void {
  registerPatientHandlers()
  registerTreeHandlers()
  registerClassificationHandlers()
  registerAssessmentHandlers()
}

function registerPatientHandlers(): void {
  registerHandler('patients:list', (input) => listPatients(getDatabase(), input))
  registerHandler('patients:get', ({ id }) => getPatient(getDatabase(), id))

  registerHandler('patients:create', ({ input }) => createPatient(getDatabase(), input))
  registerHandler('patients:update', ({ id, input }) => updatePatient(getDatabase(), id, input))

  registerHandler('patients:setArchived', ({ id, archived }) => {
    const handle = getDatabase()
    const patient = setPatientArchived(handle, id, archived)
    recordAudit(handle, {
      entity: 'patient',
      entityId: id,
      action: 'archive',
      summary: archived
        ? `Paciente "${patient.fullName}" arquivado.`
        : `Paciente "${patient.fullName}" desarquivado.`
    })
    return patient
  })

  registerHandler('patients:impact', ({ id }) => patientImpact(getDatabase(), id))

  /**
   * Exclusão definitiva (§6.2): a confirmação por digitação é conferida no
   * repositório. Os blobs precisam ser listados ANTES do DELETE — depois da
   * cascata não há como saber quais eram deste paciente.
   */
  registerHandler('patients:delete', async ({ id, confirmationName }) => {
    const handle = getDatabase()
    const patient = getPatient(handle, id)
    const orphans = orphanBlobsIfPatientDeleted(handle, id)

    deletePatient(handle, id, confirmationName)

    for (const blob of orphans) {
      // Falha ao remover um blob não desfaz a exclusão do prontuário: a
      // varredura de manutenção (§8.3) recolhe o que sobrar.
      await rm(blobPath(blob.sha256, blob.extension), { force: true }).catch(() => undefined)
    }

    recordAudit(handle, {
      entity: 'patient',
      entityId: id,
      action: 'delete',
      summary: `Exclusão definitiva do prontuário de "${patient.fullName}". ${orphans.length} arquivo(s) removido(s) do disco.`
    })

    return { ok: true as const }
  })
}

function registerTreeHandlers(): void {
  registerHandler('cognitiveFunctions:list', () => listCognitiveFunctions(getDatabase()))
  registerHandler('cognitiveFunctions:create', ({ input }) =>
    createCognitiveFunction(getDatabase(), input)
  )
  registerHandler('cognitiveFunctions:update', ({ id, input }) =>
    updateCognitiveFunction(getDatabase(), id, input)
  )
  registerHandler('cognitiveFunctions:move', ({ id, parentId, order }) => {
    moveCognitiveFunction(getDatabase(), id, parentId, order)
    return { ok: true as const }
  })
  registerHandler('cognitiveFunctions:impact', ({ id }) =>
    cognitiveFunctionImpact(getDatabase(), id)
  )
  registerHandler('cognitiveFunctions:delete', ({ id }) => {
    const handle = getDatabase()
    const impact = cognitiveFunctionImpact(handle, id)
    deleteCognitiveFunction(handle, id)
    recordAudit(handle, {
      entity: 'cognitive_function',
      entityId: id,
      action: 'delete',
      summary: `Função cognitiva "${impact.label}" excluída.`
    })
    return { ok: true as const }
  })

  registerHandler('instruments:list', () => listInstruments(getDatabase()))
  registerHandler('instruments:create', ({ input }) => createInstrument(getDatabase(), input))
  registerHandler('instruments:update', ({ id, input }) =>
    updateInstrument(getDatabase(), id, input)
  )
  registerHandler('instruments:move', ({ id, parentId, order }) => {
    moveInstrument(getDatabase(), id, parentId, order)
    return { ok: true as const }
  })
  registerHandler('instruments:impact', ({ id }) => instrumentImpact(getDatabase(), id))
  registerHandler('instruments:delete', ({ id }) => {
    const handle = getDatabase()
    const impact = instrumentImpact(handle, id)
    deleteInstrument(handle, id)
    recordAudit(handle, {
      entity: 'instrument',
      entityId: id,
      action: 'delete',
      summary: `Instrumento "${impact.label}" excluído.`
    })
    return { ok: true as const }
  })
}

function registerClassificationHandlers(): void {
  registerHandler('classifications:list', ({ instrumentId, scoreType }) =>
    listRanges(getDatabase(), instrumentId, scoreType)
  )
  registerHandler('classifications:listConfigured', ({ instrumentId }) =>
    listConfiguredScoreTypes(getDatabase(), instrumentId)
  )
  registerHandler('classifications:validate', ({ scoreType, ranges }) =>
    validateDraft(scoreType, ranges).map((issue) => ({
      code: issue.code,
      message: issue.message,
      rangeIds: [...issue.rangeIds]
    }))
  )
  registerHandler('classifications:save', ({ instrumentId, scoreType, ranges }) => {
    const handle = getDatabase()
    const saved = saveRanges(handle, instrumentId, scoreType, ranges)
    recordAudit(handle, {
      entity: 'classification_range',
      entityId: instrumentId,
      action: 'update',
      summary: `Faixas de ${scoreType} atualizadas (${saved.length} faixa(s)). Resultados já gravados não foram reclassificados.`
    })
    return saved
  })
}

function registerAssessmentHandlers(): void {
  registerHandler('assessments:listByPatient', ({ patientId, includeArchived }) =>
    listAssessmentsByPatient(getDatabase(), patientId, includeArchived)
  )
  registerHandler('assessments:get', ({ id }) => getAssessment(getDatabase(), id))
  registerHandler('assessments:create', ({ input }) => createAssessment(getDatabase(), input))
  registerHandler('assessments:update', ({ id, input }) =>
    updateAssessment(getDatabase(), id, input)
  )
  registerHandler('assessments:setArchived', ({ id, archived }) => {
    const handle = getDatabase()
    const assessment = setAssessmentArchived(handle, id, archived)
    recordAudit(handle, {
      entity: 'assessment',
      entityId: id,
      action: 'archive',
      summary: archived ? 'Avaliação arquivada.' : 'Avaliação desarquivada.'
    })
    return assessment
  })
  registerHandler('assessments:impact', ({ id }) => assessmentImpact(getDatabase(), id))
  registerHandler('assessments:delete', ({ id }) => {
    const handle = getDatabase()
    const assessment = getAssessment(handle, id)
    deleteAssessment(handle, id)
    recordAudit(handle, {
      entity: 'assessment',
      entityId: id,
      action: 'delete',
      summary: `Avaliação de ${assessment.date} excluída definitivamente.`
    })
    return { ok: true as const }
  })

  registerHandler('results:listByAssessment', ({ assessmentId }) =>
    listResults(getDatabase(), assessmentId)
  )
  registerHandler('results:save', ({ id, input }) => saveResult(getDatabase(), id, input))
  registerHandler('results:delete', ({ id }) => {
    deleteResult(getDatabase(), id)
    return { ok: true as const }
  })

  registerHandler('results:reprocessPreview', ({ assessmentId }) =>
    previewReprocess(getDatabase(), assessmentId).map((change) => ({ ...change }))
  )

  // ADR-004: reprocessar é ação explícita e auditada, nunca efeito colateral de
  // editar uma tabela de faixas.
  registerHandler('results:reprocess', ({ assessmentId }) => {
    const handle = getDatabase()
    const outcome = reprocessAssessment(handle, assessmentId)
    recordAudit(handle, {
      entity: 'assessment',
      entityId: assessmentId,
      action: 'update',
      summary: `Classificações reprocessadas: ${outcome.updated} atualizada(s), ${outcome.unchanged} inalterada(s), ${outcome.unresolved} sem faixa correspondente.`
    })
    return outcome
  })
}
