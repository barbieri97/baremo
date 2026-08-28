/**
 * Handlers de `config:*` — perfil profissional, paleta e estado do app.
 */

import { app, safeStorage } from 'electron'
import { getDatabase, TARGET_SCHEMA_VERSION } from '../../db'
import { attachmentsDir, databasePath } from '../../paths'
import { registerHandler } from '../register'
import {
  deleteColor,
  getProfile,
  getSetting,
  listColors,
  reorderColors,
  saveColor,
  saveProfile,
  setSetting,
  SETTING_DISK_NOTICE
} from '../../repositories/config'
import { getAiConfig } from '../../repositories/ai-config'
import { recordAudit } from '../../services/audit'

export function registerConfigHandlers(): void {
  registerHandler('config:getAppState', () => {
    const handle = getDatabase()

    return {
      appVersion: app.getVersion(),
      schemaVersion: TARGET_SCHEMA_VERSION,
      databasePath: databasePath(),
      attachmentsPath: attachmentsDir(),
      diskEncryptionNoticeAcknowledged: getSetting(handle, SETTING_DISK_NOTICE) === 'true',
      aiEnabled: getAiConfig(handle).enabled,
      safeStorageAvailable: safeStorage.isEncryptionAvailable()
    }
  })

  registerHandler('config:acknowledgeDiskNotice', () => {
    setSetting(getDatabase(), SETTING_DISK_NOTICE, 'true')
    return { ok: true as const }
  })

  registerHandler('config:getProfile', () => getProfile(getDatabase()))

  registerHandler('config:saveProfile', (input) => saveProfile(getDatabase(), input))

  registerHandler('config:listColors', () => listColors(getDatabase()))

  registerHandler('config:saveColor', (input) => saveColor(getDatabase(), input))

  registerHandler('config:deleteColor', ({ id }) => {
    const handle = getDatabase()
    deleteColor(handle, id)
    recordAudit(handle, {
      entity: 'color',
      entityId: id,
      action: 'delete',
      summary: 'Cor removida da paleta.'
    })
    return { ok: true as const }
  })

  registerHandler('config:reorderColors', ({ orderedIds }) => {
    reorderColors(getDatabase(), orderedIds)
    return { ok: true as const }
  })
}
