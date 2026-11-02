/**
 * Configuração do módulo de IA (spec §10.2).
 *
 * A chave de API NÃO passa por aqui. Este repositório lida com estado visível:
 * ligado/desligado, empresa e modelo, pseudonimização, teto de tokens e a dica
 * dos quatro últimos caracteres de cada chave. O segredo em si vive em
 * `ai/key-store.ts`, cifrado com `safeStorage`, e nunca é lido para fora do
 * processo principal.
 */

import { eq, sql } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { aiConfig, SINGLETON_ID } from '../db/schema'
import type { AiConfig, AiModel, AiProviderId, AiProviderKey } from '@shared/contracts/entities-ai'
import { AI_MODELS_BY_PROVIDER, AI_PROVIDERS, defaultModelFor } from '@shared/contracts/entities-ai'

type Row = typeof aiConfig.$inferSelect

type StoredKeys = Partial<Record<AiProviderId, { hint: string; persisted: boolean }>>

function parseKeys(json: string): StoredKeys {
  try {
    const parsed = JSON.parse(json) as unknown
    if (parsed === null || typeof parsed !== 'object') return {}
    const keys: StoredKeys = {}
    for (const provider of AI_PROVIDERS) {
      const entry = (parsed as Record<string, unknown>)[provider]
      if (
        entry !== null &&
        typeof entry === 'object' &&
        typeof (entry as { hint?: unknown }).hint === 'string'
      ) {
        keys[provider] = {
          hint: (entry as { hint: string }).hint,
          persisted: (entry as { persisted?: unknown }).persisted !== false
        }
      }
    }
    return keys
  } catch {
    return {}
  }
}

function asProvider(value: string): AiProviderId {
  return (AI_PROVIDERS as readonly string[]).includes(value) ? (value as AiProviderId) : 'gemini'
}

/** Modelo gravado, se for da empresa ativa; senão, o padrão dela. */
function modelFor(provider: AiProviderId, stored: string): AiModel {
  return (AI_MODELS_BY_PROVIDER[provider] as readonly string[]).includes(stored)
    ? (stored as AiModel)
    : defaultModelFor(provider)
}

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

  const provider = asProvider(row.provider)
  const stored = parseKeys(row.providerKeys)
  const keyOf = (id: AiProviderId): AiProviderKey => ({
    hasKey: stored[id] !== undefined,
    keyHint: stored[id]?.hint ?? null,
    keyPersisted: stored[id]?.persisted ?? true
  })
  const active = keyOf(provider)

  return {
    enabled: row.enabled,
    provider,
    model: modelFor(provider, row.model),
    hasKey: active.hasKey,
    keyHint: active.keyHint,
    keyPersisted: active.keyPersisted,
    keys: { gemini: keyOf('gemini'), anthropic: keyOf('anthropic'), openai: keyOf('openai') },
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
    pseudonymize: boolean
    monthlyTokenBudget: number
  }>
): void {
  handle.db.update(aiConfig).set(patch).where(eq(aiConfig.id, SINGLETON_ID)).run()
}

/**
 * Troca a empresa ativa. O modelo passa ao padrão da nova empresa, a menos que
 * o modelo pedido seja dela.
 */
export function setAiProvider(
  handle: BaremoDatabase,
  provider: AiProviderId,
  model?: AiModel
): void {
  handle.db
    .update(aiConfig)
    .set({ provider, model: modelFor(provider, model ?? '') })
    .where(eq(aiConfig.id, SINGLETON_ID))
    .run()
}

/** Grava (ou apaga, com `null`) a dica da chave de uma empresa. */
export function setProviderKey(
  handle: BaremoDatabase,
  provider: AiProviderId,
  key: { hint: string; persisted: boolean } | null
): void {
  const keys = parseKeys(readRow(handle).providerKeys)
  if (key === null) delete keys[provider]
  else keys[provider] = key

  handle.db
    .update(aiConfig)
    .set({ providerKeys: JSON.stringify(keys) })
    .where(eq(aiConfig.id, SINGLETON_ID))
    .run()
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
