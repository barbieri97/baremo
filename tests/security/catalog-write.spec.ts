/**
 * Tools de catálogo do assistente (spec §10.7) — o catálogo vale para todos os
 * pacientes, então uma proposta inviável precisa ser barrada ANTES de virar
 * diálogo, e a exclusão nunca pode atravessar resultados já lançados. A
 * garantia de que nada grava sem confirmação está em
 * `tests/unit/ai-orchestrator.spec.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import {
  assessmentResults,
  assessments,
  auditLog,
  classificationRanges,
  cognitiveFunctions,
  colors,
  instruments,
  patients
} from '../../src/main/db/schema'
import { applyCatalogWrite, previewCatalogWrite } from '../../src/main/services/ai-catalog-write'
import { CATALOG_TOOL_NAMES, toolDeclarations } from '../../src/main/ai/tools'

let handle: BaremoDatabase
let directory: string

const MEMORY = randomUUID()
const ATTENTION = randomUUID()
const WISC = randomUUID()
const DIGITS = randomUUID()
const COLOR = randomUUID()

function insertInstrument(id: string, name: string, parentId: string | null): void {
  handle.db
    .insert(instruments)
    .values({
      id,
      parentId,
      name,
      acronym: null,
      cognitiveFunctionId: MEMORY,
      minAgeYears: 6,
      maxAgeYears: 16,
      reference: null,
      order: 0
    })
    .run()
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-catalog-write-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  handle.db
    .insert(colors)
    .values({ id: COLOR, name: 'Azul', hex: '#2B6CB0', order: 0, isSeed: true })
    .run()
})

beforeEach(() => {
  handle.db.delete(assessmentResults).run()
  handle.db.delete(assessments).run()
  handle.db.delete(patients).run()
  handle.db.delete(classificationRanges).run()
  handle.db.delete(instruments).run()
  handle.db.delete(cognitiveFunctions).run()
  handle.db.delete(auditLog).run()

  handle.db
    .insert(cognitiveFunctions)
    .values([
      { id: MEMORY, parentId: null, name: 'Memória', description: null, order: 0 },
      { id: ATTENTION, parentId: MEMORY, name: 'Atenção', description: null, order: 0 }
    ])
    .run()
  insertInstrument(WISC, 'WISC-IV', null)
  insertInstrument(DIGITS, 'Dígitos', WISC)
  handle.db
    .insert(classificationRanges)
    .values({
      id: randomUUID(),
      instrumentId: DIGITS,
      scoreType: 'scaledScore',
      classificationName: 'Média',
      minValue: 8,
      maxValue: 12,
      colorId: COLOR,
      version: 1
    })
    .run()
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

function addResult(instrumentId: string): void {
  const patientId = randomUUID()
  const assessmentId = randomUUID()
  handle.db
    .insert(patients)
    .values({
      id: patientId,
      fullName: 'Ana Alves',
      birthDate: '2015-01-01',
      sex: 'unspecified',
      education: null,
      handedness: 'right',
      guardian: null,
      contact: null,
      notes: null,
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()
  handle.db
    .insert(assessments)
    .values({
      id: assessmentId,
      patientId,
      date: '2026-01-10',
      referralReason: null,
      complaint: null,
      notes: null,
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()
  handle.db
    .insert(assessmentResults)
    .values({ id: randomUUID(), assessmentId, instrumentId, scoreType: 'scaledScore', value: 10 })
    .run()
}

describe('tools de catálogo — propostas recusadas antes do diálogo', () => {
  it.each([
    ['ID inventado', 'editar_instrumento', { instrumentoId: 'wisc', nome: 'X' }],
    ['ID inexistente', 'excluir_instrumento', { instrumentoId: randomUUID(), justificativa: 'x' }],
    ['nome vazio', 'criar_instrumento', { nome: '   ' }],
    ['idade invertida', 'criar_instrumento', { nome: 'BDI', idadeMin: 30, idadeMax: 10 }],
    ['pai inexistente', 'criar_instrumento', { nome: 'X', instrumentoPaiId: randomUUID() }],
    ['função inexistente', 'criar_instrumento', { nome: 'X', funcaoCognitivaId: randomUUID() }],
    ['ciclo na árvore', 'editar_instrumento', { instrumentoId: WISC, instrumentoPaiId: DIGITS }],
    ['edição que não muda nada', 'editar_instrumento', { instrumentoId: WISC, nome: 'WISC-IV' }],
    ['ciclo de função', 'editar_funcao_cognitiva', { funcaoId: MEMORY, funcaoPaiId: ATTENTION }],
    ['função inventada', 'excluir_funcao_cognitiva', { funcaoId: 'memoria', justificativa: 'x' }]
  ] as const)('recusa %s', (_label, tool, args) => {
    expect(() => previewCatalogWrite(handle, tool, { ...args })).toThrow()
  })

  it('recusa excluir instrumento cujo subteste tem resultado lançado', () => {
    addResult(DIGITS)
    expect(() =>
      previewCatalogWrite(handle, 'excluir_instrumento', {
        instrumentoId: WISC,
        justificativa: 'x'
      })
    ).toThrow(/1 resultado/)
  })

  it('as tools de catálogo não declaram patientId', () => {
    const declared = toolDeclarations(true).filter((declaration) =>
      (CATALOG_TOOL_NAMES as readonly string[]).includes(declaration.name ?? '')
    )
    expect(declared).toHaveLength(CATALOG_TOOL_NAMES.length)
    expect(JSON.stringify(declared)).not.toMatch(/patient|paciente_?id/i)
  })

  it('sem tools de escrita, nenhuma de catálogo é oferecida', () => {
    const names = toolDeclarations(false).map((declaration) => declaration.name)
    for (const tool of CATALOG_TOOL_NAMES) expect(names).not.toContain(tool)
  })
})

describe('tools de catálogo — preview e gravação', () => {
  it('criação mostra os campos com nomes resolvidos e grava com auditoria', () => {
    const args = { nome: 'Span visual', instrumentoPaiId: WISC, funcaoCognitivaId: ATTENTION }
    const preview = previewCatalogWrite(handle, 'criar_instrumento', args)
    expect(preview.catalogPreview.fields).toEqual(
      expect.arrayContaining([
        { field: 'Instrumento-pai', before: null, after: 'WISC-IV' },
        { field: 'Função cognitiva', before: null, after: 'Atenção' }
      ])
    )

    const message = applyCatalogWrite(handle, 'criar_instrumento', args)
    const id = /instrumentoId: ([0-9a-f-]{36})/.exec(message)?.[1]
    const row = handle.db
      .select()
      .from(instruments)
      .where(eq(instruments.id, id ?? ''))
      .get()
    expect(row).toMatchObject({
      name: 'Span visual',
      parentId: WISC,
      cognitiveFunctionId: ATTENTION
    })

    const audit = handle.db.select().from(auditLog).all()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ entity: 'instrument', action: 'create', entityId: id })
    expect(audit[0]?.summary).toMatch(/assistente de IA/)
  })

  it('edição mescla só os campos enviados e mostra antes/depois', () => {
    const args = { instrumentoId: DIGITS, sigla: 'DG', idadeMax: '' }
    const preview = previewCatalogWrite(handle, 'editar_instrumento', args)
    expect(preview.catalogPreview.fields).toEqual([
      { field: 'Sigla', before: null, after: 'DG' },
      { field: 'Idade máxima', before: '16 anos', after: null }
    ])

    applyCatalogWrite(handle, 'editar_instrumento', args)
    const row = handle.db.select().from(instruments).where(eq(instruments.id, DIGITS)).get()
    expect(row).toMatchObject({
      name: 'Dígitos',
      acronym: 'DG',
      parentId: WISC,
      minAgeYears: 6,
      maxAgeYears: null
    })
  })

  it('exclusão de instrumento mostra o impacto e apaga subtestes e faixas', () => {
    const preview = previewCatalogWrite(handle, 'excluir_instrumento', {
      instrumentoId: WISC,
      justificativa: 'Duplicado.'
    })
    expect(preview.catalogPreview.impact).toEqual([
      { entity: 'Subtestes que serão excluídos junto', count: 1 },
      { entity: 'Faixas de classificação que serão excluídas', count: 1 }
    ])

    applyCatalogWrite(handle, 'excluir_instrumento', { instrumentoId: WISC, justificativa: 'x' })
    expect(handle.db.select().from(instruments).all()).toHaveLength(0)
    expect(handle.db.select().from(classificationRanges).all()).toHaveLength(0)
  })

  it('a gravação revalida: resultado lançado depois do diálogo barra a exclusão', () => {
    previewCatalogWrite(handle, 'excluir_instrumento', {
      instrumentoId: DIGITS,
      justificativa: 'x'
    })
    addResult(DIGITS)
    expect(() =>
      applyCatalogWrite(handle, 'excluir_instrumento', {
        instrumentoId: DIGITS,
        justificativa: 'x'
      })
    ).toThrow()
    expect(handle.db.select().from(instruments).all()).toHaveLength(2)
  })

  it('exclusão de função remove subfunções e desvincula instrumentos, sem apagá-los', () => {
    const preview = previewCatalogWrite(handle, 'excluir_funcao_cognitiva', {
      funcaoId: MEMORY,
      justificativa: 'x'
    })
    expect(preview.catalogPreview.impact).toEqual([
      { entity: 'Subfunções que serão excluídas junto', count: 1 },
      { entity: 'Instrumentos que perderão o vínculo', count: 2 }
    ])

    applyCatalogWrite(handle, 'excluir_funcao_cognitiva', { funcaoId: MEMORY, justificativa: 'x' })
    expect(handle.db.select().from(cognitiveFunctions).all()).toHaveLength(0)
    const remaining = handle.db.select().from(instruments).all()
    expect(remaining).toHaveLength(2)
    expect(remaining.every((row) => row.cognitiveFunctionId === null)).toBe(true)
  })

  it('cria e edita função cognitiva', () => {
    const message = applyCatalogWrite(handle, 'criar_funcao_cognitiva', {
      nome: 'Linguagem',
      descricao: 'Expressiva e receptiva.'
    })
    const id = /funcaoId: ([0-9a-f-]{36})/.exec(message)?.[1] ?? ''
    applyCatalogWrite(handle, 'editar_funcao_cognitiva', { funcaoId: id, funcaoPaiId: MEMORY })
    const row = handle.db
      .select()
      .from(cognitiveFunctions)
      .where(eq(cognitiveFunctions.id, id))
      .get()
    expect(row).toMatchObject({
      name: 'Linguagem',
      description: 'Expressiva e receptiva.',
      parentId: MEMORY
    })
  })
})
