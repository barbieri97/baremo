/**
 * Backup, retenção e restauração (spec §14.3).
 *
 * "Backup sem restore não é backup": a listagem e a restauração aqui são o que
 * a tela de manutenção consome, e não um utilitário interno.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { BaremoDatabase } from './gateway'
import { integrityCheck, openDatabase, readSchemaVersion } from './gateway'

const RETAINED = 10
const FILE_PATTERN = /^backup_v(\d+)_(.+)\.db$/

export interface BackupInfo {
  readonly fileName: string
  readonly sizeBytes: number
  readonly createdAt: string
  readonly schemaVersion: number
}

function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/**
 * Copia o banco para a pasta de backups.
 *
 * Usa `VACUUM INTO`, e não `copyFile`: com WAL ligado, copiar o `.db` sozinho
 * pode capturar um estado sem as transações que ainda estão no `-wal`.
 * `VACUUM INTO` grava um arquivo consistente e já compactado.
 */
export function createBackup(
  handle: BaremoDatabase,
  backupsDirectory: string,
  label = 'manual'
): BackupInfo {
  mkdirSync(backupsDirectory, { recursive: true })

  const version = readSchemaVersion(handle)
  const fileName = `backup_v${version}_${timestampForFileName()}.db`
  const target = join(backupsDirectory, fileName)

  handle.raw.prepare('VACUUM INTO ?').run(target)
  pruneBackups(backupsDirectory)

  const stats = statSync(target)
  void label

  return {
    fileName,
    sizeBytes: stats.size,
    createdAt: stats.mtime.toISOString(),
    schemaVersion: version
  }
}

/** Backup preventivo antes de qualquer migration (§14.3). */
export function backupBeforeMigration(
  handle: BaremoDatabase,
  backupsDirectory: string
): BackupInfo {
  return createBackup(handle, backupsDirectory, 'pre-migration')
}

export function listBackups(backupsDirectory: string): BackupInfo[] {
  if (!existsSync(backupsDirectory)) return []

  return readdirSync(backupsDirectory)
    .filter((name) => FILE_PATTERN.test(name))
    .map((fileName) => {
      const stats = statSync(join(backupsDirectory, fileName))
      const version = Number(FILE_PATTERN.exec(fileName)?.[1] ?? 0)
      return {
        fileName,
        sizeBytes: stats.size,
        createdAt: stats.mtime.toISOString(),
        schemaVersion: version
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Mantém os `RETAINED` mais recentes; descarta o resto (§14.3). */
export function pruneBackups(backupsDirectory: string): string[] {
  const removed: string[] = []
  for (const backup of listBackups(backupsDirectory).slice(RETAINED)) {
    rmSync(join(backupsDirectory, backup.fileName), { force: true })
    removed.push(backup.fileName)
  }
  return removed
}

export type RestoreOutcome =
  | { readonly kind: 'restored'; readonly replacedBy: string; readonly safetyCopy: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'corrupt'; readonly detail: string }
  | { readonly kind: 'invalid_name' }

/**
 * Restaura um backup por cima do banco atual.
 *
 * A conexão precisa estar FECHADA antes de chamar — o app reinicia depois da
 * restauração. Duas travas antes de tocar no arquivo em produção: o nome vem
 * da listagem e é validado contra o padrão (nada de caminho vindo de fora), e o
 * backup passa por `integrity_check` antes de substituir o que está bom.
 */
export function restoreBackup(
  databasePath: string,
  backupsDirectory: string,
  fileName: string
): RestoreOutcome {
  // O nome nunca é concatenado antes desta checagem: `basename` mais o padrão
  // eliminam qualquer tentativa de traversal vinda do renderer.
  if (basename(fileName) !== fileName || !FILE_PATTERN.test(fileName)) {
    return { kind: 'invalid_name' }
  }

  const source = join(backupsDirectory, fileName)
  if (!existsSync(source)) return { kind: 'not_found' }

  const candidate = openDatabase(source, { readonly: true })
  try {
    const integrity = integrityCheck(candidate)
    if (!integrity.ok) return { kind: 'corrupt', detail: integrity.detail }
  } finally {
    candidate.close()
  }

  // O banco atual vira uma cópia de segurança antes de ser substituído: se a
  // restauração for o engano, ainda dá para voltar.
  const safetyCopy = `${databasePath}.substituido_${timestampForFileName()}`
  if (existsSync(databasePath)) {
    renameSync(databasePath, safetyCopy)
  }
  // Os sidecars do WAL pertencem ao banco antigo; deixá-los corromperia o novo.
  for (const sidecar of ['-wal', '-shm']) {
    rmSync(`${databasePath}${sidecar}`, { force: true })
  }

  copyFileSync(source, databasePath)

  return { kind: 'restored', replacedBy: fileName, safetyCopy }
}
