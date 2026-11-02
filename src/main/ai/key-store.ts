/**
 * Guarda das chaves de API das empresas de IA (spec §10.2).
 *
 * Princípio 2 do §10.1: **a chave nunca chega ao renderer.** Ela entra uma vez
 * por `ai:saveKey`, é cifrada com `safeStorage` (Keychain no macOS, DPAPI no
 * Windows, libsecret/kwallet no Linux) e gravada em `userData`, num arquivo por
 * empresa. O que volta para a interface são os quatro últimos caracteres, e mais
 * nada.
 */

import { safeStorage } from 'electron'
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import type { AiProviderId } from '@shared/contracts/entities-ai'
import { aiKeyPath } from '../paths'

/**
 * Chaves mantidas só em memória, para o modo "não persistir".
 *
 * É a saída oferecida quando `safeStorage` não está realmente disponível — no
 * Linux sem keyring, o Electron degrada para uma criptografia simbólica, que dá
 * a aparência de proteção sem a proteção. Melhor pedir a chave a cada execução
 * do que gravar um segredo de saúde sob cifra decorativa.
 */
const sessionKeys = new Map<AiProviderId, string>()

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export interface SaveKeyOptions {
  readonly persist: boolean
}

export function saveKey(provider: AiProviderId, key: string, options: SaveKeyOptions): void {
  sessionKeys.set(provider, key)

  if (!options.persist) {
    clearPersistedKey(provider)
    return
  }

  if (!encryptionAvailable()) {
    throw new Error(
      'A criptografia do sistema não está disponível. A chave não será gravada em disco; use o modo que solicita a chave a cada execução.'
    )
  }

  writeFileSync(aiKeyPath(provider), safeStorage.encryptString(key), { mode: 0o600 })
}

export function loadKey(provider: AiProviderId): string | null {
  const cached = sessionKeys.get(provider)
  if (cached !== undefined) return cached

  const path = aiKeyPath(provider)
  if (!existsSync(path) || !encryptionAvailable()) return null

  try {
    const decrypted = safeStorage.decryptString(readFileSync(path))
    sessionKeys.set(provider, decrypted)
    return decrypted
  } catch {
    // Chave cifrada com credencial de outro usuário ou perfil corrompido: some
    // silenciosamente, e a interface volta a pedir o cadastro.
    return null
  }
}

export function clearPersistedKey(provider: AiProviderId): void {
  rmSync(aiKeyPath(provider), { force: true })
}

export function clearKey(provider: AiProviderId): void {
  sessionKeys.delete(provider)
  clearPersistedKey(provider)
}

export function hasKeyInMemory(provider: AiProviderId): boolean {
  return sessionKeys.has(provider)
}

/** Os quatro últimos caracteres, o único fragmento que a interface vê (§10.2). */
export function keyHint(key: string): string {
  return key.slice(-4)
}
