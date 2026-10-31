/**
 * Handlers de `knowledge:*`: base de referências do assistente (RAG local).
 *
 * Como em `attachments:*`, o renderer nunca envia caminho: o arquivo é escolhido
 * pelo diálogo nativo, aqui no processo principal. O progresso da indexação não
 * tem canal de evento próprio; a tela consulta `knowledge:overview` enquanto
 * houver documento na fila, o que mantém a superfície do preload como está.
 *
 * O banco de referências (`referencias.db`) abre sob demanda e de forma
 * TOLERANTE: se a extensão vetorial não carregar nesta máquina, o recurso fica
 * desligado com o motivo à vista nas configurações, e nada mais do app é
 * afetado. O prontuário (`baremo.db`) nunca carrega a extensão.
 */

import { app, BrowserWindow, dialog } from 'electron'
import { openKnowledgeDatabase } from '../../db/gateway'
import type { KnowledgeDatabase } from '../../db/gateway'
import { HandlerError, conflict, notFound, registerHandler } from '../register'
import { knowledgeDatabasePath, referencesDir } from '../../paths'
import {
  DuplicateKnowledgeDocumentError,
  KnowledgeDocumentNotFoundError,
  listKnowledgeDocuments,
  renameKnowledgeDocument
} from '../../repositories/knowledge'
import { KnowledgeIndexer } from '../../services/knowledge/ingest'
import { UtilityEmbedder } from '../../services/knowledge/utility-embedder'
import type { Embedder, ModelProgress } from '../../services/knowledge/embedder'

let database: KnowledgeDatabase | null = null
/** Motivo da falha ao abrir; tentado uma vez por execução do app. */
let unavailable: string | null = null
let embedder: UtilityEmbedder | null = null
let indexer: KnowledgeIndexer | null = null
let modelDownload: ModelProgress | null = null

/** Banco de referências, ou `null` quando a extensão vetorial não carregou. */
export function knowledgeDatabase(): KnowledgeDatabase | null {
  if (database !== null || unavailable !== null) return database

  try {
    database = openKnowledgeDatabase(knowledgeDatabasePath())
    app.on('will-quit', () => database?.close())
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[knowledge] base de referências desligada:', detail)
    unavailable = `A busca vetorial não pôde ser carregada neste computador (${detail}). O restante do aplicativo funciona normalmente.`
  }
  return database
}

/** Único embedder do app: o orquestrador vetoriza a pergunta com o mesmo processo. */
export function knowledgeEmbedder(): Embedder {
  if (embedder === null) {
    embedder = new UtilityEmbedder((progress) => {
      // O transformers.js manda 100% ao fim de cada arquivo do modelo; o
      // download só "acaba" de fato quando o próximo lote de vetores sai.
      modelDownload = progress
    })
    app.on('will-quit', () => embedder?.dispose())
  }
  return embedder
}

function requireDatabase(): KnowledgeDatabase {
  const opened = knowledgeDatabase()
  if (opened === null) throw new HandlerError('io', unavailable ?? 'Base de referências indisponível.')
  return opened
}

function getIndexer(): KnowledgeIndexer {
  if (indexer === null) {
    const shared = knowledgeEmbedder()
    const tracked: Embedder = {
      model: shared.model,
      maxDistance: shared.maxDistance,
      embed: async (texts, kind) => {
        const vectors = await shared.embed(texts, kind)
        modelDownload = null
        return vectors
      }
    }
    indexer = new KnowledgeIndexer(requireDatabase, tracked, referencesDir)
  }
  return indexer
}

export function registerKnowledgeHandlers(): void {
  // Documento que ficou na fila quando o app fechou volta a indexar sozinho.
  // Sem extensão, não há o que retomar, e o boot segue normalmente.
  if (knowledgeDatabase() !== null) getIndexer().resumePending()

  registerHandler('knowledge:overview', () => {
    const opened = knowledgeDatabase()
    if (opened === null) {
      return { documents: [], progress: null, unavailable, modelDownload: null }
    }

    const model = knowledgeEmbedder().model
    return {
      documents: listKnowledgeDocuments(opened).map((document) => ({
        ...document,
        needsReindex:
          document.status === 'ready' &&
          document.embeddingModel !== null &&
          document.embeddingModel !== model
      })),
      progress: getIndexer().progress,
      unavailable: null,
      modelDownload
    }
  })

  registerHandler('knowledge:pickAndImport', async () => {
    requireDatabase()

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = await dialog.showOpenDialog(window!, {
      title: 'Importar documentos de referência',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'txt', 'md'] }]
    })

    if (picked.canceled) return { added: [], rejected: [] }
    return getIndexer().importFiles(picked.filePaths)
  })

  registerHandler('knowledge:rename', ({ id, title }) =>
    withKnowledgeErrors(() => renameKnowledgeDocument(requireDatabase(), id, title))
  )

  registerHandler('knowledge:reindex', ({ id }) => withKnowledgeErrors(() => getIndexer().reindex(id)))

  registerHandler('knowledge:delete', async ({ id }) => {
    await withKnowledgeErrors(() => getIndexer().remove(id))
    return { ok: true as const }
  })
}

function withKnowledgeErrors<T>(operation: () => T): T {
  try {
    const result = operation()
    if (result instanceof Promise) {
      return result.catch((error: unknown) => {
        throw translate(error)
      }) as T
    }
    return result
  } catch (error) {
    throw translate(error)
  }
}

function translate(error: unknown): unknown {
  if (error instanceof KnowledgeDocumentNotFoundError) return notFound(error.message)
  if (error instanceof DuplicateKnowledgeDocumentError) return conflict(error.message)
  return error
}
