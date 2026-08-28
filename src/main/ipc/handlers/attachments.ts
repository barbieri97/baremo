/**
 * Handlers de `attachments:*` (spec §8).
 *
 * O renderer trafega IDs, nunca caminhos (§13.3). A única exceção é o
 * drag-and-drop, em que `webUtils.getPathForFile` no preload produz um caminho —
 * que entra por `addFromPaths`, é validado aqui e some do vocabulário do
 * renderer logo em seguida.
 */

import { dialog, shell, BrowserWindow } from 'electron'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { conflict, notFound, registerHandler } from '../register'
import { attachments } from '../../db/schema'
import { attachmentById, ingestFiles, toAttachment, totalStoredBytes } from '../../services/attachments/ingest'
import { removeBlob, resolveBlobPath } from '../../services/attachments/storage'
import { getPatient } from '../../repositories/patients'
import { recordAudit } from '../../services/audit'
import { countWhere, nowIso } from '../../repositories/helpers'
import { FILE_SCHEME } from '../../protocol/schemes'

/** Aviso de quota agregada (§8.4); não bloqueia, apenas alerta na interface. */
const QUOTA_WARN_BYTES = 5 * 1024 * 1024 * 1024

export function registerAttachmentHandlers(): void {
  registerHandler('attachments:list', ({ patientId, assessmentId, includeArchived }) => {
    const handle = getDatabase()
    const filters: SQL[] = [eq(attachments.patientId, patientId)]

    if (assessmentId !== null) filters.push(eq(attachments.assessmentId, assessmentId))
    if (!includeArchived) filters.push(isNull(attachments.archivedAt))

    return handle.db
      .select()
      .from(attachments)
      .where(and(...filters))
      .orderBy(desc(attachments.createdAt))
      .all()
      .map(toAttachment)
  })

  registerHandler('attachments:pickAndAdd', async ({ patientId, assessmentId }) => {
    const handle = getDatabase()
    getPatient(handle, patientId)

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = await dialog.showOpenDialog(window!, {
      title: 'Anexar arquivos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Arquivos aceitos',
          extensions: [
            'pdf', 'png', 'jpg', 'jpeg', 'webp', 'docx', 'xlsx',
            'csv', 'txt', 'mp3', 'm4a', 'wav', 'mp4'
          ]
        }
      ]
    })

    if (picked.canceled) return { added: [], rejected: [] }

    const result = await ingestFiles(handle, {
      patientId,
      assessmentId,
      paths: picked.filePaths
    })

    auditIngest(patientId, result.added.length)
    return result
  })

  registerHandler('attachments:addFromPaths', async ({ patientId, assessmentId, paths }) => {
    const handle = getDatabase()
    getPatient(handle, patientId)

    const result = await ingestFiles(handle, { patientId, assessmentId, paths })
    auditIngest(patientId, result.added.length)
    return result
  })

  registerHandler('attachments:update', ({ id, description, tags, assessmentId }) => {
    const handle = getDatabase()

    const updated = handle.db
      .update(attachments)
      .set({ description, tags: JSON.stringify(tags), assessmentId })
      .where(eq(attachments.id, id))
      .run()
    if (updated.changes === 0) throw notFound('Arquivo não encontrado.')

    return requireAttachment(id)
  })

  registerHandler('attachments:setArchived', ({ id, archived }) => {
    const handle = getDatabase()
    const updated = handle.db
      .update(attachments)
      .set({ archivedAt: archived ? nowIso() : null })
      .where(eq(attachments.id, id))
      .run()
    if (updated.changes === 0) throw notFound('Arquivo não encontrado.')
    return requireAttachment(id)
  })

  /**
   * O blob só sai do disco quando nenhuma outra linha o referencia — o
   * armazenamento é deduplicado, e um mesmo arquivo pode estar anexado a dois
   * prontuários (§8.3).
   */
  registerHandler('attachments:delete', async ({ id }) => {
    const handle = getDatabase()
    const attachment = requireAttachment(id)

    handle.db.delete(attachments).where(eq(attachments.id, id)).run()

    const stillReferenced = countWhere(
      handle,
      attachments,
      eq(attachments.sha256, attachment.sha256)
    )
    if (stillReferenced === 0) {
      await removeBlob(attachment.sha256, attachment.extension)
    }

    recordAudit(handle, {
      entity: 'attachment',
      entityId: id,
      action: 'delete',
      summary: `Arquivo "${attachment.originalName}" excluído${stillReferenced === 0 ? ' (blob removido do disco)' : ' (blob mantido: em uso por outro registro)'}.`
    })

    return { ok: true as const }
  })

  registerHandler('attachments:url', ({ id }) => {
    requireAttachment(id)
    // O ID vira host da URL; o caminho real é resolvido no handler do protocolo.
    return { url: `${FILE_SCHEME}://${id}/` }
  })

  registerHandler('attachments:openExternal', async ({ id }) => {
    const attachment = requireAttachment(id)
    const path = resolveBlobPath(attachment.sha256, attachment.extension)

    const error = await shell.openPath(path)
    if (error) throw conflict(`Não foi possível abrir o arquivo: ${error}`)

    return { ok: true as const }
  })

  registerHandler('attachments:quota', () => ({
    totalBytes: totalStoredBytes(getDatabase()),
    warnAboveBytes: QUOTA_WARN_BYTES
  }))
}

function requireAttachment(id: string): ReturnType<typeof toAttachment> {
  const attachment = attachmentById(getDatabase(), id)
  if (attachment === null) throw notFound('Arquivo não encontrado.')
  return attachment
}

function auditIngest(patientId: string, count: number): void {
  if (count === 0) return
  recordAudit(getDatabase(), {
    entity: 'attachment',
    entityId: patientId,
    action: 'create',
    summary: `${count} arquivo(s) anexado(s) ao prontuário.`
  })
}

/**
 * Resolve o ID para o blob — injetado no handler do protocolo `baremo-file://`.
 * Fica aqui, e não no módulo de protocolo, para que o protocolo não precise
 * conhecer o schema do banco.
 */
export function resolveAttachmentForProtocol(
  id: string
): { path: string; mime: string } | null {
  const attachment = attachmentById(getDatabase(), id)
  if (attachment === null) return null

  return {
    path: resolveBlobPath(attachment.sha256, attachment.extension),
    mime: attachment.detectedMime
  }
}
