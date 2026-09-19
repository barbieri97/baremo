/**
 * `listar_arquivos`: anexos gerais do paciente e anexos de avaliação moram na
 * mesma tabela. O agente precisa ver o vínculo de cada um e poder filtrar por
 * avaliação — e não ver o que o profissional arquivou.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { assessments, attachments, patients } from '../../src/main/db/schema'
import { AgentReadRepository } from '../../src/main/ai/agent-read-repository'

let handle: BaremoDatabase
let directory: string

const PATIENT_ID = randomUUID()
const ASSESSMENT_X = randomUUID()
const ASSESSMENT_Y = randomUUID()
const GENERAL_FILE = randomUUID()
const ASSESSMENT_FILE = randomUUID()
const ARCHIVED_FILE = randomUUID()

function insertAttachment(
  id: string,
  assessmentId: string | null,
  name: string,
  createdAt: string,
  archivedAt: string | null
): void {
  handle.db
    .insert(attachments)
    .values({
      id,
      patientId: PATIENT_ID,
      assessmentId,
      originalName: name,
      sha256: 'b'.repeat(64),
      extension: 'pdf',
      detectedMime: 'application/pdf',
      sizeBytes: 2048,
      description: null,
      tags: '[]',
      createdAt,
      archivedAt
    })
    .run()
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-agent-attachments-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)

  handle.db
    .insert(patients)
    .values({
      id: PATIENT_ID,
      fullName: 'Paciente de Teste',
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

  for (const [id, date] of [
    [ASSESSMENT_X, '2026-03-10'],
    [ASSESSMENT_Y, '2026-05-20']
  ] as const) {
    handle.db
      .insert(assessments)
      .values({
        id,
        patientId: PATIENT_ID,
        date,
        referralReason: null,
        complaint: null,
        notes: null,
        createdAt: new Date().toISOString(),
        archivedAt: null
      })
      .run()
  }

  insertAttachment(GENERAL_FILE, null, 'encaminhamento.pdf', '2026-03-01T10:00:00.000Z', null)
  insertAttachment(ASSESSMENT_FILE, ASSESSMENT_X, 'wisc.pdf', '2026-03-11T10:00:00.000Z', null)
  insertAttachment(
    ARCHIVED_FILE,
    ASSESSMENT_X,
    'versao-antiga.pdf',
    '2026-03-12T10:00:00.000Z',
    '2026-03-13T10:00:00.000Z'
  )
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

const repository = (): AgentReadRepository =>
  new AgentReadRepository(handle, PATIENT_ID, { pseudonymize: false })

describe('listar_arquivos', () => {
  it('lista anexos gerais e de avaliação, com o vínculo de cada um', () => {
    const list = repository().listAttachments(null)

    expect(list.map((entry) => entry.attachmentId)).toEqual([ASSESSMENT_FILE, GENERAL_FILE])
    expect(list[0]).toMatchObject({ assessmentId: ASSESSMENT_X, assessmentDate: '10/03/2026' })
    expect(list[1]).toMatchObject({ assessmentId: null, assessmentDate: null })
  })

  it('filtra pelos anexos de uma avaliação', () => {
    const list = repository().listAttachments(ASSESSMENT_X)
    expect(list.map((entry) => entry.attachmentId)).toEqual([ASSESSMENT_FILE])
  })

  it('devolve lista vazia para avaliação própria sem anexos', () => {
    expect(repository().listAttachments(ASSESSMENT_Y)).toEqual([])
  })

  it('nunca lista anexos arquivados', () => {
    const ids = [
      ...repository().listAttachments(null),
      ...repository().listAttachments(ASSESSMENT_X)
    ].map((entry) => entry.attachmentId)

    expect(ids).not.toContain(ARCHIVED_FILE)
  })
})
