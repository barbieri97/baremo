/**
 * Auto-update (spec §15.3).
 *
 * `electron-updater` apontado para o GitHub Releases. O app verifica de tempos
 * em tempos, baixa em segundo plano e avisa na barra lateral quando a nova versão
 * está pronta. A instalação só acontece quando o usuário clica em "Reiniciar" —
 * nunca no meio de uma sessão de trabalho, porque uma reinicialização inesperada
 * durante a digitação de escores custaria o trabalho da sessão. Se ele ignorar o
 * aviso, a versão entra no próximo fechamento (`autoInstallOnAppQuit`).
 *
 * O estado vive aqui, e não no renderer: o download pode terminar antes de a
 * janela montar, e a UI precisa conseguir perguntar "em que pé está?".
 *
 * Pendência do §15.3, com custo recorrente: sem certificado de assinatura para
 * Windows e sem notarização Apple, os instaladores disparam avisos de SmartScreen
 * e Gatekeeper. É decisão de produto, não de código.
 */

import { app, BrowserWindow } from 'electron'
import updater from 'electron-updater'
import { UPDATE_STATUS_CHANNEL } from '@shared/contracts/updates'
import type { UpdateStatus } from '@shared/contracts/updates'

const { autoUpdater } = updater

/** Intervalo entre verificações, depois da primeira. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

let status: UpdateStatus = { kind: app.isPackaged ? 'idle' : 'unsupported' }

export function getUpdateStatus(): UpdateStatus {
  return status
}

function setStatus(next: UpdateStatus): void {
  status = next
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_STATUS_CHANNEL, next)
    }
  }
}

/** Verificação já em curso, ou versão já baixada: não há o que buscar. */
function isBusy(): boolean {
  return status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'downloaded'
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged || isBusy()) return status

  setStatus({ kind: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    // O evento `error` já registrou o estado.
  }
  return status
}

/**
 * Fecha, instala em silêncio e reabre o app.
 *
 * Adiado para depois da resposta IPC: sair dentro do handler deixaria o
 * renderer esperando um retorno que nunca chega.
 */
export function installUpdate(): void {
  if (status.kind !== 'downloaded') return
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

export function startUpdateChecks(): void {
  // Em desenvolvimento não há release para comparar, e o updater falharia com
  // ruído a cada boot.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    setStatus({ kind: 'downloading', version: info.version, percent: 0 })
  })

  autoUpdater.on('download-progress', (progress) => {
    if (status.kind !== 'downloading') return
    setStatus({ ...status, percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-not-available', () => {
    setStatus({ kind: 'up-to-date' })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ kind: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (error) => {
    // Falha de atualização não interrompe o uso: o app é local-first e funciona
    // sem rede. O detalhe (às vezes um dump HTTP inteiro) fica no log.
    console.warn('[updater] verificação falhou:', error.message)
    setStatus({
      kind: 'error',
      message: 'Não foi possível verificar atualizações. Confira a conexão com a internet.'
    })
  })

  void checkForUpdates()
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}
