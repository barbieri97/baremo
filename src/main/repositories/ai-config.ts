/**
 * Configuração do módulo de IA (spec §10.2).
 *
 * A chave de API NÃO passa por aqui. Este repositório lida com estado visível:
 * ligado/desligado, modelo, pseudonimização, teto de tokens e a dica dos quatro
 * últimos caracteres. O segredo em si vive em `ai/key-store.ts`, cifrado com
 * `safeStorage`, e nunca é lido para fora do processo principal.
 */

import { eq, sql } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { aiConfig, SINGLETON_ID } from '../db/schema'
import type { AiConfig, AiModel } from '@shared/contracts/entities-ai'
import { AI_MODELS } from '@shared/contracts/entities-ai'

type Row = typeof aiConfig.$inferSelect

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function readRow(handle: BaremoDatabase): Row {
  const row = handle.db.select().from(aiConfig).where(eq(aiConfig.id, SINGLETON_ID)).get()
  if (row) return row

  // O seed cria a linha; recriá-la aqui evita que uma exclusão acidental deixe
  // a tela de configuração inacessível.
  handle.db.insert(aiConfig).values({ id: SINGLETON_ID }).onConflictDoNothing().run()
  return handle.db.select().from(aiConfig).where(eq(aiConfig.id, SINGLETON_ID)).get() as Row
}

/**
 * Estado do módulo, já com o contador de tokens zerado se virou o mês.
 * O teto do §10.2 é mensal, então a virada precisa acontecer na leitura.
 */
export function getAiConfig(
  handle: BaremoDatabase,
  safeStorageAvailable = false
): AiConfig {
  let row = readRow(handle)
  const period = currentPeriod()

  if (row.budgetPeriod !== period) {
    handle.db
      .update(aiConfig)
      .set({ budgetPeriod: period, tokensUsedThisMonth: 0 })
      .where(eq(aiConfig.id, SINGLETON_ID))
      .run()
    row = readRow(handle)
  }

  return {
    enabled: row.enabled,
    model: (AI_MODELS as readonly string[]).includes(row.model)
      ? (row.model as AiModel)
      : 'gemini-flash-latest',
    hasKey: row.keyHint !== null,
    keyHint: row.keyHint,
    keyPersisted: row.keyPersisted,
    safeStorageAvailable,
    pseudonymize: row.pseudonymize,
    monthlyTokenBudget: row.monthlyTokenBudget,
    tokensUsedThisMonth: row.tokensUsedThisMonth,
    budgetPeriod: row.budgetPeriod
  }
}

export function updateAiConfig(
  handle: BaremoDatabase,
  patch: Partial<{
    enabled: boolean
    model: AiModel
    keyHint: string | null
    keyPersisted: boolean
    pseudonymize: boolean
    monthlyTokenBudget: number
  }>
): void {
  handle.db.update(aiConfig).set(patch).where(eq(aiConfig.id, SINGLETON_ID)).run()
}

/** Soma o consumo do turno ao contador mensal (§10.2). */
export function addTokenUsage(handle: BaremoDatabase, tokens: number): void {
  handle.db
    .update(aiConfig)
    .set({
      tokensUsedThisMonth: sql`${aiConfig.tokensUsedThisMonth} + ${Math.max(0, Math.round(tokens))}`,
      budgetPeriod: currentPeriod()
    })
    .where(eq(aiConfig.id, SINGLETON_ID))
    .run()
}

/** `true` quando o teto mensal já foi atingido e o módulo deve recusar chamadas. */
export function budgetExhausted(config: AiConfig): boolean {
  return config.monthlyTokenBudget > 0 && config.tokensUsedThisMonth >= config.monthlyTokenBudget
}
