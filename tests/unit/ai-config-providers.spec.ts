/**
 * Configuração do módulo de IA com mais de uma empresa (migration 5): empresa
 * ativa, modelo coerente com ela e a situação da chave de cada uma.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { MIGRATIONS } from '../../src/main/db/migrations'
import {
  getAiConfig,
  setAiProvider,
  setProviderKey,
  updateAiConfig
} from '../../src/main/repositories/ai-config'
import {
  AI_MODELS_BY_PROVIDER,
  AI_PROVIDERS,
  providerOfModel
} from '../../src/shared/contracts/entities-ai'

let handle: BaremoDatabase
let directory: string

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-ai-config-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  getAiConfig(handle) // cria a linha singleton
})

beforeEach(() => {
  handle.raw
    .prepare(
      `UPDATE ai_config SET provider = 'gemini', model = 'gemini-flash-latest',
              provider_keys = '{}', key_hint = NULL, key_persisted = 1`
    )
    .run()
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('migration 5 — chave do Gemini já cadastrada', () => {
  it('passa a dica antiga para o formato por empresa, sem pedir a chave de novo', () => {
    handle.raw.prepare(`UPDATE ai_config SET key_hint = 'a1b2', key_persisted = 0`).run()

    MIGRATIONS.find((migration) => migration.version === 5)?.run?.(handle.raw)

    const config = getAiConfig(handle)
    expect(config.keys.gemini).toEqual({ hasKey: true, keyHint: 'a1b2', keyPersisted: false })
    expect(config.keys.anthropic.hasKey).toBe(false)
    expect(config).toMatchObject({ provider: 'gemini', hasKey: true, keyHint: 'a1b2' })
  })
})

describe('empresa e modelo', () => {
  it('trocar de empresa leva o modelo ao padrão dela', () => {
    setAiProvider(handle, 'anthropic')
    expect(getAiConfig(handle)).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5'
    })

    setAiProvider(handle, 'openai', 'gpt-5.4-mini')
    expect(getAiConfig(handle)).toMatchObject({ provider: 'openai', model: 'gpt-5.4-mini' })
  })

  it('modelo de outra empresa nunca fica ativo', () => {
    setAiProvider(handle, 'anthropic', 'gpt-5.5')
    expect(getAiConfig(handle).model).toBe('claude-opus-5-5')

    // Um modelo gravado fora da empresa (banco editado à mão) cai no padrão.
    updateAiConfig(handle, { model: 'gemini-pro-latest' })
    expect(getAiConfig(handle).model).toBe('claude-opus-5-5')
  })

  it('empresa desconhecida no banco volta ao Gemini', () => {
    handle.raw.prepare(`UPDATE ai_config SET provider = 'outra'`).run()
    expect(getAiConfig(handle).provider).toBe('gemini')
  })

  it('cada modelo pertence a exatamente uma empresa', () => {
    for (const provider of AI_PROVIDERS) {
      for (const model of AI_MODELS_BY_PROVIDER[provider]) {
        expect(providerOfModel(model)).toBe(provider)
      }
    }
  })
})

describe('chaves por empresa', () => {
  it('cada empresa guarda a sua dica; a ativa aparece em hasKey/keyHint', () => {
    setProviderKey(handle, 'gemini', { hint: 'gggg', persisted: true })
    setProviderKey(handle, 'openai', { hint: 'oooo', persisted: false })

    setAiProvider(handle, 'openai')
    const config = getAiConfig(handle)
    expect(config).toMatchObject({ hasKey: true, keyHint: 'oooo', keyPersisted: false })
    expect(config.keys.gemini.keyHint).toBe('gggg')
    expect(config.keys.anthropic.hasKey).toBe(false)
  })

  it('remover a chave de uma empresa não mexe nas outras', () => {
    setProviderKey(handle, 'gemini', { hint: 'gggg', persisted: true })
    setProviderKey(handle, 'anthropic', { hint: 'aaaa', persisted: true })
    setProviderKey(handle, 'gemini', null)

    const config = getAiConfig(handle)
    expect(config.keys.gemini.hasKey).toBe(false)
    expect(config.keys.anthropic.keyHint).toBe('aaaa')
  })

  it('JSON corrompido no banco é tratado como nenhuma chave', () => {
    handle.raw.prepare(`UPDATE ai_config SET provider_keys = '{quebrado'`).run()
    expect(getAiConfig(handle).keys.gemini.hasKey).toBe(false)
  })
})
