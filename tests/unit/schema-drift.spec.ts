/**
 * Drift entre o schema Drizzle e as migrations (spec §14.2).
 *
 * As migrations são escritas à mão para viajarem dentro do bundle do processo
 * principal. O custo dessa escolha é a possibilidade de o schema Drizzle e o DDL
 * divergirem — uma coluna acrescentada em um e esquecida no outro só apareceria
 * como erro em runtime, na máquina do usuário. Este teste aplica as migrations
 * num banco real e compara, coluna a coluna, com o que o Drizzle declara.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { openDatabase, readSchemaVersion } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { TARGET_SCHEMA_VERSION } from '../../src/main/db/migrations'
import { seedIfEmpty } from '../../src/main/db/seed'
import { seedTemplatesIfEmpty } from '../../src/main/db/seed-templates'
import * as schema from '../../src/main/db/schema'

let handle: BaremoDatabase
let directory: string

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-schema-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

/**
 * Todas as tabelas declaradas no schema Drizzle.
 *
 * `is()` é o discriminador do próprio Drizzle: mais confiável do que farejar
 * símbolos internos, e é o que separa as tabelas das outras exportações do
 * módulo (constantes, tipos).
 */
const tables: [string, SQLiteTable][] = Object.entries(schema).flatMap(([name, value]) =>
  is(value, SQLiteTable) ? [[name, value] as [string, SQLiteTable]] : []
)

describe('migrations', () => {
  it('declara pelo menos uma migration', () => {
    expect(TARGET_SCHEMA_VERSION).toBeGreaterThan(0)
  })

  it('grava a versão de schema no banco', () => {
    expect(readSchemaVersion(handle)).toBe(TARGET_SCHEMA_VERSION)
  })

  it('é idempotente: rodar de novo não faz nada', () => {
    const outcome = runMigrations(handle)
    expect(outcome.kind).toBe('up_to_date')
  })

  it('recusa abrir um banco mais novo que o binário', () => {
    // Cenário real: o usuário instalou uma versão anterior por cima. Migrar para
    // trás perderia dados, então o app precisa recusar (§14.2).
    const future = openDatabase(join(directory, 'future.db'))
    future.raw.pragma(`user_version = ${TARGET_SCHEMA_VERSION + 5}`)

    const outcome = runMigrations(future)
    expect(outcome.kind).toBe('database_is_newer')

    future.close()
  })

  it('liga foreign_keys na conexão', () => {
    // O padrão do SQLite é DESLIGADO, e com ele desligado as constraints são
    // ignoradas em silêncio.
    const [row] = handle.raw.pragma('foreign_keys') as [{ foreign_keys: number }]
    expect(row.foreign_keys).toBe(1)
  })

  it('usa WAL', () => {
    const [row] = handle.raw.pragma('journal_mode') as [{ journal_mode: string }]
    expect(row.journal_mode).toBe('wal')
  })
})

describe('schema Drizzle × DDL das migrations', () => {
  it('encontrou tabelas para comparar', () => {
    expect(tables.length).toBeGreaterThan(10)
  })

  for (const [exportName, table] of tables) {
    const config = getTableConfig(table)

    it(`${config.name} (${exportName}) tem as mesmas colunas nos dois lados`, () => {
      const actual = handle.raw.pragma(`table_info(${config.name})`) as {
        name: string
        notnull: number
        pk: number
      }[]

      expect(actual.length).toBeGreaterThan(0)

      const declared = config.columns.map((column) => column.name).sort()
      const present = actual.map((column) => column.name).sort()

      expect(present).toEqual(declared)
    })

    it(`${config.name} tem a mesma chave primária`, () => {
      const actual = handle.raw.pragma(`table_info(${config.name})`) as {
        name: string
        pk: number
      }[]

      const declaredPrimary = config.columns
        .filter((column) => column.primary)
        .map((column) => column.name)
        .sort()
      const actualPrimary = actual
        .filter((column) => column.pk > 0)
        .map((column) => column.name)
        .sort()

      expect(actualPrimary).toEqual(declaredPrimary)
    })

    it(`${config.name} concorda sobre quais colunas são NOT NULL`, () => {
      const actual = handle.raw.pragma(`table_info(${config.name})`) as {
        name: string
        notnull: number
      }[]

      const declared = config.columns
        .filter((column) => column.notNull)
        .map((column) => column.name)
        .sort()
      const present = actual
        .filter((column) => column.notnull === 1)
        .map((column) => column.name)
        .sort()

      expect(present).toEqual(declared)
    })
  }
})

describe('seeds', () => {
  it('semeia a paleta e a árvore de funções na primeira execução', () => {
    seedIfEmpty(handle)

    const colorCount = handle.raw.prepare('SELECT COUNT(*) AS total FROM colors').get() as {
      total: number
    }
    const functionCount = handle.raw
      .prepare('SELECT COUNT(*) AS total FROM cognitive_functions')
      .get() as { total: number }

    expect(colorCount.total).toBe(7) // as sete cores da §5
    expect(functionCount.total).toBeGreaterThan(20)
  })

  it('NÃO semeia instrumentos nem faixas normativas', () => {
    // Tabelas de normas são material protegido dos manuais dos testes.
    const instrumentCount = handle.raw.prepare('SELECT COUNT(*) AS total FROM instruments').get() as {
      total: number
    }
    const rangeCount = handle.raw
      .prepare('SELECT COUNT(*) AS total FROM classification_ranges')
      .get() as { total: number }

    expect(instrumentCount.total).toBe(0)
    expect(rangeCount.total).toBe(0)
  })

  it('é idempotente', () => {
    seedIfEmpty(handle)
    seedIfEmpty(handle)

    const colorCount = handle.raw.prepare('SELECT COUNT(*) AS total FROM colors').get() as {
      total: number
    }
    expect(colorCount.total).toBe(7)
  })

  it('semeia os modelos de documento da Res. CFP 06/2019', () => {
    seedTemplatesIfEmpty(handle)
    seedTemplatesIfEmpty(handle)

    const types = handle.raw
      .prepare('SELECT DISTINCT type FROM document_templates')
      .all() as { type: string }[]

    const present = types.map((row) => row.type)
    for (const required of [
      'declaration',
      'certificate',
      'psychological_report',
      'technical_opinion'
    ]) {
      expect(present).toContain(required)
    }
  })

  it('cria as linhas singleton de perfil e configuração de IA', () => {
    const profile = handle.raw
      .prepare("SELECT COUNT(*) AS total FROM professional_profile WHERE id = 'singleton'")
      .get() as { total: number }
    const ai = handle.raw
      .prepare("SELECT COUNT(*) AS total FROM ai_config WHERE id = 'singleton'")
      .get() as { total: number }

    expect(profile.total).toBe(1)
    expect(ai.total).toBe(1)
  })

  it('o módulo de IA nasce DESLIGADO e com pseudonimização LIGADA', () => {
    // §10.1, princípio 6 e §10.3 — os padrões seguros são requisito, não escolha
    // de implementação.
    const config = handle.raw
      .prepare("SELECT enabled, pseudonymize FROM ai_config WHERE id = 'singleton'")
      .get() as { enabled: number; pseudonymize: number }

    expect(config.enabled).toBe(0)
    expect(config.pseudonymize).toBe(1)
  })
})
