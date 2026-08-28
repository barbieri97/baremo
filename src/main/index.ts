/**
 * Ponto de entrada do processo principal.
 *
 * Sequência de boot (spec §4.4 do plano, §13, §14):
 *
 *   registra esquemas privilegiados  (antes de whenReady — exigência do Electron)
 *     → integridade do banco → backup preventivo → migrations → seeds
 *     → registra protocolos → registra handlers IPC → abre a janela
 *
 * A ordem não é decorativa: os esquemas privilegiados precisam ser declarados
 * antes de `whenReady`, e a janela não pode abrir antes dos handlers, senão a
 * primeira tela dispara chamadas em canais que ainda não existem.
 */

import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { protocol } from 'electron'
import { bootDatabase, closeDatabase } from './db'
import type { BootFailure } from './db'
import {
  APP_ORIGIN,
  registerAppScheme,
  registerFileScheme,
  registerPrivilegedSchemes
} from './protocol/schemes'
import { PRINT_SCHEME_PRIVILEGES, registerPrintScheme } from './pdf/render'
import { createMainWindow, preloadPath } from './windows/main-window'
import { assertAllChannelsRegistered, setAllowedOrigins } from './ipc/register'
import { registerConfigHandlers } from './ipc/handlers/config'
import { registerDomainHandlers } from './ipc/handlers/domain'
import { registerReportHandlers } from './ipc/handlers/reports'
import { registerAttachmentHandlers, resolveAttachmentForProtocol } from './ipc/handlers/attachments'
import { registerDocumentHandlers } from './ipc/handlers/documents'
import { registerMaintenanceHandlers } from './ipc/handlers/maintenance'
import { registerAiHandlers } from './ipc/handlers/ai'
import { attachmentsDir } from './paths'
import { seedTemplatesIfEmpty } from './db/seed-templates'
import { getDatabase } from './db'
import { startUpdateChecks } from './updater'

const DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

// Instância única: duas instâncias sobre o mesmo SQLite disputariam o WAL e
// dariam ao usuário duas janelas com estados divergentes do mesmo prontuário.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  registerPrivilegedSchemes()
  protocol.registerSchemesAsPrivileged([PRINT_SCHEME_PRIVILEGES])

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  app.whenReady().then(start).catch(fatal)
}

async function start(): Promise<void> {
  const boot = bootDatabase()

  if (!boot.ok) {
    await reportBootFailure(boot.failure)
    app.exit(1)
    return
  }

  seedTemplatesIfEmpty(getDatabase())

  const rendererDir = join(import.meta.dirname, '../renderer')
  registerAppScheme(rendererDir)
  registerFileScheme(attachmentsDir(), resolveAttachmentForProtocol)
  registerPrintScheme()

  // Só estas origens podem falar com o processo principal (§13.2).
  setAllowedOrigins(
    DEV_SERVER_URL ? [new URL(DEV_SERVER_URL).origin, APP_ORIGIN] : [APP_ORIGIN]
  )

  registerConfigHandlers()
  registerDomainHandlers()
  registerReportHandlers()
  registerAttachmentHandlers()
  registerDocumentHandlers()
  registerMaintenanceHandlers()
  registerAiHandlers()

  // Falha alto no boot se um canal do contrato ficou sem handler — melhor do
  // que descobrir pela tela que não carrega.
  assertAllChannelsRegistered()

  createMainWindow({ preloadPath: preloadPath(), devServerUrl: DEV_SERVER_URL })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow({ preloadPath: preloadPath(), devServerUrl: DEV_SERVER_URL })
    }
  })

  startUpdateChecks()
}

/**
 * Falha de boot vira diálogo explicativo, não crash silencioso.
 *
 * O caso do banco mais novo que o binário (§14.2) é o que mais importa: o
 * usuário instalou uma versão anterior por cima, e migrar para trás perderia
 * dados. O app recusa abrir e diz o que fazer.
 */
async function reportBootFailure(failure: BootFailure): Promise<void> {
  const messages: Record<BootFailure['kind'], { title: string; detail: string }> = {
    corrupt: {
      title: 'Banco de dados corrompido',
      detail:
        'A verificação de integridade falhou ao abrir o banco de dados. ' +
        'Restaure um backup a partir da pasta de dados do aplicativo antes de continuar. ' +
        'Nenhum dado foi alterado.'
    },
    database_is_newer: {
      title: 'Versão do aplicativo mais antiga que os dados',
      detail:
        'Este banco de dados foi criado por uma versão mais recente do Baremo. ' +
        'Abrir com esta versão exigiria converter os dados para trás, o que causaria perda. ' +
        'Instale novamente a versão mais recente do aplicativo.'
    },
    migration_failed: {
      title: 'Falha ao atualizar o banco de dados',
      detail:
        'A atualização da estrutura do banco não pôde ser concluída. ' +
        'Um backup foi criado antes da tentativa, na pasta "backups" do diretório de dados do aplicativo.'
    }
  }

  const message = messages[failure.kind]
  const extra =
    failure.kind === 'corrupt'
      ? `\n\nDetalhe técnico: ${failure.detail}`
      : failure.kind === 'database_is_newer'
        ? `\n\nVersão dos dados: ${failure.databaseVersion}. Versão suportada por este aplicativo: ${failure.appVersion}.`
        : `\n\nDetalhe técnico: ${failure.detail}`

  await dialog.showMessageBox({
    type: 'error',
    title: message.title,
    message: message.title,
    detail: message.detail + extra,
    buttons: ['Fechar']
  })
}

function fatal(error: unknown): void {
  console.error('[main] falha fatal no boot:', error)
  dialog.showErrorBox(
    'Não foi possível iniciar o Baremo',
    error instanceof Error ? error.message : String(error)
  )
  app.exit(1)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  closeDatabase()
})
