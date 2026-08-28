/**
 * Documentos e versões (spec §9.4).
 *
 * Duas regras com consequência jurídica, não de conveniência:
 *
 *  - documento `finalized` é somente leitura;
 *  - reabrir para edição CRIA uma versão nova e PRESERVA a anterior.
 *
 * Quem assinou um laudo precisa poder demonstrar o que estava escrito quando
 * assinou. Por isso o versionamento é próprio, e não o da TipTap (ADR-005).
 */

import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { documentTemplates, documentVersions, documents } from '../db/schema'
import type { BaremoDocument, DocumentTemplate, DocumentVersion } from '@shared/contracts/entities'
import { conflict, notFound } from '../ipc/register'
import { nowIso } from './helpers'
import { getPatient } from './patients'
import type { DocumentStatus, DocumentType } from '@shared/labels'

/** Intervalo entre snapshots durante edição ativa (§9.4). */
const AUTOSAVE_VERSION_INTERVAL_MS = 10 * 60 * 1000

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

type Row = typeof documents.$inferSelect

function toDocument(row: Row): BaremoDocument {
  return {
    ...row,
    type: row.type as DocumentType,
    status: row.status as DocumentStatus,
    origin: row.origin as 'human' | 'assisted_by_ai',
    contentJson: parseJson(row.contentJson)
  } as BaremoDocument
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return EMPTY_DOC
  }
}

export function listDocuments(
  handle: BaremoDatabase,
  patientId: string,
  assessmentId: string | null
): Omit<BaremoDocument, 'contentJson'>[] {
  const filters: SQL[] = [eq(documents.patientId, patientId)]
  if (assessmentId !== null) filters.push(eq(documents.assessmentId, assessmentId))

  return handle.db
    .select()
    .from(documents)
    .where(and(...filters))
    .orderBy(desc(documents.updatedAt))
    .all()
    // A listagem omite o conteúdo de propósito: um documento longo multiplicado
    // por dezenas de linhas encheria o payload do IPC sem a tela usar nada disso.
    .map((row) => omitContent(toDocument(row)))
}

function omitContent(document: BaremoDocument): Omit<BaremoDocument, 'contentJson'> {
  const copy: Partial<BaremoDocument> = { ...document }
  delete copy.contentJson
  return copy as Omit<BaremoDocument, 'contentJson'>
}

export function getDocument(handle: BaremoDatabase, id: string): BaremoDocument {
  const row = handle.db.select().from(documents).where(eq(documents.id, id)).get()
  if (!row) throw notFound('Documento não encontrado.')
  return toDocument(row)
}

export function createDocument(
  handle: BaremoDatabase,
  input: {
    patientId: string
    assessmentId: string | null
    type: DocumentType
    title: string
    templateId: string | null
  }
): BaremoDocument {
  getPatient(handle, input.patientId)

  const content =
    input.templateId !== null ? templateContent(handle, input.templateId) : EMPTY_DOC

  const id = randomUUID()
  const timestamp = nowIso()

  handle.db
    .insert(documents)
    .values({
      id,
      patientId: input.patientId,
      assessmentId: input.assessmentId,
      type: input.type,
      title: input.title,
      contentJson: JSON.stringify(content),
      status: 'draft',
      origin: 'human',
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finalizedAt: null
    })
    .run()

  return getDocument(handle, id)
}

/**
 * Cria um documento a partir de uma tool de escrita da IA (§10.6).
 *
 * Separado de `createDocument` porque marca `origin = assisted_by_ai`, o que
 * ativa a exigência de revisão explícita antes da finalização (§10.9).
 */
export function createAiDraft(
  handle: BaremoDatabase,
  input: {
    patientId: string
    assessmentId: string | null
    type: DocumentType
    title: string
    content: unknown
  }
): BaremoDocument {
  const id = randomUUID()
  const timestamp = nowIso()

  handle.db
    .insert(documents)
    .values({
      id,
      patientId: input.patientId,
      assessmentId: input.assessmentId,
      type: input.type,
      title: input.title,
      contentJson: JSON.stringify(input.content ?? EMPTY_DOC),
      status: 'draft',
      origin: 'assisted_by_ai',
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      finalizedAt: null
    })
    .run()

  return getDocument(handle, id)
}

export interface SaveContentOutcome {
  updatedAt: string
  versionCreated: boolean
}

/**
 * Grava o conteúdo do autosave.
 *
 * Um snapshot só é criado quando o último tem mais de dez minutos: o autosave
 * roda a cada 1,5 s de pausa na digitação, e versionar a cada gravação encheria
 * a tabela de ruído sem ganho de recuperação.
 */
export function saveContent(
  handle: BaremoDatabase,
  id: string,
  contentJson: unknown
): SaveContentOutcome {
  const document = getDocument(handle, id)

  if (document.status === 'finalized') {
    throw conflict(
      'Este documento está finalizado e é somente leitura. Reabra-o para edição — uma nova versão será criada e a atual, preservada.'
    )
  }

  const timestamp = nowIso()
  const serialized = JSON.stringify(contentJson ?? EMPTY_DOC)

  const shouldVersion = isVersionDue(handle, id, timestamp)
  if (shouldVersion) {
    insertVersion(handle, id, document.contentJson, 'autosave', timestamp)
  }

  handle.db
    .update(documents)
    .set({ contentJson: serialized, updatedAt: timestamp })
    .where(eq(documents.id, id))
    .run()

  return { updatedAt: timestamp, versionCreated: shouldVersion }
}

function isVersionDue(handle: BaremoDatabase, documentId: string, now: string): boolean {
  const last = handle.db
    .select({ createdAt: documentVersions.createdAt })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .limit(1)
    .get()

  if (!last) return true
  return Date.parse(now) - Date.parse(last.createdAt) >= AUTOSAVE_VERSION_INTERVAL_MS
}

function insertVersion(
  handle: BaremoDatabase,
  documentId: string,
  content: unknown,
  reason: 'autosave' | 'finalized' | 'reopened',
  timestamp: string
): void {
  handle.db
    .insert(documentVersions)
    .values({
      id: randomUUID(),
      documentId,
      contentJson: JSON.stringify(content ?? EMPTY_DOC),
      reason,
      createdAt: timestamp
    })
    .run()
}

export function updateMeta(
  handle: BaremoDatabase,
  id: string,
  input: { title: string; type: DocumentType; assessmentId: string | null }
): BaremoDocument {
  const document = getDocument(handle, id)
  if (document.status === 'finalized') {
    throw conflict('Documento finalizado é somente leitura. Reabra-o para editar.')
  }

  handle.db.update(documents).set({ ...input, updatedAt: nowIso() }).where(eq(documents.id, id)).run()
  return getDocument(handle, id)
}

/**
 * Transição de status.
 *
 * Finalizar grava um snapshot com motivo `finalized`; reabrir grava um com
 * motivo `reopened`, antes de liberar a edição. Documento assistido por IA não
 * finaliza sem revisão explícita (§10.9).
 */
export function setStatus(
  handle: BaremoDatabase,
  id: string,
  status: DocumentStatus
): BaremoDocument {
  const document = getDocument(handle, id)
  const timestamp = nowIso()

  if (status === 'finalized') {
    if (document.origin === 'assisted_by_ai' && document.reviewedAt === null) {
      throw conflict(
        'Este documento foi redigido com auxílio de IA e ainda não foi revisado. Registre a revisão antes de finalizá-lo.'
      )
    }

    insertVersion(handle, id, document.contentJson, 'finalized', timestamp)
    handle.db
      .update(documents)
      .set({ status: 'finalized', finalizedAt: timestamp, updatedAt: timestamp })
      .where(eq(documents.id, id))
      .run()

    return getDocument(handle, id)
  }

  if (document.status === 'finalized') {
    // Reabertura: a versão finalizada permanece na tabela; esta marca o ponto de
    // retorno à edição.
    insertVersion(handle, id, document.contentJson, 'reopened', timestamp)
  }

  handle.db
    .update(documents)
    .set({ status, finalizedAt: null, updatedAt: timestamp })
    .where(eq(documents.id, id))
    .run()

  return getDocument(handle, id)
}

export function markReviewed(handle: BaremoDatabase, id: string): BaremoDocument {
  getDocument(handle, id)
  handle.db
    .update(documents)
    .set({ reviewedAt: nowIso() })
    .where(eq(documents.id, id))
    .run()
  return getDocument(handle, id)
}

export function listVersions(
  handle: BaremoDatabase,
  documentId: string
): Omit<DocumentVersion, 'contentJson'>[] {
  return handle.db
    .select({
      id: documentVersions.id,
      documentId: documentVersions.documentId,
      reason: documentVersions.reason,
      createdAt: documentVersions.createdAt
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.createdAt))
    .all() as Omit<DocumentVersion, 'contentJson'>[]
}

export function getVersion(handle: BaremoDatabase, versionId: string): DocumentVersion {
  const row = handle.db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId))
    .get()
  if (!row) throw notFound('Versão não encontrada.')

  return { ...row, contentJson: parseJson(row.contentJson) } as DocumentVersion
}

/**
 * Restaura uma versão anterior.
 *
 * O conteúdo atual vira snapshot antes de ser substituído: restaurar nunca
 * descarta o que estava lá.
 */
export function restoreVersion(
  handle: BaremoDatabase,
  documentId: string,
  versionId: string
): BaremoDocument {
  const document = getDocument(handle, documentId)
  const version = getVersion(handle, versionId)

  if (version.documentId !== documentId) {
    throw conflict('Esta versão pertence a outro documento.')
  }
  if (document.status === 'finalized') {
    throw conflict('Documento finalizado é somente leitura. Reabra-o para restaurar uma versão.')
  }

  const timestamp = nowIso()
  insertVersion(handle, documentId, document.contentJson, 'autosave', timestamp)

  handle.db
    .update(documents)
    .set({ contentJson: JSON.stringify(version.contentJson), updatedAt: timestamp })
    .where(eq(documents.id, documentId))
    .run()

  return getDocument(handle, documentId)
}

export function deleteDocument(handle: BaremoDatabase, id: string): void {
  const result = handle.db.delete(documents).where(eq(documents.id, id)).run()
  if (result.changes === 0) throw notFound('Documento não encontrado.')
}

// ─── Modelos (§9.5) ──────────────────────────────────────────────────────────

export function listTemplates(handle: BaremoDatabase): DocumentTemplate[] {
  return handle.db
    .select()
    .from(documentTemplates)
    .orderBy(documentTemplates.name)
    .all()
    .map((row) => ({
      ...row,
      type: row.type as DocumentType,
      contentJson: parseJson(row.contentJson)
    })) as DocumentTemplate[]
}

function templateContent(handle: BaremoDatabase, templateId: string): unknown {
  const row = handle.db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, templateId))
    .get()
  if (!row) throw notFound('Modelo não encontrado.')
  return parseJson(row.contentJson)
}

export function saveTemplate(
  handle: BaremoDatabase,
  input: { id: string | null; type: DocumentType; name: string; contentJson: unknown }
): DocumentTemplate {
  const id = input.id ?? randomUUID()
  const values = {
    id,
    type: input.type,
    name: input.name,
    contentJson: JSON.stringify(input.contentJson ?? EMPTY_DOC),
    isSeed: false
  }

  handle.db
    .insert(documentTemplates)
    .values(values)
    .onConflictDoUpdate({
      target: documentTemplates.id,
      set: { type: values.type, name: values.name, contentJson: values.contentJson }
    })
    .run()

  const saved = listTemplates(handle).find((template) => template.id === id)
  if (!saved) throw notFound('Modelo não encontrado após salvar.')
  return saved
}

export function deleteTemplate(handle: BaremoDatabase, id: string): void {
  const result = handle.db.delete(documentTemplates).where(eq(documentTemplates.id, id)).run()
  if (result.changes === 0) throw notFound('Modelo não encontrado.')
}

/** Documentos de um paciente sem avaliação vinculada — usado na exportação. */
export function listUnlinkedDocuments(
  handle: BaremoDatabase,
  patientId: string
): BaremoDocument[] {
  return handle.db
    .select()
    .from(documents)
    .where(and(eq(documents.patientId, patientId), isNull(documents.assessmentId)))
    .all()
    .map(toDocument)
}
