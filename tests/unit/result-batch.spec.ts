/**
 * Lançamento de um teste completo (spec §4.8, §16.4).
 *
 * O lote grava pai e subtestes de uma vez, com o mesmo snapshot do lançamento
 * individual — e é tudo ou nada: um item recusado não pode deixar metade da
 * bateria gravada sem o profissional saber qual metade.
 *
 * Roda contra um banco real em diretório temporário.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { colors } from '../../src/main/db/schema'
import { createPatient } from '../../src/main/repositories/patients'
import { createInstrument } from '../../src/main/repositories/trees'
import {
  listRangesForInstruments,
  saveRanges
} from '../../src/main/repositories/classification-ranges'
import { createAssessment, listResults, saveResults } from '../../src/main/repositories/assessments'
import type { AssessmentResultInput } from '../../src/shared/contracts/entities'

let handle: BaremoDatabase
let directory: string
let assessmentId: string
let parentId: string
let childAId: string
let childBId: string

function instrument(name: string, parent: string | null): string {
  return createInstrument(handle, {
    parentId: parent,
    name,
    acronym: null,
    cognitiveFunctionId: null,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  }).id
}

function input(
  instrumentId: string,
  value: number,
  scoreType: AssessmentResultInput['scoreType'] = 'scaledScore'
): AssessmentResultInput {
  return {
    assessmentId,
    instrumentId,
    scoreType,
    value,
    status: 'applied',
    notes: null,
    override: null
  }
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-batch-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  seedIfEmpty(handle)

  const palette = handle.db.select().from(colors).all()

  const patientId = createPatient(handle, {
    fullName: 'Paciente de Teste',
    birthDate: '2015-01-01',
    sex: 'unspecified',
    education: null,
    handedness: 'unspecified',
    guardian: null,
    contact: null,
    notes: null
  }).id

  assessmentId = createAssessment(handle, {
    patientId,
    date: '2026-01-15',
    referralReason: null,
    complaint: null,
    notes: null
  }).id

  parentId = instrument('Bateria', null)
  childAId = instrument('Subteste A', parentId)
  childBId = instrument('Subteste B', parentId)

  for (const id of [childAId, childBId]) {
    saveRanges(handle, id, 'scaledScore', [
      {
        classificationName: 'Abaixo',
        minValue: 1,
        maxValue: 8,
        colorId: palette[0]!.id,
        level: 1,
        inverted: false
      },
      {
        classificationName: 'Média ou acima',
        minValue: 8,
        maxValue: 19,
        colorId: palette[1]!.id,
        level: 3,
        inverted: false
      }
    ])
  }
  saveRanges(handle, parentId, 'standardScore', [
    {
      classificationName: 'Média',
      minValue: 40,
      maxValue: 160,
      colorId: palette[1]!.id,
      level: 3,
      inverted: false
    }
  ])
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('faixas de vários instrumentos', () => {
  it('traz as faixas de todos os tipos dos instrumentos pedidos, e só deles', () => {
    const ranges = listRangesForInstruments(handle, [parentId, childAId])
    expect(new Set(ranges.map((range) => range.instrumentId))).toEqual(
      new Set([parentId, childAId])
    )
    expect(new Set(ranges.map((range) => range.scoreType))).toEqual(
      new Set(['standardScore', 'scaledScore'])
    )
    expect(listRangesForInstruments(handle, [])).toEqual([])
  })
})

describe('gravação em lote', () => {
  it('um item inválido desfaz o lote inteiro e a mensagem nomeia o instrumento', () => {
    expect(() =>
      saveResults(handle, assessmentId, [
        { id: null, input: input(childAId, 5) },
        { id: null, input: input(childBId, 25) }
      ])
    ).toThrow(/Subteste B/)

    expect(listResults(handle, assessmentId)).toHaveLength(0)
  })

  it('grava pai e filhos com a classificação resolvida no momento', () => {
    const saved = saveResults(handle, assessmentId, [
      { id: null, input: input(parentId, 95, 'standardScore') },
      { id: null, input: input(childAId, 5) },
      { id: null, input: input(childBId, 12) }
    ])

    expect(saved).toHaveLength(3)
    const byInstrument = new Map(saved.map((row) => [row.instrumentId, row]))
    expect(byInstrument.get(parentId)?.classificationName).toBe('Média')
    expect(byInstrument.get(childAId)?.classificationName).toBe('Abaixo')
    expect(byInstrument.get(childBId)?.classificationName).toBe('Média ou acima')
  })

  it('itens com id atualizam o resultado existente em vez de duplicar', () => {
    const existing = listResults(handle, assessmentId).find((row) => row.instrumentId === childAId)!

    saveResults(handle, assessmentId, [{ id: existing.id, input: input(childAId, 10) }])

    const rows = listResults(handle, assessmentId)
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.id === existing.id)?.classificationName).toBe('Média ou acima')
  })
})
