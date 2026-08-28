/**
 * Manutenção do storage de arquivos (spec §8.3).
 *
 * O banco e o filesystem podem divergir: uma queda no meio da ingestão deixa
 * blob sem linha; uma restauração de backup mais antigo deixa linha sem blob. A
 * varredura relata os dois casos e só limpa quando o usuário confirma.
 */

import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { inArray } from 'drizzle-orm'
import type { BaremoDatabase } from '../../db/gateway'
import { attachments } from '../../db/schema'
import { exists, resolveBlobPath, storageRoot } from './storage'

export interface OrphanBlob {
  relativePath: string
  sizeBytes: number
}

export interface BrokenReference {
  attachmentId: string
  originalName: string
  sha256: string
}

export interface StorageScan {
  orphanBlobs: OrphanBlob[]
  brokenReferences: BrokenReference[]
}

export async function scanStorage(handle: BaremoDatabase): Promise<StorageScan> {
  const rows = handle.db
    .select({
      id: attachments.id,
      originalName: attachments.originalName,
      sha256: attachments.sha256,
      extension: attachments.extension
    })
    .from(attachments)
    .all()

  const referenced = new Set(rows.map((row) => `${row.sha256}.${row.extension}`))

  const brokenReferences: BrokenReference[] = []
  for (const row of rows) {
    if (!(await exists(resolveBlobPath(row.sha256, row.extension)))) {
      brokenReferences.push({
        attachmentId: row.id,
        originalName: row.originalName,
        sha256: row.sha256
      })
    }
  }

  const orphanBlobs: OrphanBlob[] = []
  const root = storageRoot()

  for (const prefix of await safeReaddir(root)) {
    const directory = join(root, prefix)
    const info = await stat(directory).catch(() => null)
    if (info === null || !info.isDirectory()) continue

    for (const fileName of await safeReaddir(directory)) {
      if (referenced.has(fileName)) continue

      const fileInfo = await stat(join(directory, fileName)).catch(() => null)
      if (fileInfo === null || !fileInfo.isFile()) continue

      orphanBlobs.push({
        relativePath: join(prefix, fileName),
        sizeBytes: fileInfo.size
      })
    }
  }

  return { orphanBlobs, brokenReferences }
}

export interface CleanupOutcome {
  blobsDeleted: number
  referencesRemoved: number
}

export async function cleanupStorage(
  handle: BaremoDatabase,
  options: { deleteOrphanBlobs: boolean; removeBrokenReferences: boolean }
): Promise<CleanupOutcome> {
  // Reexecuta a varredura em vez de confiar num relatório que o renderer
  // devolveria: entre ver a lista e confirmar, o estado pode ter mudado.
  const scan = await scanStorage(handle)

  let blobsDeleted = 0
  let referencesRemoved = 0

  if (options.deleteOrphanBlobs) {
    const root = storageRoot()
    for (const orphan of scan.orphanBlobs) {
      await rm(join(root, orphan.relativePath), { force: true })
      blobsDeleted++
    }
  }

  if (options.removeBrokenReferences && scan.brokenReferences.length > 0) {
    const ids = scan.brokenReferences.map((reference) => reference.attachmentId)
    const result = handle.db.delete(attachments).where(inArray(attachments.id, ids)).run()
    referencesRemoved = result.changes
  }

  return { blobsDeleted, referencesRemoved }
}

async function safeReaddir(path: string): Promise<string[]> {
  return readdir(path).catch(() => [])
}
