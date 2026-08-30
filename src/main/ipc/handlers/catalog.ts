/**
 * Handlers de `catalog:*` — transferência do catálogo entre instalações.
 *
 * O acesso ao disco fica todo aqui: os serviços de exportação e importação
 * trabalham sobre o banco e sobre um objeto já validado, sem tocar em
 * filesystem. É o que permite testá-los sem Electron.
 */

import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, dialog, BrowserWindow } from 'electron'
import { getDatabase } from '../../db'
import { conflict, invalid, registerHandler } from '../register'
import { recordAudit } from '../../services/audit'
import { buildCatalogFile } from '../../services/catalog/export'
import {
  applyCatalogImport,
  parseCatalogFile,
  planCatalogImport
} from '../../services/catalog/import'
import type { CatalogFile } from '@shared/contracts/catalog'
import { today } from '@shared/domain/dates'

/**
 * Arquivo escolhido e já validado, aguardando confirmação.
 *
 * Um só de cada vez: escolher outro arquivo invalida o anterior, que é o que o
 * usuário espera de qualquer forma. Guardar o CONTEÚDO já lido, e não o caminho,
 * fecha a janela entre a prévia e a aplicação — o arquivo não pode ser trocado
 * no disco depois de o usuário ver o que ia acontecer.
 */
let pendingImport: { token: string; fileName: string; file: CatalogFile } | null = null

/** Teto de leitura do arquivo: um catálogo real não chega perto disso. */
const MAX_IMPORT_BYTES = 16 * 1024 * 1024

export function registerCatalogHandlers(): void {
  registerHandler('catalog:export', async () => {
    const handle = getDatabase()
    const payload = buildCatalogFile(handle, app.getVersion())

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const target = await dialog.showSaveDialog(window!, {
      title: 'Exportar catálogo',
      defaultPath: `catalogo-baremo-${today()}.json`,
      filters: [{ name: 'Catálogo do Baremo', extensions: ['json'] }]
    })

    if (target.canceled || !target.filePath) return { filePath: '', cancelled: true }

    await writeFile(target.filePath, JSON.stringify(payload, null, 2), 'utf8')

    recordAudit(handle, {
      entity: 'catalog',
      entityId: null,
      action: 'export',
      summary: `Catálogo exportado: ${payload.instruments.length} instrumento(s) e ${payload.ranges.length} conjunto(s) de faixas.`
    })

    return { filePath: target.filePath, cancelled: false }
  })

  registerHandler('catalog:pickImport', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = await dialog.showOpenDialog(window!, {
      title: 'Importar catálogo',
      properties: ['openFile'],
      filters: [{ name: 'Catálogo do Baremo', extensions: ['json'] }]
    })

    const path = picked.filePaths[0]
    if (picked.canceled || path === undefined) {
      return { cancelled: true, token: null, fileName: '', plan: null }
    }

    const raw = await readFile(path, 'utf8')
    if (raw.length > MAX_IMPORT_BYTES) {
      throw invalid('O arquivo é grande demais para ser um catálogo do Baremo.')
    }

    const file = parseCatalogFile(raw)
    const plan = planCatalogImport(getDatabase(), file)

    pendingImport = { token: randomUUID(), fileName: basename(path), file }

    return {
      cancelled: false,
      token: pendingImport.token,
      fileName: pendingImport.fileName,
      plan
    }
  })

  registerHandler('catalog:applyImport', ({ token }) => {
    if (pendingImport === null || pendingImport.token !== token) {
      throw conflict('A importação expirou. Selecione o arquivo novamente.')
    }

    const { file, fileName } = pendingImport
    // Consumido antes de aplicar: um token só vale uma importação, mesmo que a
    // aplicação falhe. Repetir exige escolher o arquivo de novo, e a prévia
    // volta a ser calculada sobre o estado atual do banco.
    pendingImport = null

    const handle = getDatabase()
    const report = applyCatalogImport(handle, file)

    recordAudit(handle, {
      entity: 'catalog',
      entityId: null,
      action: 'update',
      summary:
        `Catálogo importado de "${fileName}": ` +
        `${report.instruments.created} instrumento(s) criado(s), ${report.instruments.updated} atualizado(s); ` +
        `${report.rangeSets.created + report.rangeSets.updated} conjunto(s) de faixas gravado(s).`
    })

    return report
  })
}
