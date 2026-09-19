/**
 * A herança de faixas (§4.6) sobre um catálogo clínico REAL e completo.
 *
 * Os outros dois specs de herança trabalham com árvores de três nós montadas à
 * mão, que é onde a regra fica legível. Este trabalha sobre
 * `tests/fixtures/catalogo-exemplo.json` — um catálogo exportado de verdade,
 * com 20 instrumentos, 40 conjuntos e 182 faixas, gravado ANTES de a herança
 * existir, quando cada subteste repetia as faixas do pai.
 *
 * A pergunta que ele responde é a única que importa para quem já tem o app
 * instalado: **depois da migration, algum escore passa a ser classificado de
 * forma diferente?** A resposta tem de ser não, para todos os instrumentos e
 * todos os tipos de escore — e é isso que o teste central compara, faixa a
 * faixa, em vez de conferir contagens.
 *
 * Nada aqui toca o banco instalado: o banco é criado em diretório temporário e
 * apagado no fim, como em todos os specs deste projeto.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase, writeSchemaVersion } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { seedIfEmpty } from '../../src/main/db/seed'
import {
  describeRangeOrigin,
  listRanges,
  listResolvedRanges,
  listResolvedScoreTypes
} from '../../src/main/repositories/classification-ranges'
import { applyCatalogImport, parseCatalogFile } from '../../src/main/services/catalog/import'
import type { CatalogFile } from '../../src/shared/contracts/catalog'
import type { ScoreType } from '../../src/shared/domain/score-types'

const FIXTURE = join(__dirname, '..', 'fixtures', 'catalogo-exemplo.json')

let directory: string
/** Banco montado no schema v2 e migrado — a instalação que o usuário já tem. */
let migrated: BaremoDatabase
/** Banco já no schema atual, preenchido pela importação do mesmo arquivo. */
let imported: BaremoDatabase
let catalog: CatalogFile

/** Como cada instrumento era classificado ANTES da migration. */
let before: Map<string, string>

/**
 * Assinatura de um conjunto de faixas.
 *
 * Deixa de fora `id` e `version`, que mudam por construção, e mantém tudo o que
 * decide em que faixa um escore cai e como ela aparece na tela.
 *
 * A cor entra pelo HEX, e não pelo id: a importação de catálogo casa cor por
 * hex de propósito (uma instalação nova tem a paleta semeada com outros UUIDs),
 * então comparar ids diria "mudou" sobre duas faixas rigorosamente da mesma cor.
 */
interface SignatureEntry {
  readonly classificationName: string
  readonly minValue: number
  readonly maxValue: number
  readonly colorHex: string
  readonly level: number | null
  readonly inverted: boolean
}

function signature(entries: readonly SignatureEntry[]): string {
  return entries
    .map((entry) =>
      [
        entry.classificationName,
        entry.minValue,
        entry.maxValue,
        entry.colorHex.toLowerCase(),
        entry.level ?? '—',
        entry.inverted ? 'invertido' : 'normal'
      ].join(' | ')
    )
    .sort()
    .join('\n')
}

/** As faixas que valem para o instrumento hoje, na forma comparável. */
function resolvedSignature(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType
): string {
  return signature(listResolvedRanges(handle, instrumentId, scoreType).ranges)
}

function key(instrumentId: string, scoreType: string): string {
  return `${instrumentId}::${scoreType}`
}

/**
 * Reconstrói a instalação anterior: schema v2 e cada instrumento dono das
 * próprias faixas, que é exatamente como o app gravava o catálogo importado.
 */
function buildLegacyDatabase(): BaremoDatabase {
  const handle = openDatabase(join(directory, 'instalacao-antiga.db'))

  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 2)) {
    for (const statement of migration.statements) handle.raw.exec(statement)
    migration.run?.(handle.raw)
  }
  writeSchemaVersion(handle, 2)

  for (const color of catalog.colors) {
    handle.raw
      .prepare(`INSERT INTO colors (id, name, hex, "order", is_seed) VALUES (?, ?, ?, 0, 0)`)
      .run(color.id, color.name, color.hex)
  }

  // Pai antes de filho: `instruments.parent_id` é FK real.
  const pending = [...catalog.instruments]
  const inserted = new Set<string>()
  while (pending.length > 0) {
    const index = pending.findIndex(
      (node) => node.parentId === null || inserted.has(node.parentId)
    )
    if (index === -1) throw new Error('A fixture tem um pai que não existe no próprio arquivo.')
    const node = pending.splice(index, 1)[0]!
    handle.raw
      .prepare(
        `INSERT INTO instruments (id, parent_id, name, acronym, min_age_years, max_age_years,
           reference, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        node.id,
        node.parentId,
        node.name,
        node.acronym,
        node.minAgeYears,
        node.maxAgeYears,
        node.reference,
        node.order
      )
    inserted.add(node.id)
  }

  const insertRange = handle.raw.prepare(
    `INSERT INTO classification_ranges (id, instrument_id, score_type, classification_name,
       min_value, max_value, color_id, version, level, inverted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
  for (const set of catalog.ranges) {
    for (const entry of set.entries) {
      insertRange.run(
        randomUUID(),
        set.instrumentId,
        set.scoreType,
        entry.classificationName,
        entry.minValue,
        entry.maxValue,
        entry.colorId,
        entry.level ?? null,
        entry.inverted === true ? 1 : 0
      )
    }
  }

  return handle
}

function countRows(handle: BaremoDatabase): number {
  return (
    handle.raw.prepare(`SELECT COUNT(*) AS n FROM classification_ranges`).get() as { n: number }
  ).n
}

function countSets(handle: BaremoDatabase): number {
  return (
    handle.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT DISTINCT instrument_id, score_type FROM classification_ranges)`
      )
      .get() as { n: number }
  ).n
}

let rowsBefore: number
let setsBefore: number

beforeAll(() => {
  catalog = parseCatalogFile(readFileSync(FIXTURE, 'utf8'))
  directory = mkdtempSync(join(tmpdir(), 'baremo-catalogo-real-'))

  migrated = buildLegacyDatabase()

  // Fotografia do comportamento ANTES de migrar, direto das linhas gravadas:
  // no schema v2 as funções do repositório ainda não existem para este banco.
  before = new Map()
  const hexById = new Map(catalog.colors.map((color) => [color.id, color.hex]))
  const rows = migrated.raw
    .prepare(
      `SELECT instrument_id AS instrumentId, score_type AS scoreType,
              classification_name AS classificationName, min_value AS minValue,
              max_value AS maxValue, color_id AS colorId, level, inverted
         FROM classification_ranges`
    )
    .all() as {
    instrumentId: string
    scoreType: string
    classificationName: string
    minValue: number
    maxValue: number
    colorId: string
    level: number | null
    inverted: number
  }[]

  const grouped = new Map<string, SignatureEntry[]>()
  for (const row of rows) {
    const bucket = grouped.get(key(row.instrumentId, row.scoreType)) ?? []
    bucket.push({
      classificationName: row.classificationName,
      minValue: row.minValue,
      maxValue: row.maxValue,
      colorHex: hexById.get(row.colorId) ?? row.colorId,
      level: row.level,
      inverted: row.inverted === 1
    })
    grouped.set(key(row.instrumentId, row.scoreType), bucket)
  }
  for (const [entryKey, entries] of grouped) before.set(entryKey, signature(entries))

  rowsBefore = countRows(migrated)
  setsBefore = countSets(migrated)

  runMigrations(migrated)

  // A outra rota pela qual o mesmo catálogo chega: importar o arquivo antigo
  // num banco já no schema atual.
  imported = openDatabase(join(directory, 'instalacao-nova.db'))
  runMigrations(imported)
  seedIfEmpty(imported)
  applyCatalogImport(imported, catalog)
})

afterAll(() => {
  migrated.close()
  imported.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('catálogo real: a fixture', () => {
  it('é um catálogo anterior à herança, com subtestes repetindo as faixas do pai', () => {
    expect(catalog.instruments.length).toBeGreaterThan(10)
    expect(catalog.ranges.length).toBeGreaterThan(10)
    // Sem o campo, a importação precisa DEDUZIR a herança — é o caso que este
    // arquivo cobre e que nenhum catálogo novo cobriria.
    expect(catalog.instruments.every((node) => node.inheritsRanges === undefined)).toBe(true)
  })
})

describe('catálogo real: migration da instalação existente', () => {
  /**
   * O teste central. Se algum dia ele falhar, a migration passou a mudar a
   * classificação de alguém — e nenhuma economia de linhas paga isso.
   */
  it('nenhum instrumento muda de classificação: o resolvido depois é o próprio de antes', () => {
    const divergences: string[] = []

    for (const [entryKey, expected] of before) {
      const [instrumentId, scoreType] = entryKey.split('::') as [string, ScoreType]
      const resolved = resolvedSignature(migrated, instrumentId, scoreType)
      if (resolved !== expected) divergences.push(entryKey)
    }

    expect(divergences).toEqual([])
  })

  it('nenhum instrumento ganha nem perde tipo de escore', () => {
    const typesBefore = new Map<string, Set<string>>()
    for (const entryKey of before.keys()) {
      const [instrumentId, scoreType] = entryKey.split('::')
      const bucket = typesBefore.get(instrumentId!) ?? new Set<string>()
      bucket.add(scoreType!)
      typesBefore.set(instrumentId!, bucket)
    }

    for (const [instrumentId, expected] of typesBefore) {
      expect([...listResolvedScoreTypes(migrated, instrumentId)].sort()).toEqual(
        [...expected].sort()
      )
    }
  })

  it('a redundância some: sobram só as faixas dos testes raiz', () => {
    expect(countRows(migrated)).toBeLessThan(rowsBefore)
    expect(countSets(migrated)).toBeLessThan(setsBefore)

    const owners = migrated.raw
      .prepare(`SELECT id, parent_id AS parentId FROM instruments WHERE inherits_ranges = 0`)
      .all() as { id: string; parentId: string | null }[]

    // Neste catálogo as faixas eram iguais dentro de cada teste, então quem
    // continua dono é exatamente a raiz de cada bateria.
    expect(owners.every((node) => node.parentId === null)).toBe(true)
    expect(owners).toHaveLength(catalog.instruments.filter((node) => node.parentId === null).length)
  })

  it('quem herda não guarda faixa própria nenhuma', () => {
    const heirs = migrated.raw
      .prepare(`SELECT id FROM instruments WHERE inherits_ranges = 1`)
      .all() as { id: string }[]

    expect(heirs.length).toBeGreaterThan(0)
    for (const heir of heirs) {
      const own = migrated.raw
        .prepare(`SELECT COUNT(*) AS n FROM classification_ranges WHERE instrument_id = ?`)
        .get(heir.id) as { n: number }
      expect(own.n).toBe(0)
      expect(describeRangeOrigin(migrated, heir.id).inherited).toBe(true)
    }
  })

  it('todo subteste continua classificando — herdar não é ficar sem faixas', () => {
    for (const node of catalog.instruments) {
      expect(listResolvedScoreTypes(migrated, node.id).length).toBeGreaterThan(0)
    }
  })
})

describe('catálogo real: importação do arquivo antigo num banco novo', () => {
  it('deduz a herança e classifica igual à instalação migrada', () => {
    for (const [entryKey, expected] of before) {
      const [instrumentId, scoreType] = entryKey.split('::') as [string, ScoreType]
      expect(resolvedSignature(imported, instrumentId, scoreType)).toBe(expected)
    }
  })

  /**
   * A importação não colapsa nada: ela respeita o arquivo, em que todo
   * instrumento com conjunto é dono. A limpeza é papel da migration — e por
   * isso as duas rotas classificam igual, mas guardam número diferente de
   * linhas.
   */
  it('respeita o arquivo: quem tem conjunto no arquivo entra como dono', () => {
    const declared = new Set(catalog.ranges.map((set) => set.instrumentId))

    for (const node of catalog.instruments) {
      expect(describeRangeOrigin(imported, node.id).inherited).toBe(!declared.has(node.id))
      expect(listRanges(imported, node.id, 'standardScore').length > 0).toBe(
        catalog.ranges.some(
          (set) => set.instrumentId === node.id && set.scoreType === 'standardScore'
        )
      )
    }
  })
})
