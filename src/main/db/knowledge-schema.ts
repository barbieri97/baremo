/**
 * Schema do banco da base de referências (`referencias.db`).
 *
 * É um arquivo SEPARADO do `baremo.db` de propósito: a busca vetorial depende
 * da extensão nativa `sqlite-vec`, e o prontuário não pode depender dela. Se a
 * extensão não carregar numa máquina, só a base de referências fica
 * indisponível; pacientes, avaliações e documentos abrem normalmente.
 *
 * O conteúdo é derivável: os originais ficam em `userData/referencias/` e
 * podem ser reindexados. Por isso este banco não entra no backup do prontuário.
 *
 * As tabelas virtuais `knowledge_vec` (vec0) e `knowledge_fts` (FTS5) não são
 * declaradas aqui; ver `KNOWLEDGE_MIGRATIONS`. O `rowid` de ambas é o `id` de
 * `knowledge_chunks`.
 */

import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

export const knowledgeDocuments = sqliteTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    originalName: text('original_name').notNull(),
    sha256: text('sha256').notNull(),
    extension: text('extension').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    pageCount: integer('page_count'),
    chunkCount: integer('chunk_count').notNull().default(0),
    /** `pending | indexing | ready | failed | no_text` */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    /** Modelo que gerou os vetores; outro modelo exige reindexar. */
    embeddingModel: text('embedding_model'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (table) => [uniqueIndex('uq_knowledge_documents_sha256').on(table.sha256)]
)

export const knowledgeChunks = sqliteTable(
  'knowledge_chunks',
  {
    id: integer('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    page: integer('page'),
    text: text('text').notNull()
  },
  (table) => [index('idx_knowledge_chunks_document').on(table.documentId)]
)

/**
 * Migrations do banco de referências, versionadas por `PRAGMA user_version`
 * como as do prontuário. Mesma regra: migration publicada não se edita.
 */
export const KNOWLEDGE_MIGRATIONS: readonly { version: number; statements: readonly string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE knowledge_documents (
         id TEXT PRIMARY KEY NOT NULL,
         title TEXT NOT NULL,
         original_name TEXT NOT NULL,
         sha256 TEXT NOT NULL,
         extension TEXT NOT NULL,
         mime TEXT NOT NULL,
         size_bytes INTEGER NOT NULL,
         page_count INTEGER,
         chunk_count INTEGER NOT NULL DEFAULT 0,
         status TEXT NOT NULL DEFAULT 'pending',
         error TEXT,
         embedding_model TEXT,
         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
         updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       )`,
      `CREATE UNIQUE INDEX uq_knowledge_documents_sha256 ON knowledge_documents (sha256)`,
      `CREATE TABLE knowledge_chunks (
         id INTEGER PRIMARY KEY NOT NULL,
         document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
         ordinal INTEGER NOT NULL,
         page INTEGER,
         text TEXT NOT NULL
       )`,
      `CREATE INDEX idx_knowledge_chunks_document ON knowledge_chunks (document_id)`,
      `CREATE VIRTUAL TABLE knowledge_vec USING vec0(
         chunk_id INTEGER PRIMARY KEY,
         embedding float[384] distance_metric=cosine
       )`,
      `CREATE VIRTUAL TABLE knowledge_fts USING fts5(
         text,
         content='knowledge_chunks',
         content_rowid='id',
         tokenize='unicode61 remove_diacritics 2'
       )`,
      `CREATE TRIGGER knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
         INSERT INTO knowledge_fts (rowid, text) VALUES (new.id, new.text);
       END`,
      `CREATE TRIGGER knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
         INSERT INTO knowledge_fts (knowledge_fts, rowid, text) VALUES ('delete', old.id, old.text);
       END`
    ]
  }
]
