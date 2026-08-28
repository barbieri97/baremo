/**
 * Auditoria do módulo de IA (spec §10.9).
 *
 * Registra o que é preciso para responder, depois, três perguntas: o que foi
 * enviado, sob que configuração, e se alguma barreira foi acionada. A coluna
 * `idRevalidationFailed` é a mais importante — é o rastro de uma tentativa de
 * acesso a registro de outro prontuário (§10.5, camada 3).
 */

import { randomUUID } from 'node:crypto'
import { desc } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { aiAudit } from '../db/schema'
import type { AiAudit } from '@shared/contracts/entities-ai'
import { nowIso } from '../repositories/helpers'

export interface AiAuditEntry {
  readonly sessionId: string | null
  readonly patientId: string | null
  readonly model: string
  readonly toolCalls: readonly { name: string; args: unknown }[]
  readonly inputTokens: number
  readonly outputTokens: number
  readonly pseudonymized: boolean
  readonly blockedBySafetyFilter: boolean
  readonly idRevalidationFailed: boolean
  readonly detail: string | null
}

export function recordAiAudit(handle: BaremoDatabase, entry: AiAuditEntry): void {
  handle.db
    .insert(aiAudit)
    .values({
      id: randomUUID(),
      timestamp: nowIso(),
      sessionId: entry.sessionId,
      patientId: entry.patientId,
      model: entry.model,
      toolCallsJson: JSON.stringify(entry.toolCalls),
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      pseudonymized: entry.pseudonymized,
      blockedBySafetyFilter: entry.blockedBySafetyFilter,
      idRevalidationFailed: entry.idRevalidationFailed,
      detail: entry.detail
    })
    .run()
}

/** Registro avulso — desligar a pseudonimização, por exemplo (§10.3). */
export function recordAiEvent(
  handle: BaremoDatabase,
  detail: string,
  options: { pseudonymized: boolean }
): void {
  recordAiAudit(handle, {
    sessionId: null,
    patientId: null,
    model: '',
    toolCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    pseudonymized: options.pseudonymized,
    blockedBySafetyFilter: false,
    idRevalidationFailed: false,
    detail
  })
}

export function listAiAudit(handle: BaremoDatabase, limit: number): AiAudit[] {
  return handle.db
    .select()
    .from(aiAudit)
    .orderBy(desc(aiAudit.timestamp))
    .limit(limit)
    .all() as AiAudit[]
}
