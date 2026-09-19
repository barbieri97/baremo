/**
 * Migration 3 — colapso das faixas duplicadas (spec §4.6, §14.2).
 *
 * A migration mexe em dado que o usuário cadastrou à mão, e o erro possível aqui
 * é caro nos dois sentidos: colapsar de menos deixa o catálogo antigo sem
 * herança nenhuma, e colapsar de mais apaga uma personalização legítima que o
 * usuário não teria como refazer a partir do pai.
 *
 * O banco é montado no schema da VERSÃO 2 — o DDL de antes da herança existir —
 * e só então a migration roda, que é a única forma de provar que ela funciona
 * sobre o que já está instalado.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase, writeSchemaVersion } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { MIGRATIONS } from '../../src/main/db/migrations'

let handle: BaremoDatabase
let directory: string

const COLOR_A = randomUUID()
const COLOR_B = randomUUID()

/** Aplica só as migrations anteriores à da herança. */
function openAtVersionTwo(): void {
  directory = mkdtempSync(join(tmpdir(), 'baremo-heranca-mig-'))
  handle = openDatabase(join(directory, 'test.db'))

  for (const migration of MIGRATIONS.filter((entry) => entry.version <= 2)) {
    for (const statement of migration.statements) handle.raw.exec(statement)
    migration.run?.(handle.raw)
  }
  writeSchemaVersion(handle, 2)

  for (const [id, name, hex] of [
    [COLOR_A, 'Vermelho', '#c0392b'],
    [COLOR_B, 'Verde', '#27ae60']
  ]) {
    handle.raw
      .prepare(`INSERT INTO colors (id, name, hex, "order", is_seed) VALUES (?, ?, ?, 0, 0)`)
      .run(id, name, hex)
  }
}

function addInstrument(id: string, parentId: string | null): void {
  handle.raw
    .prepare(`INSERT INTO instruments (id, parent_id, name, "order") VALUES (?, ?, ?, 0)`)
    .run(id, parentId, `Instrumento ${id}`)
}

/**
 * Conjunto de duas faixas. `boundary` é o que diferencia um conjunto do outro:
 * dois instrumentos com o mesmo boundary têm faixas idênticas.
 */
function addRanges(instrumentId: string, boundary: number, scoreType = 'percentile'): void {
  const insert = handle.raw.prepare(
    `INSERT INTO classification_ranges
       (id, instrument_id, score_type, classification_name, min_value, max_value,
        color_id, version, level, inverted)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0)`
  )
  insert.run(randomUUID(), instrumentId, scoreType, 'Inferior', 0, boundary, COLOR_A, 1)
  insert.run(randomUUID(), instrumentId, scoreType, 'Superior', boundary, 100, COLOR_B, 5)
}

function inheritsRanges(id: string): boolean {
  const row = handle.raw.prepare(`SELECT inherits_ranges AS v FROM instruments WHERE id = ?`).get(
    id
  ) as { v: number } | undefined
  return row?.v === 1
}

function rangeCount(id: string): number {
  const row = handle.raw
    .prepare(`SELECT COUNT(*) AS n FROM classification_ranges WHERE instrument_id = ?`)
    .get(id) as { n: number }
  return row.n
}

beforeEach(openAtVersionTwo)

afterEach(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('migration heranca-de-faixas', () => {
  it('o filho com faixas idênticas às do pai passa a herdar', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)
    addRanges('filho', 50)

    runMigrations(handle)

    expect(inheritsRanges('pai')).toBe(false)
    expect(rangeCount('pai')).toBe(2)
    expect(inheritsRanges('filho')).toBe(true)
    expect(rangeCount('filho')).toBe(0)
  })

  it('o filho com faixas diferentes continua dono das suas', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)
    addRanges('filho', 30)

    runMigrations(handle)

    expect(inheritsRanges('filho')).toBe(false)
    expect(rangeCount('filho')).toBe(2)
  })

  /** Uma cadeia inteira de cópias colapsa numa passada só. */
  it('o neto colapsa para o avô quando o pai também colapsou', () => {
    addInstrument('avo', null)
    addInstrument('pai', 'avo')
    addInstrument('neto', 'pai')
    addRanges('avo', 50)
    addRanges('pai', 50)
    addRanges('neto', 50)

    runMigrations(handle)

    expect(rangeCount('avo')).toBe(2)
    expect(inheritsRanges('pai')).toBe(true)
    expect(inheritsRanges('neto')).toBe(true)
  })

  it('o neto herda do pai personalizado quando copia o pai, e não o avô', () => {
    addInstrument('avo', null)
    addInstrument('pai', 'avo')
    addInstrument('neto', 'pai')
    addRanges('avo', 50)
    addRanges('pai', 30)
    addRanges('neto', 30)

    runMigrations(handle)

    expect(inheritsRanges('pai')).toBe(false)
    expect(inheritsRanges('neto')).toBe(true)
    expect(rangeCount('neto')).toBe(0)
  })

  /**
   * A herança é tudo-ou-nada: copiar o percentil do pai não basta se o filho
   * tem um escore-z que o pai não tem — herdar apagaria esse escore-z.
   */
  it('não colapsa o filho que tem um tipo de escore a mais que o pai', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)
    addRanges('filho', 50)
    addRanges('filho', 50, 'zScore')

    runMigrations(handle)

    expect(inheritsRanges('filho')).toBe(false)
    expect(rangeCount('filho')).toBe(4)
  })

  it('não colapsa o filho a que falta um tipo de escore do pai', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)
    addRanges('pai', 50, 'zScore')
    addRanges('filho', 50)

    runMigrations(handle)

    expect(inheritsRanges('filho')).toBe(false)
    expect(rangeCount('filho')).toBe(2)
  })

  it('cores diferentes não são faixas idênticas', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)
    addRanges('filho', 50)
    handle.raw
      .prepare(`UPDATE classification_ranges SET color_id = ? WHERE instrument_id = 'filho'`)
      .run(COLOR_A)

    runMigrations(handle)

    expect(inheritsRanges('filho')).toBe(false)
  })

  it('níveis diferentes não são faixas idênticas', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)
    addRanges('filho', 50)
    handle.raw
      .prepare(`UPDATE classification_ranges SET level = NULL WHERE instrument_id = 'filho'`)
      .run()

    runMigrations(handle)

    expect(inheritsRanges('filho')).toBe(false)
  })

  it('um instrumento sem faixas nenhuma já nasce herdando', () => {
    addInstrument('pai', null)
    addInstrument('filho', 'pai')
    addRanges('pai', 50)

    runMigrations(handle)

    expect(inheritsRanges('filho')).toBe(true)
  })

  /**
   * Preservar quem não tem de quem herdar é o que garante que a migration não
   * possa "apagar as faixas do catálogo" em nenhuma combinação.
   */
  it('a raiz nunca perde as faixas, mesmo com irmãs idênticas', () => {
    addInstrument('raizA', null)
    addInstrument('raizB', null)
    addRanges('raizA', 50)
    addRanges('raizB', 50)

    runMigrations(handle)

    expect(rangeCount('raizA')).toBe(2)
    expect(rangeCount('raizB')).toBe(2)
    expect(inheritsRanges('raizA')).toBe(false)
    expect(inheritsRanges('raizB')).toBe(false)
  })

  it('um banco sem instrumento nenhum migra sem tropeçar', () => {
    expect(() => runMigrations(handle)).not.toThrow()
  })
})
