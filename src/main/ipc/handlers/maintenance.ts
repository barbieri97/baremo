/**
 * Handlers de `maintenance:*` (spec §6.4, §8.3, §14.3).
 */

import { app, dialog, BrowserWindow } from 'electron'
import { getDatabase } from '../../db'
import { integrityCheck } from '../../db/gateway'
import { createBackup, listBackups, restoreBackup } from '../../db/backup'
import { backupsDir, databasePath } from '../../paths'
import { conflict, registerHandler } from '../register'
import { listAudit, recordAudit } from '../../services/audit'
import { cleanupStorage, scanStorage } from '../../services/attachments/maintenance'
import { exportMedicalRecord } from '../../services/export/medical-record'
import { getPatient } from '../../repositories/patients'
import type { AuditAction } from '@shared/labels'

export function registerMaintenanceHandlers(): void {
  registerHandler('maintenance:listBackups', () => listBackups(backupsDir()))

  registerHandler('maintenance:createBackup', () => {
    const handle = getDatabase()
    const backup = createBackup(handle, backupsDir())
    recordAudit(handle, {
      entity: 'database',
      entityId: backup.fileName,
      action: 'export',
      summary: `Backup manual criado (${backup.fileName}).`
    })
    return backup
  })

  /**
   * Restaurar substitui o arquivo do banco, então a conexão precisa cair antes.
   * O app é reiniciado logo em seguida: continuar rodando sobre um banco trocado
   * por baixo deixaria caches e telas apontando para dados que não existem mais.
   */
  registerHandler('maintenance:restoreBackup', ({ fileName }) => {
    const handle = getDatabase()
    recordAudit(handle, {
      entity: 'database',
      entityId: fileName,
      action: 'update',
      summary: `Restauração do backup ${fileName} solicitada.`
    })

    handle.close()
    const outcome = restoreBackup(databasePath(), backupsDir(), fileName)

    if (outcome.kind !== 'restored') {
      // Reabre para o app continuar utilizável quando a restauração é recusada.
      const message =
        outcome.kind === 'corrupt'
          ? `O backup selecionado está corrompido e não foi restaurado. ${outcome.detail}`
          : outcome.kind === 'not_found'
            ? 'Backup não encontrado.'
            : 'Nome de backup inválido.'

      app.relaunch()
      app.exit(0)
      throw conflict(message)
    }

    app.relaunch()
    app.exit(0)
    return { ok: true as const }
  })

  registerHandler('maintenance:integrityCheck', () => integrityCheck(getDatabase()))

  registerHandler('maintenance:scanFiles', async () => scanStorage(getDatabase()))

  registerHandler('maintenance:cleanupFiles', async (input) => {
    const handle = getDatabase()
    const outcome = await cleanupStorage(handle, input)
    recordAudit(handle, {
      entity: 'attachment_storage',
      entityId: null,
      action: 'delete',
      summary: `Manutenção de arquivos: ${outcome.blobsDeleted} blob(s) órfão(s) removido(s), ${outcome.referencesRemoved} referência(s) quebrada(s) limpa(s).`
    })
    return outcome
  })

  registerHandler('maintenance:exportMedicalRecord', async ({ patientId }) => {
    const handle = getDatabase()
    const patient = getPatient(handle, patientId)

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const target = await dialog.showSaveDialog(window!, {
      title: 'Exportar prontuário',
      defaultPath: `prontuario-${slug(patient.fullName)}.zip`,
      filters: [{ name: 'Arquivo ZIP', extensions: ['zip'] }]
    })

    if (target.canceled || !target.filePath) return { filePath: '', cancelled: true }

    await exportMedicalRecord(handle, patientId, target.filePath)

    recordAudit(handle, {
      entity: 'patient',
      entityId: patientId,
      action: 'export',
      summary: `Prontuário de "${patient.fullName}" exportado em .zip.`
    })

    return { filePath: target.filePath, cancelled: false }
  })

  registerHandler('maintenance:listAudit', ({ limit }) =>
    listAudit(getDatabase(), limit).map((entry) => ({
      ...entry,
      action: entry.action as AuditAction
    }))
  )
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
}
