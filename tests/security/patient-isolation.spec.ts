/**
 * GATE DE CI — isolamento por paciente no módulo de IA (spec §10.5, §13.5).
 *
 * O requisito crítico do módulo: uma sessão de chat pertence a exatamente um
 * paciente, e nada que o modelo peça pode alcançar outro prontuário. As quatro
 * camadas da spec, e o que este arquivo verifica de cada uma:
 *
 *   1. nenhuma tool declara `patientId` — verificado sobre as declarações reais
 *      enviadas ao modelo;
 *   2. o repositório injeta `WHERE patient_id = ?` em toda consulta — verificado
 *      com um banco populado com três pacientes;
 *   3. todo ID vindo do modelo é revalidado — verificado com IDs adversariais
 *      E, mais importante, com IDs VÁLIDOS de outros prontuários;
 *   4. este arquivo.
 *
 * O caso que mais importa é o do item 3 com ID válido: um ID inventado quebra em
 * qualquer implementação; um ID real de outro paciente só é barrado se a
 * revalidação de propriedade existir de fato.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import {
  assessmentResults,
  assessments,
  attachments,
  cognitiveFunctions,
  colors,
  classificationRanges,
  documents,
  instruments,
  patients
} from '../../src/main/db/schema'
import { AgentReadRepository, ScopeViolationError } from '../../src/main/ai/agent-read-repository'
import { toolDeclarations } from '../../src/main/ai/tools'
import { initialsOf, redactIdentifiers, scrubText } from '../../src/main/ai/pseudonymize'

interface Fixture {
  patientId: string
  assessmentIds: string[]
  documentIds: string[]
  attachmentIds: string[]
  fullName: string
}

let handle: BaremoDatabase
let directory: string
const fixtures: Record<'a' | 'b' | 'c', Fixture> = {
  a: { patientId: '', assessmentIds: [], documentIds: [], attachmentIds: [], fullName: '' },
  b: { patientId: '', assessmentIds: [], documentIds: [], attachmentIds: [], fullName: '' },
  c: { patientId: '', assessmentIds: [], documentIds: [], attachmentIds: [], fullName: '' }
}

const COLOR_ID = randomUUID()
const FUNCTION_ID = randomUUID()
const INSTRUMENT_ID = randomUUID()

function seedPatient(key: 'a' | 'b' | 'c', fullName: string, marker: string): void {
  const patientId = randomUUID()
  fixtures[key].patientId = patientId
  fixtures[key].fullName = fullName

  handle.db
    .insert(patients)
    .values({
      id: patientId,
      fullName,
      birthDate: '1990-01-01',
      sex: 'unspecified',
      education: `Escolaridade ${marker}`,
      handedness: 'right',
      guardian: `Responsável ${marker}`,
      contact: `contato-${marker}@exemplo.com`,
      notes: `Observação sigilosa de ${marker}. Telefone (11) 91234-5678.`,
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()

  for (let index = 0; index < 2; index++) {
    const assessmentId = randomUUID()
    fixtures[key].assessmentIds.push(assessmentId)

    handle.db
      .insert(assessments)
      .values({
        id: assessmentId,
        patientId,
        date: `2026-0${index + 1}-10`,
        referralReason: `Encaminhamento sigiloso de ${marker}`,
        complaint: `Queixa de ${marker}`,
        notes: null,
        createdAt: new Date().toISOString(),
        archivedAt: null
      })
      .run()

    handle.db
      .insert(assessmentResults)
      .values({
        id: randomUUID(),
        assessmentId,
        instrumentId: INSTRUMENT_ID,
        scoreType: 'percentile',
        value: 50 + index,
        status: 'applied',
        classificationName: `Classificação ${marker}`,
        colorHex: '#2B6CB0',
        rangeId: null,
        rangeVersion: null,
        manuallyOverridden: false,
        notes: `Nota de ${marker}`
      })
      .run()
  }

  const documentId = randomUUID()
  fixtures[key].documentIds.push(documentId)
  handle.db
    .insert(documents)
    .values({
      id: documentId,
      patientId,
      assessmentId: null,
      type: 'psychological_report',
      // O nome do paciente aparece no título e no corpo — é o caso realista, e
      // é o que a pseudonimização precisa alcançar para não ser contornada por
      // um documento que repete o nome.
      title: `Laudo de ${fullName} — sigiloso ${marker}`,
      contentJson: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `${fullName} foi avaliado. Sigiloso ${marker}.` }]
          }
        ]
      }),
      status: 'draft',
      origin: 'human',
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finalizedAt: null
    })
    .run()

  const attachmentId = randomUUID()
  fixtures[key].attachmentIds.push(attachmentId)
  handle.db
    .insert(attachments)
    .values({
      id: attachmentId,
      patientId,
      assessmentId: null,
      originalName: `protocolo-sigiloso-${marker}.pdf`,
      sha256: 'a'.repeat(64),
      extension: 'pdf',
      detectedMime: 'application/pdf',
      sizeBytes: 1024,
      description: `Descrição sigilosa de ${marker}`,
      tags: '[]',
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-isolation-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)

  handle.db
    .insert(colors)
    .values({ id: COLOR_ID, name: 'Azul', hex: '#2B6CB0', order: 0, isSeed: true })
    .run()
  handle.db
    .insert(cognitiveFunctions)
    .values({ id: FUNCTION_ID, parentId: null, name: 'Atenção', description: null, order: 0 })
    .run()
  handle.db
    .insert(instruments)
    .values({
      id: INSTRUMENT_ID,
      parentId: null,
      name: 'Teste de Atenção',
      acronym: 'TA',
      cognitiveFunctionId: FUNCTION_ID,
      minAgeYears: null,
      maxAgeYears: null,
      reference: null,
      order: 0
    })
    .run()
  handle.db
    .insert(classificationRanges)
    .values({
      id: randomUUID(),
      instrumentId: INSTRUMENT_ID,
      scoreType: 'percentile',
      classificationName: 'Média',
      minValue: 0,
      maxValue: 100,
      colorId: COLOR_ID,
      version: 1
    })
    .run()

  seedPatient('a', 'Ana Alves Andrade', 'ALFA')
  seedPatient('b', 'Bruno Barros Bastos', 'BRAVO')
  seedPatient('c', 'Carla Cardoso Costa', 'CHARLIE')
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

function repositoryFor(key: 'a' | 'b' | 'c', pseudonymize = false): AgentReadRepository {
  return new AgentReadRepository(handle, fixtures[key].patientId, { pseudonymize })
}

/** Marcadores que jamais podem aparecer num retorno da sessão do paciente A. */
const FOREIGN_MARKERS = ['BRAVO', 'CHARLIE', 'Bruno', 'Barros', 'Carla', 'Cardoso']

function assertNoForeignData(payload: unknown): void {
  const serialized = JSON.stringify(payload)
  for (const marker of FOREIGN_MARKERS) {
    expect(serialized).not.toContain(marker)
  }
}

// ─── Camada 1 ──────────────────────────────────────────────────────────────

describe('camada 1 — nenhuma tool recebe patientId do modelo', () => {
  it('nenhuma declaração expõe um parâmetro de paciente', () => {
    const declarations = toolDeclarations(true)
    expect(declarations.length).toBeGreaterThan(0)

    for (const declaration of declarations) {
      const properties = Object.keys(declaration.parameters?.properties ?? {})

      for (const property of properties) {
        // Nem `patientId`, nem `pacienteId`, nem variação com underline.
        expect(property.toLowerCase().replace(/_/g, '')).not.toContain('patientid')
        expect(property.toLowerCase().replace(/_/g, '')).not.toContain('pacienteid')
      }
    }
  })

  it('o catálogo não expõe tool de exclusão, filesystem, rede ou configuração', () => {
    const names = toolDeclarations(true).map((declaration) => declaration.name ?? '')

    for (const forbidden of ['excluir', 'delete', 'remover', 'arquivo_local', 'fetch', 'config']) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false)
    }
  })
})

// ─── Camada 2 ──────────────────────────────────────────────────────────────

describe('camada 2 — toda consulta filtra pelo paciente da sessão', () => {
  it('obter_perfil_paciente devolve apenas o paciente da sessão', () => {
    const profile = repositoryFor('a').getPatientProfile()
    expect(JSON.stringify(profile)).toContain('ALFA')
    assertNoForeignData(profile)
  })

  it('listar_avaliacoes devolve apenas as avaliações da sessão', () => {
    const list = repositoryFor('a').listAssessments()
    expect(list).toHaveLength(2)
    assertNoForeignData(list)

    const returnedIds = list.map((entry) => entry.assessmentId)
    for (const foreignId of [...fixtures.b.assessmentIds, ...fixtures.c.assessmentIds]) {
      expect(returnedIds).not.toContain(foreignId)
    }
  })

  it('listar_documentos devolve apenas os documentos da sessão', () => {
    const list = repositoryFor('a').listDocuments()
    expect(list).toHaveLength(1)
    assertNoForeignData(list)
  })

  it('listar_arquivos devolve apenas os anexos da sessão', () => {
    const list = repositoryFor('a').listAttachments()
    expect(list).toHaveLength(1)
    assertNoForeignData(list)
  })

  it('listar_instrumentos_utilizados não vaza dados de outro prontuário', () => {
    assertNoForeignData(repositoryFor('a').listUsedInstruments())
  })

  it('cada sessão enxerga o seu próprio paciente, e só ele', () => {
    for (const key of ['a', 'b', 'c'] as const) {
      const list = repositoryFor(key).listAssessments()
      expect(list.map((entry) => entry.assessmentId).sort()).toEqual(
        [...fixtures[key].assessmentIds].sort()
      )
    }
  })
})

// ─── Camada 3 ──────────────────────────────────────────────────────────────

describe('camada 3 — revalidação de IDs vindos do modelo', () => {
  const repository = (): AgentReadRepository => repositoryFor('a')

  describe('IDs adversariais', () => {
    const adversarial = [
      '',
      '   ',
      "' OR 1=1 --",
      "'; DROP TABLE patients; --",
      '%',
      '../../etc/passwd',
      'null',
      'undefined',
      '00000000-0000-0000-0000-000000000000',
      randomUUID()
    ]

    it('recusa qualquer ID de avaliação forjado', () => {
      for (const id of adversarial) {
        expect(() => repository().getAssessment(id)).toThrow(ScopeViolationError)
      }
    })

    it('recusa qualquer ID de documento forjado', () => {
      for (const id of adversarial) {
        expect(() => repository().readDocument(id)).toThrow(ScopeViolationError)
      }
    })

    it('recusa qualquer ID de anexo forjado', () => {
      for (const id of adversarial) {
        expect(() => repository().getAttachmentForReading(id)).toThrow(ScopeViolationError)
      }
    })
  })

  describe('IDs VÁLIDOS de outros prontuários — o caso que mais importa', () => {
    it('recusa avaliação real de outro paciente', () => {
      for (const foreignId of [...fixtures.b.assessmentIds, ...fixtures.c.assessmentIds]) {
        expect(() => repository().getAssessment(foreignId)).toThrow(ScopeViolationError)
        expect(() => repository().listResults(foreignId, null)).toThrow(ScopeViolationError)
      }
    })

    it('recusa documento real de outro paciente', () => {
      for (const foreignId of [...fixtures.b.documentIds, ...fixtures.c.documentIds]) {
        expect(() => repository().readDocument(foreignId)).toThrow(ScopeViolationError)
      }
    })

    it('recusa anexo real de outro paciente', () => {
      for (const foreignId of [...fixtures.b.attachmentIds, ...fixtures.c.attachmentIds]) {
        expect(() => repository().getAttachmentForReading(foreignId)).toThrow(ScopeViolationError)
      }
    })

    it('recusa comparação que mistura avaliação própria com alheia', () => {
      expect(() =>
        repository().compareAssessments(fixtures.a.assessmentIds[0]!, fixtures.b.assessmentIds[0]!)
      ).toThrow(ScopeViolationError)

      expect(() =>
        repository().compareAssessments(fixtures.b.assessmentIds[0]!, fixtures.a.assessmentIds[0]!)
      ).toThrow(ScopeViolationError)
    })

    it('permite comparar duas avaliações do próprio paciente', () => {
      const comparison = repository().compareAssessments(
        fixtures.a.assessmentIds[0]!,
        fixtures.a.assessmentIds[1]!
      )
      expect(comparison.length).toBeGreaterThan(0)
      assertNoForeignData(comparison)
    })
  })

  it('as faixas de classificação seguem acessíveis — catálogo não é dado clínico', () => {
    const ranges = repository().getClassificationRanges(INSTRUMENT_ID, 'percentile')
    expect(ranges).toHaveLength(1)
    expect(ranges[0]!.classification).toBe('Média')
  })
})

// ─── Pseudonimização (§10.3) ───────────────────────────────────────────────

describe('pseudonimização', () => {
  it('substitui nome completo por iniciais e data de nascimento por idade', () => {
    const profile = repositoryFor('a', true).getPatientProfile() as unknown as Record<string, unknown>

    expect(profile['pseudonymized']).toBe(true)
    expect(profile['initials']).toBe('A.A.A.')
    expect(JSON.stringify(profile)).not.toContain('Ana Alves Andrade')
    expect(JSON.stringify(profile)).not.toContain('1990-01-01')
    expect(profile['age']).toMatch(/anos/)
  })

  it('remove responsável e contatos do perfil', () => {
    const serialized = JSON.stringify(repositoryFor('a', true).getPatientProfile())
    expect(serialized).not.toContain('Responsável')
    expect(serialized).not.toContain('@exemplo.com')
  })

  it('redige identificadores no texto livre das observações', () => {
    const profile = repositoryFor('a', true).getPatientProfile() as unknown as Record<string, unknown>
    expect(String(profile['notes'])).toContain('[telefone removido]')
    expect(String(profile['notes'])).not.toContain('91234-5678')
  })

  it('substitui o nome do paciente no título e no corpo do documento', () => {
    // Sem isto, a pseudonimização do perfil seria contornada por um documento
    // cujo texto repete o nome completo.
    const document = repositoryFor('a', true).readDocument(fixtures.a.documentIds[0]!)

    expect(document.title).not.toContain('Ana Alves Andrade')
    expect(document.title).toContain('A.A.A.')
    expect(document.text).not.toContain('Ana Alves Andrade')
    expect(document.text).toContain('A.A.A.')
  })

  it('não pseudonimiza o documento quando a camada está desligada', () => {
    const document = repositoryFor('a', false).readDocument(fixtures.a.documentIds[0]!)
    expect(document.title).toContain('Ana Alves Andrade')
  })

  it('mantém os dados identificáveis quando desligada', () => {
    const profile = repositoryFor('a', false).getPatientProfile() as unknown as Record<string, unknown>
    expect(profile['pseudonymized']).toBe(false)
    expect(profile['fullName']).toBe('Ana Alves Andrade')
  })

  it('ignora preposições ao formar as iniciais', () => {
    expect(initialsOf('Maria da Silva dos Santos')).toBe('M.S.S.')
    expect(initialsOf('João')).toBe('J.')
    expect(initialsOf('   ')).toBe('—')
  })

  it('redige CPF, telefone, e-mail e CEP', () => {
    const redacted = redactIdentifiers(
      'CPF 123.456.789-00, tel (11) 98765-4321, email a@b.com, CEP 01234-567'
    )
    expect(redacted).toContain('[CPF removido]')
    expect(redacted).toContain('[telefone removido]')
    expect(redacted).toContain('[e-mail removido]')
    expect(redacted).toContain('[CEP removido]')
  })

  it('substitui o nome do paciente em qualquer caixa', () => {
    const scrubbed = scrubText('ANA ALVES ANDRADE e ana alves andrade', 'Ana Alves Andrade')
    expect(scrubbed).not.toMatch(/ana/i)
  })
})
