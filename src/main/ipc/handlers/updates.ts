/**
 * Handlers de `updates:*` — estado e instalação da atualização automática.
 */

import { checkForUpdates, getUpdateStatus, installUpdate } from '../../updater'
import { conflict, registerHandler } from '../register'

export function registerUpdateHandlers(): void {
  registerHandler('updates:getStatus', () => getUpdateStatus())

  registerHandler('updates:check', () => checkForUpdates())

  registerHandler('updates:install', () => {
    if (getUpdateStatus().kind !== 'downloaded') {
      throw conflict('Nenhuma atualização pronta para instalar.')
    }
    installUpdate()
    return { ok: true as const }
  })
}
