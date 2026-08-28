/**
 * Seam único de acesso ao banco (spec §16.1, ADR-002).
 *
 * Este é o ÚNICO módulo do app que importa `better-sqlite3`. Toda a aplicação
 * conversa com o tipo `BaremoDatabase` daqui. É o que permite adotar
 * `better-sqlite3-multiple-ciphers` (SQLCipher) mais adiante trocando este
 * arquivo, sem reescrever repositórios, serviços nem testes.
 *
 * Também não importa `electron`: o caminho do banco entra por parâmetro. É o
 * que deixa os testes de unidade abrirem um banco temporário em Node puro.
 */

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type DrizzleDb = BetterSQLite3Database<typeof schema>

export interface BaremoDatabase {
  /** Consultas tipadas. Caminho preferencial em repositórios e serviços. */
  readonly db: DrizzleDb
  /** Escape hatch para PRAGMA, backup e manutenção. */
  readonly raw: Database.Database
  readonly path: string
  close(): void
}

export interface OpenOptions {
  /** Somente leitura — usado pela verificação de integridade de um backup. */
  readonly readonly?: boolean
}

/**
 * Abre a conexão e aplica a configuração do §14.1.
 *
 * `foreign_keys` precisa ser ligado por conexão: o SQLite ignora as constraints
 * silenciosamente quando ele está desligado, e o padrão é desligado.
 */
export function openDatabase(path: string, options: OpenOptions = {}): BaremoDatabase {
  const raw = new Database(path, { readonly: options.readonly ?? false })

  if (!options.readonly) {
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = NORMAL')
  }
  raw.pragma('foreign_keys = ON')
  // Sem isto, uma segunda janela (a de impressão) esbarra em SQLITE_BUSY.
  raw.pragma('busy_timeout = 5000')

  const db = drizzle(raw, { schema })

  return {
    db,
    raw,
    path,
    close: () => raw.close()
  }
}

export function readSchemaVersion(handle: BaremoDatabase): number {
  const [row] = handle.raw.pragma('user_version') as [{ user_version: number }]
  return row.user_version
}

export function writeSchemaVersion(handle: BaremoDatabase, version: number): void {
  // PRAGMA não aceita parâmetro ligado; o valor é um inteiro nosso, não entrada
  // do usuário, mas ainda assim passa por Number() antes de virar SQL.
  handle.raw.pragma(`user_version = ${Number(version)}`)
}

export interface IntegrityResult {
  readonly ok: boolean
  readonly detail: string
}

/** `PRAGMA integrity_check` do boot (§14.3). */
export function integrityCheck(handle: BaremoDatabase): IntegrityResult {
  const rows = handle.raw.pragma('integrity_check') as { integrity_check: string }[]
  const messages = rows.map((r) => r.integrity_check)
  const ok = messages.length === 1 && messages[0] === 'ok'
  return { ok, detail: ok ? 'ok' : messages.join('\n') }
}

export { schema }
