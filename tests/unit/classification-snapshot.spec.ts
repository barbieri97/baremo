/**
 * Snapshot de classificação (spec §4.8, ADR-004).
 *
 * O comportamento que estes testes travam é o mais fácil de quebrar por
 * "melhoria": alguém troca o snapshot por um JOIN vivo com a tabela de faixas,
 * o código fica mais curto, e editar uma tabela de normas passa a reclassificar
 * retroativamente avaliações já emitidas em laudo.
 *
 * Roda contra um banco real, atravessando repositórios e serviços.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { colors } from '../../src/main/db/schema'
import { createPatient } from '../../src/main/repositories/patients'
import { createInstrument } from '../../src/main/repositories/trees'
import { saveRanges, listRanges } from '../../src/main/repositories/classification-ranges'
import {
  createAssessment,
  listResults,
  previewReprocess,
  reprocessAssessment,
  saveResult
} from '../../src/main/repositories/assessments'

let handle: BaremoDatabase
let directory: string
let patientId: string
let assessmentId: string
let instrumentId: string
let colorLowId: string
let colorHighId: string

/** Série inicial: divide o percentil em duas metades. */
function saveInitialRanges(): void {
  saveRanges(handle, instrumentId, 'percentile', [
    {
      classificationName: 'Inferior',
      minValue: 0,
      maxValue: 50,
      colorId: colorLowId,
      level: 1,
      inverted: false
    },
    {
      classificationName: 'Superior',
      minValue: 50,
      maxValue: 100,
      colorId: colorHighId,
      level: 5,
      inverted: false
    }
  ])
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-snapshot-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  seedIfEmpty(handle)

  const palette = handle.db.select().from(colors).all()
  colorLowId = palette[0]!.id
  colorHighId = palette[1]!.id

  patientId = createPatient(handle, {
    fullName: 'Paciente de Teste',
    birthDate: '1990-01-01',
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

  instrumentId = createInstrument(handle, {
    parentId: null,
    name: 'Instrumento de Teste',
    acronym: 'IT',
    cognitiveFunctionId: null,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  }).id

  saveInitialRanges()
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

function saveScore(
  value: number,
  scoreType = 'percentile' as const
): ReturnType<typeof saveResult> {
  return saveResult(handle, null, {
    assessmentId,
    instrumentId,
    scoreType,
    value,
    status: 'applied',
    notes: null,
    override: null
  })
}

function clearResults(): void {
  for (const result of listResults(handle, assessmentId)) {
    handle.raw.prepare('DELETE FROM assessment_results WHERE id = ?').run(result.id)
  }
}

describe('gravação com classificação automática', () => {
  it('resolve a classificação e a cor no momento da gravação', () => {
    clearResults()
    const result = saveScore(30)

    expect(result.classificationName).toBe('Inferior')
    expect(result.colorHex).toBe(handle.db.select().from(colors).all()[0]!.hex)
    expect(result.manuallyOverridden).toBe(false)
  })

  it('guarda o rastro da faixa que gerou a classificação', () => {
    clearResults()
    const result = saveScore(80)

    const ranges = listRanges(handle, instrumentId, 'percentile')
    const expected = ranges.find((range) => range.classificationName === 'Superior')

    expect(result.rangeId).toBe(expected!.id)
    expect(result.rangeVersion).toBe(expected!.version)
  })

  it('grava sem classificação quando nenhuma faixa cobre o valor', () => {
    clearResults()
    saveRanges(handle, instrumentId, 'percentile', [])
    const result = saveScore(30)

    expect(result.classificationName).toBeNull()
    expect(result.colorHex).toBeNull()

    saveInitialRanges()
  })

  it('não classifica escore bruto', () => {
    clearResults()
    const result = saveResult(handle, null, {
      assessmentId,
      instrumentId,
      scoreType: 'raw',
      value: 42,
      status: 'applied',
      notes: null,
      override: null
    })

    expect(result.classificationName).toBeNull()
  })

  it('recusa valor fora do domínio do tipo de escore', () => {
    clearResults()
    expect(() => saveScore(150)).toThrow(/acima do máximo/i)
  })

  it('não exige valor quando o status não é "aplicado"', () => {
    clearResults()
    const result = saveResult(handle, null, {
      assessmentId,
      instrumentId,
      scoreType: 'percentile',
      value: null,
      status: 'not_applied',
      notes: 'Paciente recusou',
      override: null
    })

    expect(result.value).toBeNull()
    expect(result.classificationName).toBeNull()
  })

  it('recusa duplicata de instrumento + tipo de escore na mesma avaliação', () => {
    clearResults()
    saveScore(30)
    expect(() => saveScore(40)).toThrow(/já existe um resultado/i)
  })
})

describe('imutabilidade do snapshot — ADR-004', () => {
  it('editar as faixas NÃO reclassifica resultados já gravados', () => {
    clearResults()
    saveInitialRanges()
    const before = saveScore(30)
    expect(before.classificationName).toBe('Inferior')

    // Reescreve a tabela invertendo completamente o significado das faixas.
    saveRanges(handle, instrumentId, 'percentile', [
      {
        classificationName: 'Rebaixado',
        minValue: 0,
        maxValue: 20,
        colorId: colorLowId,
        level: 2,
        inverted: false
      },
      {
        classificationName: 'Preservado',
        minValue: 20,
        maxValue: 100,
        colorId: colorHighId,
        level: 4,
        inverted: false
      }
    ])

    const after = listResults(handle, assessmentId).find((row) => row.id === before.id)

    // O laudo já emitido continua dizendo o que dizia.
    expect(after!.classificationName).toBe('Inferior')
    // E o nível congela junto: é a perna do snapshot que dá cor ao panorama.
    expect(after!.classificationLevel).toBe(1)
  })

  it('a versão da faixa sobe a cada gravação do conjunto', () => {
    const first = listRanges(handle, instrumentId, 'percentile')[0]!.version
    saveInitialRanges()
    const second = listRanges(handle, instrumentId, 'percentile')[0]!.version

    expect(second).toBeGreaterThan(first)
  })
})

describe('sobrescrita manual', () => {
  it('substitui o snapshot e marca a linha', () => {
    clearResults()
    const result = saveResult(handle, null, {
      assessmentId,
      instrumentId,
      scoreType: 'percentile',
      value: 30,
      status: 'applied',
      notes: null,
      override: { classificationName: 'Avaliação clínica', colorHex: '#123456', level: 2 }
    })

    expect(result.classificationName).toBe('Avaliação clínica')
    expect(result.colorHex).toBe('#123456')
    expect(result.manuallyOverridden).toBe(true)
    // Sem faixa de origem: a classificação não veio de uma.
    expect(result.rangeId).toBeNull()
    // Mas o nível vai junto, senão a decisão do profissional sumiria do
    // panorama por função — que é onde ela mais precisa aparecer.
    expect(result.classificationLevel).toBe(2)
  })
})

describe('reprocessamento explícito', () => {
  it('mostra em prévia o que mudaria, sem alterar nada', () => {
    clearResults()
    saveInitialRanges()
    const result = saveScore(30)

    saveRanges(handle, instrumentId, 'percentile', [
      {
        classificationName: 'Rebaixado',
        minValue: 0,
        maxValue: 20,
        colorId: colorLowId,
        level: 2,
        inverted: false
      },
      {
        classificationName: 'Preservado',
        minValue: 20,
        maxValue: 100,
        colorId: colorHighId,
        level: 4,
        inverted: false
      }
    ])

    const preview = previewReprocess(handle, assessmentId)
    expect(preview).toHaveLength(1)
    expect(preview[0]).toMatchObject({
      from: 'Inferior',
      to: 'Preservado',
      fromLevel: 1,
      toLevel: 4
    })

    // A prévia não grava.
    const unchanged = listResults(handle, assessmentId).find((row) => row.id === result.id)
    expect(unchanged!.classificationName).toBe('Inferior')
  })

  it('aplica as faixas atuais quando o usuário confirma', () => {
    const outcome = reprocessAssessment(handle, assessmentId)
    expect(outcome.updated).toBe(1)

    const [result] = listResults(handle, assessmentId)
    expect(result!.classificationName).toBe('Preservado')
  })

  it('preserva os resultados sobrescritos manualmente', () => {
    clearResults()
    saveInitialRanges()

    const manual = saveResult(handle, null, {
      assessmentId,
      instrumentId,
      scoreType: 'percentile',
      value: 30,
      status: 'applied',
      notes: null,
      override: { classificationName: 'Decisão do profissional', colorHex: '#123456', level: 2 }
    })

    saveRanges(handle, instrumentId, 'percentile', [
      {
        classificationName: 'Outra coisa',
        minValue: 0,
        maxValue: 100,
        colorId: colorHighId,
        level: 3,
        inverted: false
      }
    ])

    reprocessAssessment(handle, assessmentId)

    const after = listResults(handle, assessmentId).find((row) => row.id === manual.id)
    expect(after!.classificationName).toBe('Decisão do profissional')
  })

  it('conta os resultados que ficaram sem faixa correspondente', () => {
    clearResults()
    saveInitialRanges()
    saveScore(30)

    // Cobertura parcial: 30 fica de fora.
    handle.raw
      .prepare('DELETE FROM classification_ranges WHERE instrument_id = ?')
      .run(instrumentId)
    handle.raw
      .prepare(
        `INSERT INTO classification_ranges
           (id, instrument_id, score_type, classification_name, min_value, max_value, color_id, version)
         VALUES (?, ?, 'percentile', 'Alto', 60, 100, ?, 9)`
      )
      .run(randomUUID(), instrumentId, colorHighId)

    const outcome = reprocessAssessment(handle, assessmentId)
    expect(outcome.unresolved).toBe(1)

    const [result] = listResults(handle, assessmentId)
    expect(result!.classificationName).toBeNull()

    saveInitialRanges()
  })
})
