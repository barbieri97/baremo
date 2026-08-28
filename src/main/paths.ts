/**
 * Localização de tudo o que o app grava em disco.
 *
 * Centralizado para que exista um único lugar a consultar quando a pergunta for
 * "onde está o dado do usuário?" — pergunta que aparece no aviso de criptografia
 * de disco (§16.1), na exportação de prontuário (§6.4) e na manutenção (§8.3).
 */

import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export function userDataDir(): string {
  return app.getPath('userData')
}

export function databasePath(): string {
  return join(userDataDir(), 'baremo.db')
}

export function backupsDir(): string {
  return ensureDir(join(userDataDir(), 'backups'))
}

/**
 * Raiz do armazenamento endereçado por conteúdo (§8.3).
 * O nome em português é intencional: é uma pasta que o usuário vai abrir.
 */
export function attachmentsDir(): string {
  return ensureDir(join(userDataDir(), 'arquivos'))
}

/** `userData/arquivos/<sha[0:2]>/<sha>.<ext>` — o caminho canônico de um blob. */
export function blobPath(sha256: string, extension: string): string {
  const prefix = sha256.slice(0, 2)
  const suffix = extension ? `.${extension.replace(/^\./, '')}` : ''
  return join(attachmentsDir(), prefix, `${sha256}${suffix}`)
}

export function aiKeyPath(): string {
  return join(userDataDir(), 'gemini-key.enc')
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}
