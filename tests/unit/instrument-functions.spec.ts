/**
 * Funções cognitivas múltiplas por instrumento (SPEC
 * `docs/specs/funcoes-cognitivas-multiplas.md`).
 *
 * O que fica travado aqui:
 *  - F3: sem principal própria, herda principal E secundárias do ancestral mais
 *    próximo com principal; com principal própria, nada vem do pai;
 *  - F1/F4: sem repetição, e secundária exige principal;
 *  - F2: agrupar resultados usa só a principal — um subteste sem função própria
 *    aparece no grupo do pai, com a etiqueta das secundárias.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { instrumentSecondaryFunctions } from '../../src/main/db/schema'
import { createPatient } from '../../src/main/repositories/patients'
import {
  cognitiveFunctionImpact,
  createCognitiveFunction,
  createInstrument,
  deleteCognitiveFunction,
  getInstrument,
  updateInstrument
} from '../../src/main/repositories/trees'
import { createAssessment, listResults, saveResult } from '../../src/main/repositories/assessments'
import { buildResultsOverview } from '../../src/main/services/results-overview'
import { renderResultsReport } from '../../src/main/pdf/templates'
import {
  alsoAssessesLabel,
  resolveFunctions,
  validateFunctions
} from '../../src/shared/domain/instrument-functions'
import type { InstrumentInput } from '../../src/shared/contracts/entities'

// ─── Domínio puro ────────────────────────────────────────────────────────────

describe('resolveFunctions', () => {
  const tree = [
    { id: 'teste', parentId: null, cognitiveFunctionId: 'inibicao' },
    { id: 'indice', parentId: 'teste', cognitiveFunctionId: null },
    { id: 'subteste', parentId: 'indice', cognitiveFunctionId: null },
    { id: 'proprio', parentId: 'teste', cognitiveFunctionId: 'memoria' },
    { id: 'solto', parentId: null, cognitiveFunctionId: null },
    { id: 'filho-solto', parentId: 'solto', cognitiveFunctionId: null }
  ]
  const links = [
    { instrumentId: 'teste', cognitiveFunctionId: 'fonologia', order: 1 },
    { instrumentId: 'teste', cognitiveFunctionId: 'fluencia', order: 0 }
  ]

  it('função própria: principal e secundárias do próprio nó, na ordem', () => {
    expect(resolveFunctions('teste', tree, links)).toEqual({
      primaryId: 'inibicao',
      secondaryIds: ['fluencia', 'fonologia'],
      inheritedFrom: null
    })
  })

  it('sem função própria: herda do ancestral mais próximo, várias gerações acima', () => {
    expect(resolveFunctions('subteste', tree, links)).toEqual({
      primaryId: 'inibicao',
      secondaryIds: ['fluencia', 'fonologia'],
      inheritedFrom: 'teste'
    })
  })

  it('sem nenhuma função na linhagem: tudo vazio', () => {
    expect(resolveFunctions('filho-solto', tree, links)).toEqual({
      primaryId: null,
      secondaryIds: [],
      inheritedFrom: null
    })
  })

  it('principal própria bloqueia as secundárias do pai', () => {
    expect(resolveFunctions('proprio', tree, links)).toEqual({
      primaryId: 'memoria',
      secondaryIds: [],
      inheritedFrom: null
    })
  })

  it('instrumento desconhecido não quebra', () => {
    expect(resolveFunctions('nao-existe', tree, links).primaryId).toBeNull()
  })
})

describe('validateFunctions', () => {
  it('aceita principal sem secundárias e nenhuma das duas', () => {
    expect(validateFunctions('a', [])).toBeNull()
    expect(validateFunctions(null, [])).toBeNull()
  })

  it('recusa secundária sem principal (F4)', () => {
    expect(validateFunctions(null, ['b'])).toBe('secondary_without_primary')
  })

  it('recusa secundária repetindo a principal ou outra secundária (F1)', () => {
    expect(validateFunctions('a', ['a'])).toBe('duplicate')
    expect(validateFunctions('a', ['b', 'b'])).toBe('duplicate')
  })

  it('monta a etiqueta', () => {
    expect(alsoAssessesLabel([])).toBeNull()
    expect(alsoAssessesLabel([{ name: 'Fluência verbal' }, 'Fonologia'])).toBe(
      'Também avalia: Fluência verbal, Fonologia'
    )
  })
})

// ─── Banco real ──────────────────────────────────────────────────────────────

let handle: BaremoDatabase
let directory: string
let assessmentId: string
const fn: Record<string, string> = {}
const ids: Record<string, string> = {}

function base(overrides: Partial<InstrumentInput>): InstrumentInput {
  return {
    parentId: null,
    name: 'Instrumento',
    acronym: null,
    cognitiveFunctionId: null,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0,
    ...overrides
  }
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-functions-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  seedIfEmpty(handle)

  for (const name of ['Controle inibitório', 'Fluência verbal', 'Fonologia', 'Velocidade']) {
    fn[name] = createCognitiveFunction(handle, {
      parentId: null,
      name: `Teste · ${name}`,
      description: null,
      order: 0
    }).id
  }

  ids['fdt'] = createInstrument(
    handle,
    base({
      name: 'FDT',
      cognitiveFunctionId: fn['Controle inibitório']!,
      secondaryFunctionIds: [fn['Fluência verbal']!, fn['Fonologia']!]
    })
  ).id
  ids['leitura'] = createInstrument(handle, base({ name: 'Leitura', parentId: ids['fdt']! })).id
  ids['velocidade'] = createInstrument(
    handle,
    base({ name: 'Velocidade', parentId: ids['fdt']!, cognitiveFunctionId: fn['Velocidade']! })
  ).id

  const patientId = createPatient(handle, {
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

  for (const key of ['leitura', 'velocidade']) {
    saveResult(handle, null, {
      assessmentId,
      instrumentId: ids[key]!,
      scoreType: 'percentile',
      value: 40,
      status: 'applied',
      notes: null,
      override: null
    })
  }
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('repositório de instrumentos', () => {
  it('grava as secundárias na ordem escolhida', () => {
    expect(getInstrument(handle, ids['fdt']!).secondaryFunctionIds).toEqual([
      fn['Fluência verbal'],
      fn['Fonologia']
    ])
  })

  it('atualizar sem o campo mantém as secundárias', () => {
    const current = getInstrument(handle, ids['fdt']!)
    updateInstrument(
      handle,
      ids['fdt']!,
      base({ name: 'FDT', cognitiveFunctionId: current.cognitiveFunctionId })
    )
    expect(getInstrument(handle, ids['fdt']!).secondaryFunctionIds).toHaveLength(2)
  })

  it('recusa secundária repetindo a principal e secundária sem principal', () => {
    expect(() =>
      createInstrument(
        handle,
        base({
          cognitiveFunctionId: fn['Fonologia']!,
          secondaryFunctionIds: [fn['Fonologia']!]
        })
      )
    ).toThrow(/não pode repetir/)
    expect(() =>
      createInstrument(handle, base({ secondaryFunctionIds: [fn['Fonologia']!] }))
    ).toThrow(/função principal/)
  })

  it('tirar a principal sem informar as secundárias derruba as secundárias (F4)', () => {
    const id = createInstrument(
      handle,
      base({
        name: 'Temporário',
        cognitiveFunctionId: fn['Velocidade']!,
        secondaryFunctionIds: [fn['Fonologia']!]
      })
    ).id
    updateInstrument(handle, id, base({ name: 'Temporário' }))
    expect(getInstrument(handle, id).secondaryFunctionIds).toEqual([])
  })
})

describe('resultados usam a principal efetiva', () => {
  it('subteste sem função cai no grupo do pai, com as secundárias do pai', () => {
    const rows = listResults(handle, assessmentId)
    const leitura = rows.find((row) => row.instrumentId === ids['leitura'])!
    expect(leitura.cognitiveFunctionId).toBe(fn['Controle inibitório'])
    expect(leitura.functionInherited).toBe(true)
    expect(leitura.secondaryFunctions.map((item) => item.id)).toEqual([
      fn['Fluência verbal'],
      fn['Fonologia']
    ])

    const velocidade = rows.find((row) => row.instrumentId === ids['velocidade'])!
    expect(velocidade.cognitiveFunctionId).toBe(fn['Velocidade'])
    expect(velocidade.functionInherited).toBe(false)
    expect(velocidade.secondaryFunctions).toEqual([])
  })

  it('a visão geral agrupa pela principal herdada, não pelas secundárias', () => {
    const overview = buildResultsOverview(handle, assessmentId, [])
    const inhibition = overview.functions.find((item) => item.id === fn['Controle inibitório'])
    expect(inhibition?.points.map((point) => point.instrumentId)).toEqual([ids['leitura']])
    expect(overview.functions.find((item) => item.id === null)).toBeUndefined()
    // As secundárias NÃO ganham grupo próprio (F2).
    expect(overview.functions.find((item) => item.id === fn['Fluência verbal'])).toBeUndefined()
    expect(inhibition?.points[0]?.secondaryFunctions.map((item) => item.name)).toEqual([
      'Teste · Fluência verbal',
      'Teste · Fonologia'
    ])
  })

  it('o PDF de resultados mostra a etiqueta abaixo do instrumento', () => {
    const overview = buildResultsOverview(handle, assessmentId, [])
    const html = renderResultsReport(overview, {
      radar: null,
      functionRadars: {},
      comparison: {},
      evolution: {}
    })
    expect(html).toContain('class="also-assesses"')
    expect(html).toContain('Também avalia: Teste · Fluência verbal, Teste · Fonologia')
  })
})

describe('exclusão de função cognitiva', () => {
  it('o impacto conta os vínculos secundários, e a exclusão os remove', () => {
    const impact = cognitiveFunctionImpact(handle, fn['Fonologia']!)
    expect(impact.counts).toContainEqual({
      entity: 'Instrumentos que perderão a função secundária',
      count: 1
    })

    deleteCognitiveFunction(handle, fn['Fonologia']!)
    expect(getInstrument(handle, ids['fdt']!).secondaryFunctionIds).toEqual([fn['Fluência verbal']])
    expect(handle.db.select().from(instrumentSecondaryFunctions).all()).toHaveLength(1)
  })
})
