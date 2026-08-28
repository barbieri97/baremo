/**
 * Log de auditoria (spec §4.12).
 *
 * Registra operações destrutivas e exportações. Não versiona conteúdo — para
 * isso existe `document_versions`.
 */

import { randomUUID } from 'node:crypto'
import { desc } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { auditLog } from '../db/schema'
import type { AuditAction } from '@shared/labels'

export function recordAudit(
  handle: BaremoDatabase,
  entry: {
    entity: string
    entityId: string | null
    action: AuditAction
    summary: string
  }
): void {
  handle.db
    .insert(auditLog)
    .values({
      id: randomUUID(),
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      summary: entry.summary.slice(0, 1000)
    })
    .run()
}

export function listAudit(handle: BaremoDatabase, limit: number): (typeof auditLog.$inferSelect)[] {
  return handle.db.select().from(auditLog).orderBy(desc(auditLog.timestamp)).limit(limit).all()
}
