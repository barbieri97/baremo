/**
 * Utilitários compartilhados pelos repositórios.
 */

import { sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { BaremoDatabase } from '../db/gateway'

/** `SELECT count(*)` com filtro — o padrão por trás dos modais de impacto (§6.3). */
export function countWhere(
  handle: BaremoDatabase,
  table: SQLiteTable,
  condition?: SQL
): number {
  const query = handle.db.select({ total: sql<number>`count(*)` }).from(table)
  const row = condition ? query.where(condition).get() : query.get()
  return row?.total ?? 0
}

/**
 * Neutraliza os curingas do LIKE.
 *
 * Sem isso, buscar por um nome que contenha `_` casaria com qualquer caractere
 * naquela posição — e o usuário veria resultados que não pediu.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Comparação tolerante a espaço e caixa, usada nas confirmações por digitação. */
export function normalizeForComparison(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

export interface ImpactCount {
  entity: string
  count: number
}

/**
 * Contagem de vínculos do modal de confirmação (§6.3).
 *
 * Deliberadamente mutável: o valor atravessa o IPC, e o schema Zod do contrato
 * descreve arrays comuns. Marcar `readonly` aqui só criaria um cast em cada
 * handler.
 */
export interface Impact {
  label: string
  counts: ImpactCount[]
}
