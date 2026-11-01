/**
 * Base de referências do assistente (RAG local).
 *
 * Bibliografia do profissional — normas, manuais, artigos —, global e sem
 * vínculo com paciente. O renderer só vê metadados e o progresso da indexação;
 * o texto dos trechos fica no processo principal.
 */

import { z } from 'zod'
import { idSchema, timestampSchema } from './entities'

export const KNOWLEDGE_STATUSES = ['pending', 'indexing', 'ready', 'failed', 'no_text'] as const
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number]

export const KNOWLEDGE_STATUS_LABELS: Readonly<Record<KnowledgeStatus, string>> = {
  pending: 'Na fila',
  indexing: 'Indexando',
  ready: 'Pronto',
  failed: 'Falhou',
  no_text: 'Sem texto'
}

export const knowledgeDocumentSchema = z.object({
  id: idSchema,
  title: z.string(),
  originalName: z.string(),
  sha256: z.string(),
  extension: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  pageCount: z.number().int().nullable(),
  chunkCount: z.number().int(),
  status: z.enum(KNOWLEDGE_STATUSES),
  error: z.string().nullable(),
  embeddingModel: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>

/** Progresso em memória do documento sendo indexado agora. */
export const knowledgeProgressSchema = z.object({
  documentId: idSchema,
  stage: z.enum(['model', 'extracting', 'embedding', 'saving']),
  done: z.number().int(),
  total: z.number().int()
})
export type KnowledgeProgress = z.infer<typeof knowledgeProgressSchema>

export const knowledgeOverviewSchema = z.object({
  documents: z.array(
    knowledgeDocumentSchema.extend({
      /** Indexado com outro modelo de embeddings: a busca não o enxerga até reindexar. */
      needsReindex: z.boolean()
    })
  ),
  progress: knowledgeProgressSchema.nullable(),
  /**
   * Motivo de a base estar desligada nesta máquina (a extensão vetorial não
   * carregou), ou `null`. O resto do app funciona normalmente nesse caso.
   */
  unavailable: z.string().nullable(),
  /** Download do modelo em curso (primeiro uso): arquivo e percentual. */
  modelDownload: z
    .object({ file: z.string().nullable(), percent: z.number().nullable() })
    .nullable()
})
export type KnowledgeOverview = z.infer<typeof knowledgeOverviewSchema>

export const knowledgeImportResultSchema = z.object({
  added: z.array(knowledgeDocumentSchema),
  rejected: z.array(z.object({ name: z.string(), reason: z.string() }))
})
export type KnowledgeImportResult = z.infer<typeof knowledgeImportResultSchema>
