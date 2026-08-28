/**
 * Auto-update (spec §15.3).
 *
 * `electron-updater` apontado para o GitHub Releases. A notificação é discreta e
 * a atualização é aplicada no reinício — nunca no meio de uma sessão de trabalho,
 * porque uma reinicialização inesperada durante a digitação de escores custaria
 * o trabalho da sessão.
 *
 * Pendência do §15.3, com custo recorrente: sem certificado de assinatura para
 * Windows e sem notarização Apple, os instaladores disparam avisos de SmartScreen
 * e Gatekeeper. É decisão de produto, não de código.
 */

import { app, BrowserWindow } from 'electron'
import updater from 'electron-updater'

const { autoUpdater } = updater

/** Intervalo entre verificações, depois da primeira. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function startUpdateChecks(): void {
  // Em desenvolvimento não há release para comparar, e o updater falharia com
  // ruído a cada boot.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('app:updateReady', { version: info.version })
      }
    }
  })

  autoUpdater.on('error', (error) => {
    // Falha de atualização não interrompe o uso: o app é local-first e funciona
    // sem rede.
    console.warn('[updater] verificação falhou:', error.message)
  })

  void autoUpdater.checkForUpdates().catch(() => undefined)
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }, CHECK_INTERVAL_MS)
}
