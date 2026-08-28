/**
 * Boot do banco (spec §14).
 *
 * Ordem: integridade → backup preventivo → migrations → seeds. A sequência
 * importa: o backup precisa acontecer ANTES da migration e DEPOIS de saber que
 * o arquivo está íntegro, senão guardamos uma cópia de algo já corrompido.
 */

import { existsSync } from 'node:fs'
import { backupsDir, databasePath } from '../paths'
import type { BaremoDatabase } from './gateway'
import { integrityCheck, openDatabase, readSchemaVersion } from './gateway'
import { backupBeforeMigration } from './backup'
import { needsMigration, runMigrations, TARGET_SCHEMA_VERSION } from './migrate'
import { seedIfEmpty } from './seed'

export type BootFailure =
  | { readonly kind: 'corrupt'; readonly detail: string }
  | { readonly kind: 'database_is_newer'; readonly databaseVersion: number; readonly appVersion: number }
  | { readonly kind: 'migration_failed'; readonly detail: string }

export type BootResult =
  | { readonly ok: true; readonly handle: BaremoDatabase; readonly schemaVersion: number }
  | { readonly ok: false; readonly failure: BootFailure }

let handle: BaremoDatabase | null = null

export function bootDatabase(): BootResult {
  const path = databasePath()
  const isNew = !existsSync(path)
  const opened = openDatabase(path)

  if (!isNew) {
    const integrity = integrityCheck(opened)
    if (!integrity.ok) {
      opened.close()
      return { ok: false, failure: { kind: 'corrupt', detail: integrity.detail } }
    }
  }

  if (readSchemaVersion(opened) > TARGET_SCHEMA_VERSION) {
    const databaseVersion = readSchemaVersion(opened)
    opened.close()
    return {
      ok: false,
      failure: { kind: 'database_is_newer', databaseVersion, appVersion: TARGET_SCHEMA_VERSION }
    }
  }

  // Banco recém-criado não tem o que preservar; poupa um arquivo inútil por instalação.
  if (!isNew && needsMigration(opened)) {
    backupBeforeMigration(opened, backupsDir())
  }

  const outcome = runMigrationsSafely(opened)
  if (outcome !== null) {
    opened.close()
    return { ok: false, failure: outcome }
  }

  seedIfEmpty(opened)
  handle = opened

  return { ok: true, handle: opened, schemaVersion: readSchemaVersion(opened) }
}

function runMigrationsSafely(opened: BaremoDatabase): BootFailure | null {
  try {
    const result = runMigrations(opened)
    if (result.kind === 'database_is_newer') {
      return {
        kind: 'database_is_newer',
        databaseVersion: result.databaseVersion,
        appVersion: result.appVersion
      }
    }
    return null
  } catch (error) {
    return {
      kind: 'migration_failed',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Handle aberto. Lança se chamado antes do boot — o que só acontece por erro de
 * ordenação no `index.ts` do main, e é melhor falhar alto do que abrir um
 * segundo banco silenciosamente.
 */
export function getDatabase(): BaremoDatabase {
  if (handle === null) {
    throw new Error('O banco ainda não foi inicializado. Chame bootDatabase() antes.')
  }
  return handle
}

export function closeDatabase(): void {
  handle?.close()
  handle = null
}

/** Fecha a conexão para permitir que o arquivo seja substituído na restauração. */
export function detachDatabase(): void {
  closeDatabase()
}

export { TARGET_SCHEMA_VERSION }
export type { BaremoDatabase }
