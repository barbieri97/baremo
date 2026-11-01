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
import { getLoadablePath } from 'sqlite-vec'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import * as knowledgeSchema from './knowledge-schema'
import { KNOWLEDGE_MIGRATIONS } from './knowledge-schema'

export type DrizzleDb = BetterSQLite3Database<typeof schema>

/**
 * O handle cru, exposto como tipo próprio para que os outros módulos falem dele
 * sem importar `better-sqlite3` — a regra do ADR-002 é sobre o pacote, não sobre
 * o tipo.
 */
export type RawDatabase = Database.Database

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
  const raw = openConnection(path, options)
  const db = drizzle(raw, { schema })

  return {
    db,
    raw,
    path,
    close: () => raw.close()
  }
}

function openConnection(path: string, options: OpenOptions): Database.Database {
  const raw = new Database(path, { readonly: options.readonly ?? false })

  if (!options.readonly) {
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = NORMAL')
  }
  raw.pragma('foreign_keys = ON')
  // Sem isto, uma segunda janela (a de impressão) esbarra em SQLITE_BUSY.
  raw.pragma('busy_timeout = 5000')
  return raw
}

// ─── Banco da base de referências ────────────────────────────────────────────

export type KnowledgeDrizzleDb = BetterSQLite3Database<typeof knowledgeSchema>

/**
 * Banco da base de referências do assistente (`referencias.db`).
 *
 * Fica num arquivo separado do prontuário porque depende da extensão nativa
 * `sqlite-vec`: o `baremo.db` nunca a carrega, então uma extensão ausente ou
 * quebrada numa máquina desliga só a busca, e o app abre normalmente.
 */
export interface KnowledgeDatabase {
  readonly db: KnowledgeDrizzleDb
  readonly raw: Database.Database
  readonly path: string
  close(): void
}

/**
 * Abre o banco de referências, carrega a `sqlite-vec` e aplica as migrations.
 * Lança se a extensão não carregar; quem chama decide como desligar o recurso.
 */
export function openKnowledgeDatabase(path: string): KnowledgeDatabase {
  const raw = openConnection(path, {})

  try {
    raw.loadExtension(vectorExtensionPath())

    const [row] = raw.pragma('user_version') as [{ user_version: number }]
    const pending = KNOWLEDGE_MIGRATIONS.filter((m) => m.version > row.user_version).sort(
      (a, b) => a.version - b.version
    )
    for (const migration of pending) {
      raw.transaction(() => {
        for (const statement of migration.statements) raw.exec(statement)
        raw.pragma(`user_version = ${Number(migration.version)}`)
      })()
    }
  } catch (error) {
    raw.close()
    throw error
  }

  return {
    db: drizzle(raw, { schema: knowledgeSchema }),
    raw,
    path,
    close: () => raw.close()
  }
}

/**
 * Caminho do binário do `sqlite-vec`.
 *
 * No app empacotado, o pacote fica dentro de `app.asar`, mas o binário nativo
 * vai para `app.asar.unpacked` (ver `asarUnpack` no electron-builder.yml): o
 * `dlopen` do SQLite não lê de dentro do asar. A troca é só de texto, então
 * este módulo continua sem importar `electron`.
 */
function vectorExtensionPath(): string {
  return getLoadablePath().replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
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
