/**
 * Herança das faixas de classificação (spec §4.6).
 *
 * Dois blocos: a resolução pura, que é onde mora a regra, e o comportamento de
 * ponta a ponta contra um banco real — porque a parte fácil de quebrar não é a
 * regra, é esquecer de aplicá-la em um dos caminhos que classificam um
 * resultado.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { colors } from '../../src/main/db/schema'
import { createInstrument, getInstrument, listInstruments } from '../../src/main/repositories/trees'
import {
  describeRangeOrigin,
  detachRanges,
  listRanges,
  listResolvedRanges,
  listResolvedRangesForInstruments,
  listResolvedScoreTypes,
  rangeOwnerOf,
  reattachRanges,
  saveRanges
} from '../../src/main/repositories/classification-ranges'
import { loadRanges, loadRangesForInstruments, rangeKey } from '../../src/main/services/classification'
import {
  indexRangeOwnerNodes,
  resolveRangeOwner,
  resolveRangeOwners
} from '../../src/shared/domain/inheritance'
import type { RangeOwnerNode } from '../../src/shared/domain/inheritance'
import type { ClassificationRangeDraft } from '../../src/shared/contracts/entities'

// ─── Resolução pura ──────────────────────────────────────────────────────────

function nodes(...entries: RangeOwnerNode[]): Map<string, RangeOwnerNode> {
  return indexRangeOwnerNodes(entries)
}

describe('resolveRangeOwner', () => {
  it('um instrumento que não herda é dono das próprias faixas', () => {
    const tree = nodes({ id: 'raiz', parentId: null, inheritsRanges: false })
    expect(resolveRangeOwner(tree, 'raiz')).toBe('raiz')
  })

  it('o filho que herda resolve para o pai', () => {
    const tree = nodes(
      { id: 'raiz', parentId: null, inheritsRanges: false },
      { id: 'filho', parentId: 'raiz', inheritsRanges: true }
    )
    expect(resolveRangeOwner(tree, 'filho')).toBe('raiz')
  })

  it('o neto sobe até o avô quando o pai também herda', () => {
    const tree = nodes(
      { id: 'raiz', parentId: null, inheritsRanges: false },
      { id: 'filho', parentId: 'raiz', inheritsRanges: true },
      { id: 'neto', parentId: 'filho', inheritsRanges: true }
    )
    expect(resolveRangeOwner(tree, 'neto')).toBe('raiz')
  })

  it('um índice composto personalizado passa a valer para o que está abaixo dele', () => {
    const tree = nodes(
      { id: 'raiz', parentId: null, inheritsRanges: false },
      { id: 'indice', parentId: 'raiz', inheritsRanges: false },
      { id: 'subteste', parentId: 'indice', inheritsRanges: true }
    )
    expect(resolveRangeOwner(tree, 'subteste')).toBe('indice')
  })

  /**
   * É o estado "não classifico, mesmo o pai classificando". Sem ele, apagar as
   * faixas de um subteste o devolveria à herança sem ninguém ter pedido.
   */
  it('quem não herda corta a cadeia mesmo sem ter faixas', () => {
    const tree = nodes(
      { id: 'raiz', parentId: null, inheritsRanges: false },
      { id: 'mudo', parentId: 'raiz', inheritsRanges: false },
      { id: 'neto', parentId: 'mudo', inheritsRanges: true }
    )
    expect(resolveRangeOwner(tree, 'neto')).toBe('mudo')
  })

  it('uma raiz marcada como herdeira resolve para si mesma: não há de quem herdar', () => {
    const tree = nodes({ id: 'raiz', parentId: null, inheritsRanges: true })
    expect(resolveRangeOwner(tree, 'raiz')).toBe('raiz')
  })

  it('para no último ancestral existente quando o pai declarado sumiu', () => {
    const tree = nodes({ id: 'orfao', parentId: 'fantasma', inheritsRanges: true })
    expect(resolveRangeOwner(tree, 'orfao')).toBe('orfao')
  })

  it('não trava diante de um ciclo gravado à mão no banco', () => {
    const tree = nodes(
      { id: 'a', parentId: 'b', inheritsRanges: true },
      { id: 'b', parentId: 'a', inheritsRanges: true }
    )
    expect(['a', 'b']).toContain(resolveRangeOwner(tree, 'a'))
  })

  it('resolve vários de uma vez', () => {
    const tree = nodes(
      { id: 'raiz', parentId: null, inheritsRanges: false },
      { id: 'filho', parentId: 'raiz', inheritsRanges: true },
      { id: 'proprio', parentId: 'raiz', inheritsRanges: false }
    )
    expect([...resolveRangeOwners(tree, ['filho', 'proprio'])]).toEqual([
      ['filho', 'raiz'],
      ['proprio', 'proprio']
    ])
  })
})

// ─── Ponta a ponta ───────────────────────────────────────────────────────────

let handle: BaremoDatabase
let directory: string
let colorLowId: string
let colorHighId: string
let rootId: string
let childId: string
let grandChildId: string

function instrument(name: string, parentId: string | null): string {
  return createInstrument(handle, {
    parentId,
    name,
    acronym: null,
    cognitiveFunctionId: null,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  }).id
}

function halves(boundary: number): ClassificationRangeDraft[] {
  return [
    {
      classificationName: 'Inferior',
      minValue: 0,
      maxValue: boundary,
      colorId: colorLowId,
      level: 1,
      inverted: false
    },
    {
      classificationName: 'Superior',
      minValue: boundary,
      maxValue: 100,
      colorId: colorHighId,
      level: 5,
      inverted: false
    }
  ]
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-heranca-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  seedIfEmpty(handle)

  const palette = handle.db.select().from(colors).all()
  colorLowId = palette[0]!.id
  colorHighId = palette[1]!.id
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

/** Cada teste parte de uma árvore limpa: pai → filho → neto, faixas só no pai. */
function buildTree(): void {
  rootId = instrument('Teste', null)
  childId = instrument('Subteste', rootId)
  grandChildId = instrument('Sub-subteste', childId)
  saveRanges(handle, rootId, 'percentile', halves(50))
}

afterEach(() => {
  handle.raw.exec('DELETE FROM classification_ranges; DELETE FROM instruments;')
})

describe('herança no banco', () => {
  it('o subteste nasce herdando: nada a cadastrar', () => {
    buildTree()

    const origin = describeRangeOrigin(handle, childId)
    expect(origin.inherited).toBe(true)
    expect(origin.ownerId).toBe(rootId)
    expect(origin.ownerName).toBe('Teste')
    expect(origin.canInherit).toBe(true)

    expect(listRanges(handle, childId, 'percentile')).toHaveLength(0)
    expect(listResolvedRanges(handle, childId, 'percentile').ranges).toHaveLength(2)
    expect(listResolvedScoreTypes(handle, childId)).toEqual(['percentile'])
  })

  it('um subteste criado DEPOIS das faixas do pai já classifica', () => {
    buildTree()
    const novo = instrument('Subteste novo', rootId)

    expect(loadRanges(handle, novo, 'percentile')).toHaveLength(2)
  })

  it('editar o pai muda o que o filho e o neto enxergam', () => {
    buildTree()
    saveRanges(handle, rootId, 'percentile', halves(70))

    for (const id of [childId, grandChildId]) {
      expect(loadRanges(handle, id, 'percentile').map((range) => range.maxValue)).toEqual([70, 100])
    }
  })

  it('a raiz é dona de si mesma e não pode voltar a herdar', () => {
    buildTree()

    expect(rangeOwnerOf(handle, rootId)).toBe(rootId)
    expect(describeRangeOrigin(handle, rootId).canInherit).toBe(false)
    expect(() => reattachRanges(handle, rootId)).toThrow(/raiz de um teste/)
  })

  it('personalizar copia as faixas e isola o subteste dos irmãos', () => {
    buildTree()
    const irmao = instrument('Irmão', rootId)

    detachRanges(handle, childId)
    expect(describeRangeOrigin(handle, childId).inherited).toBe(false)
    expect(listRanges(handle, childId, 'percentile')).toHaveLength(2)

    saveRanges(handle, childId, 'percentile', halves(30))

    expect(loadRanges(handle, childId, 'percentile')[0]!.maxValue).toBe(30)
    expect(loadRanges(handle, rootId, 'percentile')[0]!.maxValue).toBe(50)
    expect(loadRanges(handle, irmao, 'percentile')[0]!.maxValue).toBe(50)
  })

  /**
   * A herança é tudo-ou-nada: personalizar olhando o percentil não pode
   * derrubar silenciosamente o escore-z que o instrumento tinha um instante
   * antes.
   */
  it('personalizar traz TODOS os tipos de escore do dono, não só o que está na tela', () => {
    buildTree()
    saveRanges(handle, rootId, 'zScore', [
      {
        classificationName: 'Único',
        minValue: -5,
        maxValue: 5,
        colorId: colorLowId,
        level: 3,
        inverted: false
      }
    ])

    detachRanges(handle, childId)

    expect(listResolvedScoreTypes(handle, childId).sort()).toEqual(['percentile', 'zScore'])
    expect(listRanges(handle, childId, 'zScore')).toHaveLength(1)
  })

  it('a cópia personalizada nasce na versão 1: o histórico dela começa agora', () => {
    buildTree()
    saveRanges(handle, rootId, 'percentile', halves(60))
    expect(listRanges(handle, rootId, 'percentile')[0]!.version).toBe(2)

    detachRanges(handle, childId)
    expect(listRanges(handle, childId, 'percentile')[0]!.version).toBe(1)
  })

  it('personalizar um índice no meio da árvore vale para o que está abaixo', () => {
    buildTree()
    detachRanges(handle, childId)
    saveRanges(handle, childId, 'percentile', halves(30))

    expect(rangeOwnerOf(handle, grandChildId)).toBe(childId)
    expect(loadRanges(handle, grandChildId, 'percentile')[0]!.maxValue).toBe(30)
  })

  it('voltar a herdar descarta as faixas próprias e reacompanha o pai', () => {
    buildTree()
    detachRanges(handle, childId)
    saveRanges(handle, childId, 'percentile', halves(30))

    const origin = reattachRanges(handle, childId)

    expect(origin.inherited).toBe(true)
    expect(origin.ownerId).toBe(rootId)
    expect(listRanges(handle, childId, 'percentile')).toHaveLength(0)
    expect(loadRanges(handle, childId, 'percentile')[0]!.maxValue).toBe(50)
  })

  /**
   * Salvar é reivindicar a posse. Um conjunto vazio de um instrumento PRÓPRIO é
   * "não classifico" — se religasse a herança, não haveria como dizer isso.
   */
  it('salvar um conjunto vazio não devolve o subteste à herança', () => {
    buildTree()
    detachRanges(handle, childId)
    saveRanges(handle, childId, 'percentile', [])

    expect(getInstrument(handle, childId).inheritsRanges).toBe(false)
    expect(loadRanges(handle, childId, 'percentile')).toHaveLength(0)
  })

  it('gravar faixas em quem herdava já o torna dono, sem passar por personalizar', () => {
    buildTree()
    saveRanges(handle, childId, 'percentile', halves(30))

    expect(getInstrument(handle, childId).inheritsRanges).toBe(false)
    expect(loadRanges(handle, rootId, 'percentile')[0]!.maxValue).toBe(50)
  })

  it('o lote devolve as faixas chaveadas pelo instrumento pedido, não pelo dono', () => {
    buildTree()

    const byKey = loadRangesForInstruments(handle, [rootId, childId, grandChildId])
    for (const id of [rootId, childId, grandChildId]) {
      expect(byKey.get(rangeKey(id, 'percentile'))).toHaveLength(2)
    }

    const listed = listResolvedRangesForInstruments(handle, [childId])
    expect(listed).toHaveLength(2)
    expect(listed[0]!.instrumentId).toBe(childId)
    expect(listed[0]!.ownerInstrumentId).toBe(rootId)
  })

  it('mover o subteste para outro pai troca as faixas herdadas', () => {
    buildTree()
    const outroTeste = instrument('Outro teste', null)
    saveRanges(handle, outroTeste, 'percentile', halves(90))

    handle.raw.prepare('UPDATE instruments SET parent_id = ? WHERE id = ?').run(outroTeste, childId)

    expect(rangeOwnerOf(handle, childId)).toBe(outroTeste)
    expect(loadRanges(handle, childId, 'percentile')[0]!.maxValue).toBe(90)
  })

  it('a árvore continua sendo a mesma tabela: herdar não cria instrumento nenhum', () => {
    buildTree()
    detachRanges(handle, childId)

    expect(listInstruments(handle)).toHaveLength(3)
  })
})
