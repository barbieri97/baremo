/**
 * Base de referências do assistente: documentos, trechos e busca híbrida.
 *
 * GLOBAL, como as skills: bibliografia do profissional, sem vínculo com
 * paciente, e num banco próprio (`referencias.db`, ver `knowledge-schema.ts`).
 * Por isso fica fora do `AgentReadRepository`, e o orquestrador pode importá-lo
 * sem furar a camada 2 do §10.5: este repositório nem enxerga o prontuário.
 *
 * A busca combina dois sinais:
 *  - vetorial (sqlite-vec, distância de cosseno): acha trechos com o mesmo
 *    sentido, mesmo com outras palavras;
 *  - lexical (FTS5, BM25): acha o termo exato, que em norma importa muito
 *    ("Resolução CFP 06/2019", "critério A", uma sigla de teste).
 * As duas listas são fundidas por Reciprocal Rank Fusion, que só usa a posição
 * em cada lista e por isso dispensa calibrar escalas de pontuação diferentes.
 */

import { randomUUID } from 'node:crypto'
import { count, desc, eq } from 'drizzle-orm'
import type { KnowledgeDatabase } from '../db/gateway'
import { knowledgeDocuments } from '../db/knowledge-schema'
import type { Chunk } from '../services/knowledge/chunk'
import type { KnowledgeDocument, KnowledgeStatus } from '@shared/contracts/entities-knowledge'
import { KNOWLEDGE_STATUSES } from '@shared/contracts/entities-knowledge'
import { nowIso } from './helpers'

type Row = typeof knowledgeDocuments.$inferSelect

/** Candidatos buscados em cada lista antes da fusão. */
const CANDIDATES = 20
/** Constante do RRF; 60 é o valor do artigo original e o padrão de mercado. */
const RRF_K = 60

export const DEFAULT_SEARCH_LIMIT = 6
export const MAX_SEARCH_LIMIT = 10

export class KnowledgeDocumentNotFoundError extends Error {
  constructor() {
    super('Documento de referência não encontrado.')
    this.name = 'KnowledgeDocumentNotFoundError'
  }
}

export class DuplicateKnowledgeDocumentError extends Error {
  constructor(readonly existingTitle: string) {
    super(`Este arquivo já está na base de referências, como "${existingTitle}".`)
    this.name = 'DuplicateKnowledgeDocumentError'
  }
}

function toDocument(row: Row): KnowledgeDocument {
  const status = (KNOWLEDGE_STATUSES as readonly string[]).includes(row.status)
    ? (row.status as KnowledgeStatus)
    : 'failed'
  return { ...row, status }
}

export function listKnowledgeDocuments(handle: KnowledgeDatabase): KnowledgeDocument[] {
  return handle.db
    .select()
    .from(knowledgeDocuments)
    .orderBy(desc(knowledgeDocuments.createdAt))
    .all()
    .map(toDocument)
}

export function getKnowledgeDocument(handle: KnowledgeDatabase, id: string): KnowledgeDocument {
  const row = handle.db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).get()
  if (!row) throw new KnowledgeDocumentNotFoundError()
  return toDocument(row)
}

/** Documentos prontos para busca — é o que decide se a tool aparece no prompt. */
export function countReadyKnowledgeDocuments(handle: KnowledgeDatabase): number {
  const [row] = handle.db
    .select({ value: count() })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.status, 'ready'))
    .all()
  return row?.value ?? 0
}

export function createKnowledgeDocument(
  handle: KnowledgeDatabase,
  input: {
    title: string
    originalName: string
    sha256: string
    extension: string
    mime: string
    sizeBytes: number
  }
): KnowledgeDocument {
  const existing = handle.db
    .select()
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.sha256, input.sha256))
    .get()
  if (existing) throw new DuplicateKnowledgeDocumentError(existing.title)

  const now = nowIso()
  const row = { id: randomUUID(), ...input, status: 'pending', createdAt: now, updatedAt: now }
  handle.db.insert(knowledgeDocuments).values(row).run()
  return getKnowledgeDocument(handle, row.id)
}

export function setKnowledgeStatus(
  handle: KnowledgeDatabase,
  id: string,
  status: KnowledgeStatus,
  error: string | null = null
): void {
  handle.db
    .update(knowledgeDocuments)
    .set({ status, error, updatedAt: nowIso() })
    .where(eq(knowledgeDocuments.id, id))
    .run()
}

/**
 * Troca todos os trechos do documento de uma vez, numa transação: uma
 * reindexação que falhe no meio deixa o documento com os trechos antigos, nunca
 * com metade de cada.
 */
export function replaceKnowledgeChunks(
  handle: KnowledgeDatabase,
  documentId: string,
  input: {
    chunks: readonly Chunk[]
    vectors: readonly Float32Array[]
    pageCount: number | null
    embeddingModel: string
  }
): void {
  if (input.chunks.length !== input.vectors.length) {
    throw new Error('Quantidade de vetores diferente da de trechos.')
  }

  const insertChunk = handle.raw.prepare(
    'INSERT INTO knowledge_chunks (document_id, ordinal, page, text) VALUES (?, ?, ?, ?)'
  )
  const insertVector = handle.raw.prepare(
    'INSERT INTO knowledge_vec (chunk_id, embedding) VALUES (?, ?)'
  )

  handle.raw.transaction(() => {
    deleteChunks(handle, documentId)

    input.chunks.forEach((chunk, index) => {
      const { lastInsertRowid } = insertChunk.run(documentId, chunk.ordinal, chunk.page, chunk.text)
      // O vec0 exige a chave como inteiro do SQLite; BigInt evita o REAL.
      insertVector.run(BigInt(lastInsertRowid), input.vectors[index]!)
    })

    handle.db
      .update(knowledgeDocuments)
      .set({
        status: 'ready',
        error: null,
        chunkCount: input.chunks.length,
        pageCount: input.pageCount,
        embeddingModel: input.embeddingModel,
        updatedAt: nowIso()
      })
      .where(eq(knowledgeDocuments.id, documentId))
      .run()
  })()
}

export function renameKnowledgeDocument(
  handle: KnowledgeDatabase,
  id: string,
  title: string
): KnowledgeDocument {
  getKnowledgeDocument(handle, id)
  handle.db
    .update(knowledgeDocuments)
    .set({ title: title.trim(), updatedAt: nowIso() })
    .where(eq(knowledgeDocuments.id, id))
    .run()
  return getKnowledgeDocument(handle, id)
}

export function deleteKnowledgeDocument(handle: KnowledgeDatabase, id: string): KnowledgeDocument {
  const document = getKnowledgeDocument(handle, id)
  handle.raw.transaction(() => {
    deleteChunks(handle, id)
    handle.db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).run()
  })()
  return document
}

/** vec0 não tem FK: os vetores saem primeiro, depois os trechos (o trigger limpa o FTS). */
function deleteChunks(handle: KnowledgeDatabase, documentId: string): void {
  handle.raw
    .prepare(
      'DELETE FROM knowledge_vec WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE document_id = ?)'
    )
    .run(documentId)
  handle.raw.prepare('DELETE FROM knowledge_chunks WHERE document_id = ?').run(documentId)
}

export interface KnowledgeHit {
  readonly chunkId: number
  readonly documentId: string
  readonly title: string
  readonly page: number | null
  readonly text: string
  /** Pontuação do RRF; só serve para ordenar. */
  readonly score: number
}

export function searchKnowledge(
  handle: KnowledgeDatabase,
  input: {
    embedding: Float32Array
    text: string
    /** Só trechos vetorizados por este modelo são comparáveis com a pergunta. */
    model: string
    /** Vizinho vetorial mais distante que isto não conta como relevante. */
    maxDistance: number
    limit?: number
  }
): KnowledgeHit[] {
  const limit = Math.min(Math.max(1, Math.round(input.limit ?? DEFAULT_SEARCH_LIMIT)), MAX_SEARCH_LIMIT)

  // O KNN sempre devolve os k vizinhos, mesmo quando nenhum tem relação com a
  // pergunta; o corte por distância é o que permite uma busca voltar vazia.
  const vectorIds = (
    handle.raw
      .prepare(
        `SELECT v.chunk_id AS id, v.distance AS distance
           FROM knowledge_vec v
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance`
      )
      .all(input.embedding, CANDIDATES) as { id: number; distance: number }[]
  )
    .filter((row) => row.distance <= input.maxDistance)
    .map((row) => row.id)

  const ftsQuery = toFtsQuery(input.text)
  const lexicalIds =
    ftsQuery === null
      ? []
      : (
          handle.raw
            .prepare(
              'SELECT rowid AS id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?'
            )
            .all(ftsQuery, CANDIDATES) as { id: number }[]
        ).map((row) => row.id)

  const scores = new Map<number, number>()
  for (const ids of [vectorIds, lexicalIds]) {
    ids.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
  }
  if (scores.size === 0) return []

  // Os filtros ficam no JOIN: um documento que falhou, que ainda não terminou
  // de indexar ou que foi vetorizado por outro modelo não entra na resposta.
  const ids = [...scores.keys()]
  const rows = handle.raw
    .prepare(
      `SELECT c.id AS chunkId, c.document_id AS documentId, d.title AS title, c.page AS page, c.text AS text
         FROM knowledge_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
        WHERE d.status = 'ready'
          AND d.embedding_model = ?
          AND c.id IN (${ids.map(() => '?').join(',')})`
    )
    .all(input.model, ...ids) as Omit<KnowledgeHit, 'score'>[]

  return rows
    .map((row) => ({ ...row, score: scores.get(row.chunkId) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Pergunta em linguagem natural → consulta FTS5 segura.
 *
 * Cada termo vira uma frase entre aspas, ligada por OR: assim nenhum caractere
 * da pergunta é interpretado como sintaxe do FTS (`-`, `:`, `NEAR`, parênteses),
 * e um trecho não precisa conter todas as palavras para aparecer. Palavras de
 * uma ou duas letras ficam de fora — são quase todas artigos e preposições.
 */
export function toFtsQuery(text: string): string | null {
  const terms = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 3 || /\d/.test(term))
    )
  ].slice(0, 32)

  return terms.length === 0 ? null : terms.map((term) => `"${term}"`).join(' OR ')
}
