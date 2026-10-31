/**
 * Ingestão e indexação da base de referências.
 *
 * Duas fases, de propósito:
 *  1. `importFiles` valida, copia o original e cria a linha `pending`. É rápido
 *     e responde ao IPC na hora.
 *  2. A fila indexa um documento por vez, em segundo plano: extrai o texto,
 *     divide em trechos, gera os vetores e grava tudo numa transação. A UI
 *     acompanha pelo `progress` e pelo status no banco.
 *
 * Não importa `electron`: a pasta dos originais e o embedder entram pelo
 * construtor, o que deixa a classe testável em Node puro.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { KnowledgeDatabase } from '../../db/gateway'
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  getKnowledgeDocument,
  listKnowledgeDocuments,
  replaceKnowledgeChunks,
  setKnowledgeStatus
} from '../../repositories/knowledge'
import type {
  KnowledgeDocument,
  KnowledgeImportResult,
  KnowledgeProgress
} from '@shared/contracts/entities-knowledge'
import { chunkPages } from './chunk'
import { detectType, extractText, NoTextError } from './extract'
import type { Embedder } from './embedder'

export const MAX_REFERENCE_BYTES = 100 * 1024 * 1024

/** Trechos por chamada ao embedder: dá passo ao progresso sem custo extra. */
const EMBED_STEP = 32

export class KnowledgeIndexer {
  private queue: string[] = []
  private running = false
  private current: KnowledgeProgress | null = null

  constructor(
    private readonly handle: () => KnowledgeDatabase,
    private readonly embedder: Embedder,
    private readonly storageDir: () => string
  ) {}

  get progress(): KnowledgeProgress | null {
    return this.current
  }

  /** Documentos que ficaram `pending` ou `indexing` numa sessão anterior voltam à fila. */
  resumePending(): void {
    for (const document of listKnowledgeDocuments(this.handle())) {
      if (document.status === 'pending' || document.status === 'indexing') {
        this.enqueue(document.id)
      }
    }
  }

  async importFiles(paths: readonly string[]): Promise<KnowledgeImportResult> {
    const added: KnowledgeDocument[] = []
    const rejected: { name: string; reason: string }[] = []

    for (const path of paths) {
      try {
        const document = await this.importOne(path)
        added.push(document)
        this.enqueue(document.id)
      } catch (error) {
        rejected.push({
          name: basename(path),
          reason: error instanceof Error ? error.message : 'Falha desconhecida ao importar.'
        })
      }
    }

    return { added, rejected }
  }

  /** Reindexa com o modelo atual (troca de modelo, ou nova tentativa após falha). */
  reindex(id: string): KnowledgeDocument {
    getKnowledgeDocument(this.handle(), id)
    setKnowledgeStatus(this.handle(), id, 'pending')
    this.enqueue(id)
    return getKnowledgeDocument(this.handle(), id)
  }

  async remove(id: string): Promise<void> {
    this.queue = this.queue.filter((queued) => queued !== id)
    const document = deleteKnowledgeDocument(this.handle(), id)
    await rm(this.originalPath(document.sha256, document.extension), { force: true })
  }

  /** Para os testes: resolve quando a fila esvazia. */
  async idle(): Promise<void> {
    while (this.running || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  private async importOne(path: string): Promise<KnowledgeDocument> {
    const { size } = await stat(path)
    if (size > MAX_REFERENCE_BYTES) {
      throw new Error(`O arquivo tem ${(size / 1024 / 1024).toFixed(0)} MB; o limite é 100 MB.`)
    }

    const bytes = await readFile(path)
    const { mime, extension } = await detectType(path, bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const originalName = basename(path)

    // A linha primeiro: um duplicado é recusado antes de qualquer escrita em disco.
    const document = createKnowledgeDocument(this.handle(), {
      title: titleFrom(originalName),
      originalName,
      sha256,
      extension,
      mime,
      sizeBytes: size
    })

    const target = this.originalPath(sha256, extension)
    if (!existsSync(target)) {
      await mkdir(this.storageDir(), { recursive: true })
      await writeFile(target, bytes)
    }
    return document
  }

  private enqueue(id: string): void {
    if (!this.queue.includes(id)) this.queue.push(id)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      for (let id = this.queue.shift(); id !== undefined; id = this.queue.shift()) {
        await this.index(id)
      }
    } finally {
      this.running = false
      this.current = null
    }
  }

  private async index(id: string): Promise<void> {
    const handle = this.handle()
    let document: KnowledgeDocument
    try {
      document = getKnowledgeDocument(handle, id)
    } catch {
      return // excluído enquanto esperava na fila
    }

    setKnowledgeStatus(handle, id, 'indexing')

    try {
      this.current = { documentId: id, stage: 'extracting', done: 0, total: 1 }
      const extracted = await extractText(
        this.originalPath(document.sha256, document.extension),
        document.mime
      )
      const chunks = chunkPages(extracted.pages)
      if (chunks.length === 0) throw new NoTextError()

      const vectors: Float32Array[] = []
      for (let start = 0; start < chunks.length; start += EMBED_STEP) {
        this.current = { documentId: id, stage: 'embedding', done: start, total: chunks.length }
        const batch = chunks.slice(start, start + EMBED_STEP).map((chunk) => chunk.text)
        vectors.push(...(await this.embedder.embed(batch, 'passage')))
      }

      if (!this.stillExists(id)) return

      this.current = { documentId: id, stage: 'saving', done: chunks.length, total: chunks.length }
      replaceKnowledgeChunks(handle, id, {
        chunks,
        vectors,
        pageCount: extracted.pageCount,
        embeddingModel: this.embedder.model
      })
    } catch (error) {
      if (!this.stillExists(id)) return
      const message = error instanceof Error ? error.message : 'Falha desconhecida ao indexar.'
      setKnowledgeStatus(handle, id, error instanceof NoTextError ? 'no_text' : 'failed', message)
    }
  }

  private stillExists(id: string): boolean {
    try {
      getKnowledgeDocument(this.handle(), id)
      return true
    } catch {
      return false
    }
  }

  private originalPath(sha256: string, extension: string): string {
    return join(this.storageDir(), `${sha256}.${extension}`)
  }
}

/** "Resolucao_CFP_06-2019.pdf" → "Resolucao CFP 06-2019". */
function titleFrom(fileName: string): string {
  const stem = basename(fileName, extname(fileName)).replace(/[_]+/g, ' ').replace(/\s+/g, ' ')
  return stem.trim().slice(0, 200) || fileName
}
