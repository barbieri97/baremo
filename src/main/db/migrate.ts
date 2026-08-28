/**
 * Executor de migrations e política de versão de schema (spec §14.2, §14.3).
 */

import type { BaremoDatabase } from './gateway'
import { readSchemaVersion, writeSchemaVersion } from './gateway'
import { MIGRATIONS, TARGET_SCHEMA_VERSION } from './migrations'

export type MigrationOutcome =
  | { readonly kind: 'up_to_date'; readonly version: number }
  | { readonly kind: 'migrated'; readonly from: number; readonly to: number }
  /**
   * O banco veio de uma versão mais nova do app (o usuário instalou uma versão
   * anterior por cima). Migrar para trás perderia dado, então o app recusa
   * abrir e explica — §14.2.
   */
  | { readonly kind: 'database_is_newer'; readonly databaseVersion: number; readonly appVersion: number }

export function pendingMigrations(currentVersion: number): typeof MIGRATIONS {
  return MIGRATIONS.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version)
}

export function needsMigration(handle: BaremoDatabase): boolean {
  return pendingMigrations(readSchemaVersion(handle)).length > 0
}

/**
 * Aplica as migrations pendentes.
 *
 * Cada migration roda dentro de uma transação junto com a atualização do
 * `user_version`: uma falha no meio deixa o banco na versão anterior, íntegro,
 * em vez de num meio-termo que nenhuma versão do app sabe ler.
 */
export function runMigrations(handle: BaremoDatabase): MigrationOutcome {
  const current = readSchemaVersion(handle)

  if (current > TARGET_SCHEMA_VERSION) {
    return {
      kind: 'database_is_newer',
      databaseVersion: current,
      appVersion: TARGET_SCHEMA_VERSION
    }
  }

  const pending = pendingMigrations(current)
  if (pending.length === 0) {
    return { kind: 'up_to_date', version: current }
  }

  for (const migration of pending) {
    const apply = handle.raw.transaction(() => {
      for (const statement of migration.statements) {
        handle.raw.exec(statement)
      }
    })

    try {
      apply()
      // Fora da transação: PRAGMA user_version não é transacional no SQLite.
      writeSchemaVersion(handle, migration.version)
    } catch (error) {
      throw new Error(
        `Falha ao aplicar a migration ${migration.version} (${migration.name}): ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return { kind: 'migrated', from: current, to: TARGET_SCHEMA_VERSION }
}

export { TARGET_SCHEMA_VERSION }
