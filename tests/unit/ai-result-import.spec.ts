/**
 * `registrar_resultados` — pré-visualização e gravação dos escores propostos pelo
 * assistente (spec §10.6).
 *
 * O que importa aqui: a proposta passa pelas mesmas validações do formulário,
 * só grava o que o profissional marcou, nunca sobrescreve sem escolha explícita
 * e jamais alcança uma avaliação de outro paciente.
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
  attachments,
  classificationRanges,
  cognitiveFunctions,
  colors,
  instruments,
  patients
} from '../../src/main/db/schema'
import { applyResultImport, previewResultImport } from '../../src/main/services/ai-result-import'
import { listResults } from '../../src/main/repositories/assessments'

let handle: BaremoDatabase
let directory: string

const COLOR_ID = randomUUID()
const FUNCTION_ID = randomUUID()
const DIGITS = randomUUID()
const CODING = randomUUID()
const PATIENT_A = randomUUID()
const PATIENT_B = randomUUID()
const ATTACHMENT_A = randomUUID()
const ATTACHMENT_B = randomUUID()

/** Avaliação vazia do paciente A, recriada a cada teste. */
let assessmentA: string
let assessmentB: string

function insertPatient(id: string, fullName: string): void {
  handle.db
    .insert(patients)
    .values({
      id,
      fullName,
      birthDate: '1990-01-01',
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
}

function insertAssessment(patientId: string, date: string): string {
  const id = randomUUID()
  handle.db
    .insert(assessments)
    .values({
      id,
      patientId,
      date,
      referralReason: null,
      complaint: null,
      notes: null,
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()
  return id
}

function insertAttachment(id: string, patientId: string, name: string): void {
  handle.db
    .insert(attachments)
    .values({
      id,
      patientId,
      assessmentId: null,
      originalName: name,
      sha256: 'a'.repeat(64),
      extension: 'pdf',
      detectedMime: 'application/pdf',
      sizeBytes: 1024,
      description: null,
      tags: '[]',
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()
}

function insertRange(instrumentId: string, name: string, min: number, max: number): void {
  handle.db
    .insert(classificationRanges)
    .values({
      id: randomUUID(),
      instrumentId,
      scoreType: 'scaledScore',
      classificationName: name,
      minValue: min,
      maxValue: max,
      colorId: COLOR_ID,
      version: 1
    })
    .run()
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-ai-import-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)

  handle.db
    .insert(colors)
    .values({ id: COLOR_ID, name: 'Azul', hex: '#2B6CB0', order: 0, isSeed: true })
    .run()
  handle.db
    .insert(cognitiveFunctions)
    .values({ id: FUNCTION_ID, parentId: null, name: 'Memória', description: null, order: 0 })
    .run()

  for (const [id, name, acronym] of [
    [DIGITS, 'Dígitos', 'DG'],
    [CODING, 'Códigos', 'CD']
  ] as const) {
    handle.db
      .insert(instruments)
      .values({
        id,
        parentId: null,
        name,
        acronym,
        cognitiveFunctionId: FUNCTION_ID,
        minAgeYears: null,
        maxAgeYears: null,
        reference: null,
        order: 0
      })
      .run()
    insertRange(id, 'Inferior', 1, 7.99)
    insertRange(id, 'Média', 8, 12.99)
    insertRange(id, 'Superior', 13, 19)
  }

  insertPatient(PATIENT_A, 'Ana Alves')
  insertPatient(PATIENT_B, 'Bruno Barros')
  insertAttachment(ATTACHMENT_A, PATIENT_A, 'wisc-ana.pdf')
  insertAttachment(ATTACHMENT_B, PATIENT_B, 'wisc-bruno-sigiloso.pdf')
})

beforeEach(() => {
  assessmentA = insertAssessment(PATIENT_A, '2026-03-10')
  assessmentB = insertAssessment(PATIENT_B, '2026-03-11')
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

function item(instrumentoId: string, valor: unknown, tipoEscore = 'scaledScore'): object {
  return { instrumentoId, tipoEscore, valor }
}

describe('previewResultImport', () => {
  it('classifica cada linha pelas faixas cadastradas, como o formulário', () => {
    const preview = previewResultImport(handle, PATIENT_A, {
      avaliacaoId: assessmentA,
      arquivoOrigemId: ATTACHMENT_A,
      resultados: [item(DIGITS, 10), item(CODING, 5)]
    })

    expect(preview.rows.map((row) => [row.status, row.classificationName])).toEqual([
      ['new', 'Média'],
      ['new', 'Inferior']
    ])
    expect(preview.rows[0]!.instrumentName).toBe('Dígitos (DG)')
    expect(preview.description).toContain('wisc-ana.pdf')
    expect(preview.description).toContain('10/03/2026')
  })

  it('marca como inválidas as linhas que o formulário também recusaria', () => {
    const preview = previewResultImport(handle, PATIENT_A, {
      avaliacaoId: assessmentA,
      resultados: [
        item(randomUUID(), 10),
        item(DIGITS, 25),
        item(DIGITS, 10, 'qi'),
        item(CODING, 'dez'),
        item(CODING, 9),
        item(CODING, 11)
      ]
    })

    const statuses = preview.rows.map((row) => row.status)
    expect(statuses).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'new', 'invalid'])
    expect(preview.rows[0]!.error).toMatch(/não encontrado/)
    expect(preview.rows[1]!.error).toMatch(/máximo/)
    expect(preview.rows[5]!.error).toMatch(/repetido/)
  })

  it('aponta a sobrescrita de um resultado já gravado, com o valor anterior', () => {
    applyResultImport(handle, PATIENT_A, { avaliacaoId: assessmentA, resultados: [item(DIGITS, 6)] }, null)

    const preview = previewResultImport(handle, PATIENT_A, {
      avaliacaoId: assessmentA,
      resultados: [item(DIGITS, 14)]
    })

    expect(preview.rows[0]).toMatchObject({
      status: 'overwrite',
      existingValue: 6,
      existingClassification: 'Inferior',
      classificationName: 'Superior'
    })
  })

  it('exige exatamente uma forma de avaliação e uma data válida', () => {
    const resultados = [item(DIGITS, 10)]

    expect(() => previewResultImport(handle, PATIENT_A, { resultados })).toThrow(/exatamente um/)
    expect(() =>
      previewResultImport(handle, PATIENT_A, {
        avaliacaoId: assessmentA,
        novaAvaliacao: { data: '2026-04-01' },
        resultados
      })
    ).toThrow(/exatamente um/)
    expect(() =>
      previewResultImport(handle, PATIENT_A, { novaAvaliacao: { data: '01/04/2026' }, resultados })
    ).toThrow(/AAAA-MM-DD/)
    expect(() =>
      previewResultImport(handle, PATIENT_A, { avaliacaoId: assessmentA, resultados: [] })
    ).toThrow(/Nenhum resultado/)
  })
})

describe('applyResultImport', () => {
  it('grava só as linhas aceitas, com a nota de origem', () => {
    const summary = applyResultImport(
      handle,
      PATIENT_A,
      {
        avaliacaoId: assessmentA,
        arquivoOrigemId: ATTACHMENT_A,
        resultados: [item(DIGITS, 10), item(CODING, 5)]
      },
      [1]
    )

    const saved = listResults(handle, assessmentA)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      instrumentId: CODING,
      value: 5,
      status: 'applied',
      classificationName: 'Inferior'
    })
    expect(saved[0]!.notes).toContain('wisc-ana.pdf')
    expect(summary).toMatch(/1 resultado\(s\) novo\(s\)/)
  })

  it('sem seleção explícita, grava as novas e nunca sobrescreve', () => {
    applyResultImport(handle, PATIENT_A, { avaliacaoId: assessmentA, resultados: [item(DIGITS, 6)] }, null)

    applyResultImport(
      handle,
      PATIENT_A,
      { avaliacaoId: assessmentA, resultados: [item(DIGITS, 14), item(CODING, 9)] },
      null
    )

    const byInstrument = new Map(listResults(handle, assessmentA).map((row) => [row.instrumentId, row]))
    expect(byInstrument.get(DIGITS)!.value).toBe(6)
    expect(byInstrument.get(CODING)!.value).toBe(9)
  })

  it('sobrescreve no mesmo registro quando a linha é marcada, preservando a nota antiga', () => {
    applyResultImport(handle, PATIENT_A, { avaliacaoId: assessmentA, resultados: [item(DIGITS, 6)] }, null)
    const before = listResults(handle, assessmentA)[0]!
    handle.db
      .update(assessmentResults)
      .set({ notes: 'Aplicado com pausa.' })
      .where(eq(assessmentResults.id, before.id))
      .run()

    const summary = applyResultImport(
      handle,
      PATIENT_A,
      { avaliacaoId: assessmentA, resultados: [item(DIGITS, 14)] },
      [0]
    )

    const after = listResults(handle, assessmentA)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before.id, value: 14, classificationName: 'Superior' })
    expect(after[0]!.notes).toContain('Aplicado com pausa.')
    expect(summary).toMatch(/1 substituído/)
  })

  it('cria a avaliação nova do paciente da sessão só quando há o que gravar', () => {
    const count = (): number =>
      handle.db.select().from(assessments).where(eq(assessments.patientId, PATIENT_A)).all().length
    const initial = count()

    applyResultImport(
      handle,
      PATIENT_A,
      { novaAvaliacao: { data: '2026-05-20' }, resultados: [item(DIGITS, 30)] },
      [0]
    )
    expect(count()).toBe(initial)

    const summary = applyResultImport(
      handle,
      PATIENT_A,
      { novaAvaliacao: { data: '2026-05-20', motivo: 'Reteste' }, resultados: [item(DIGITS, 10)] },
      [0]
    )
    expect(count()).toBe(initial + 1)
    expect(summary).toContain('20/05/2026')

    const created = handle.db
      .select()
      .from(assessments)
      .where(eq(assessments.date, '2026-05-20'))
      .get()
    expect(created).toMatchObject({ patientId: PATIENT_A, referralReason: 'Reteste' })
    expect(listResults(handle, created!.id)).toHaveLength(1)
  })
})

describe('isolamento por paciente', () => {
  it('recusa pré-visualizar ou gravar numa avaliação de outro paciente', () => {
    const args = { avaliacaoId: assessmentB, resultados: [item(DIGITS, 10)] }

    expect(() => previewResultImport(handle, PATIENT_A, args)).toThrow(/não pertence/)
    expect(() => applyResultImport(handle, PATIENT_A, args, [0])).toThrow(/não pertence/)
    expect(listResults(handle, assessmentB)).toHaveLength(0)
  })

  it('não revela o nome de um arquivo de outro prontuário', () => {
    const preview = previewResultImport(handle, PATIENT_A, {
      avaliacaoId: assessmentA,
      arquivoOrigemId: ATTACHMENT_B,
      resultados: [item(DIGITS, 10)]
    })
    expect(preview.description).not.toContain('bruno')

    applyResultImport(
      handle,
      PATIENT_A,
      { avaliacaoId: assessmentA, arquivoOrigemId: ATTACHMENT_B, resultados: [item(DIGITS, 10)] },
      [0]
    )
    expect(listResults(handle, assessmentA)[0]!.notes).not.toContain('bruno')
  })
})
