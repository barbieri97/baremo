/**
 * Transferência do catálogo entre instalações — exportar e importar.
 *
 * O cenário que estes testes encenam é o real: DOIS bancos independentes, cada
 * um semeado por conta própria. É o detalhe que dá sentido à suíte — a paleta e
 * a árvore de funções cognitivas nascem com UUIDs diferentes em cada instalação,
 * então um catálogo que viajasse por id se ligaria a cores e funções erradas, ou
 * a nenhuma. Um teste com um banco só não veria nada disso.
 *
 * O que está sendo protegido, em uma frase cada:
 *
 *  - reimportar o mesmo arquivo não duplica nem incrementa versão de faixa;
 *  - importar nunca exclui o que já existia no destino;
 *  - a classificação já gravada em um resultado não muda (ADR-004);
 *  - arquivo inválido, circular ou inconsistente é recusado INTEIRO;
 *  - a prévia mostrada ao usuário é o que a aplicação de fato faz.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { seedIfEmpty } from '../../src/main/db/seed'
import { colors, instruments } from '../../src/main/db/schema'
import {
  createCognitiveFunction,
  createInstrument,
  listCognitiveFunctions,
  listInstruments
} from '../../src/main/repositories/trees'
import { listRanges, saveRanges } from '../../src/main/repositories/classification-ranges'
import { createPatient } from '../../src/main/repositories/patients'
import { createAssessment, listResults, saveResult } from '../../src/main/repositories/assessments'
import { buildCatalogFile } from '../../src/main/services/catalog/export'
import {
  applyCatalogImport,
  parseCatalogFile,
  planCatalogImport
} from '../../src/main/services/catalog/import'
import type { CatalogFile } from '../../src/shared/contracts/catalog'
import { CATALOG_FILE_SCHEMA } from '../../src/shared/contracts/catalog'
import { ancestorPath } from '../../src/shared/domain/tree'

let directory: string
/** A instalação onde o catálogo é montado. */
let origin: BaremoDatabase
/** A instalação que recebe o catálogo — semeada por conta própria. */
let target: BaremoDatabase

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-catalog-'))
  origin = freshDatabase('origem.db')
  target = freshDatabase('destino.db')
})

afterEach(() => {
  origin.close()
  target.close()
  rmSync(directory, { recursive: true, force: true })
})

function freshDatabase(name: string): BaremoDatabase {
  const handle = openDatabase(join(directory, name))
  runMigrations(handle)
  seedIfEmpty(handle)
  return handle
}

// ─── Apoio ───────────────────────────────────────────────────────────────────

function colorIdByName(handle: BaremoDatabase, name: string): string {
  const row = handle.db.select().from(colors).where(eq(colors.name, name)).get()
  if (!row) throw new Error(`Cor "${name}" não existe na paleta semeada.`)
  return row.id
}

function functionIdByName(handle: BaremoDatabase, name: string): string {
  const row = listCognitiveFunctions(handle).find((node) => node.name === name)
  if (!row) throw new Error(`Função cognitiva "${name}" não existe na árvore semeada.`)
  return row.id
}

/** Instrumento com faixas de percentil completas, do jeito que a UI grava. */
function seedInstrumentWithRanges(
  handle: BaremoDatabase,
  options: {
    name: string
    parentId?: string | null
    cognitiveFunctionName?: string | null
  }
): string {
  const instrument = createInstrument(handle, {
    parentId: options.parentId ?? null,
    name: options.name,
    acronym: null,
    cognitiveFunctionId:
      options.cognitiveFunctionName == null
        ? null
        : functionIdByName(handle, options.cognitiveFunctionName),
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  })

  saveRanges(handle, instrument.id, 'percentile', [
    {
      classificationName: 'Inferior',
      minValue: 0,
      maxValue: 25,
      colorId: colorIdByName(handle, 'Vermelho'),
      level: null,
      inverted: false
    },
    {
      classificationName: 'Média',
      minValue: 25,
      maxValue: 75,
      colorId: colorIdByName(handle, 'Amarelo claro'),
      level: null,
      inverted: false
    },
    {
      classificationName: 'Superior',
      minValue: 75,
      maxValue: 100,
      colorId: colorIdByName(handle, 'Verde escuro'),
      level: null,
      inverted: false
    }
  ])

  return instrument.id
}

/** Exporta da origem e devolve o arquivo já pela via de leitura real (JSON). */
function exportFile(handle: BaremoDatabase = origin): CatalogFile {
  return parseCatalogFile(JSON.stringify(buildCatalogFile(handle, '0.2.3')))
}

function functionNameOf(handle: BaremoDatabase, instrumentId: string): string | null {
  const instrument = listInstruments(handle).find((node) => node.id === instrumentId)
  if (!instrument || instrument.cognitiveFunctionId === null) return null
  const path = ancestorPath(listCognitiveFunctions(handle), instrument.cognitiveFunctionId)
  return path.at(-1)?.name ?? null
}

// ─── Ida e volta ─────────────────────────────────────────────────────────────

describe('exportar e importar', () => {
  it('reconstrói instrumentos, faixas e vínculos em outra instalação', () => {
    const id = seedInstrumentWithRanges(origin, {
      name: 'Teste de Trilhas',
      cognitiveFunctionName: 'Atenção alternada'
    })

    const report = applyCatalogImport(target, exportFile())

    expect(report.instruments).toEqual({ created: 1, updated: 0, unchanged: 0 })
    expect(report.rangeSets).toEqual({ created: 1, updated: 0, unchanged: 0 })
    expect(report.warnings).toEqual([])

    // O id viaja: é o que permite que a próxima importação reconheça este mesmo
    // instrumento em vez de criar um segundo.
    const imported = listInstruments(target).find((node) => node.id === id)
    expect(imported?.name).toBe('Teste de Trilhas')

    const ranges = listRanges(target, id, 'percentile')
    expect(ranges.map((range) => range.classificationName)).toEqual([
      'Inferior',
      'Média',
      'Superior'
    ])
    expect(ranges.map((range) => [range.minValue, range.maxValue])).toEqual([
      [0, 25],
      [25, 75],
      [75, 100]
    ])
  })

  it('religa a função cognitiva pelo NOME, e não pelo id da origem', () => {
    const id = seedInstrumentWithRanges(origin, {
      name: 'Stroop',
      cognitiveFunctionName: 'Controle inibitório'
    })

    // A premissa do teste: as duas instalações semearam a mesma árvore com ids
    // diferentes. Se fossem iguais, o teste passaria por acidente.
    expect(functionIdByName(origin, 'Controle inibitório')).not.toBe(
      functionIdByName(target, 'Controle inibitório')
    )

    applyCatalogImport(target, exportFile())

    expect(functionNameOf(target, id)).toBe('Controle inibitório')
    const imported = listInstruments(target).find((node) => node.id === id)
    expect(imported?.cognitiveFunctionId).toBe(functionIdByName(target, 'Controle inibitório'))
  })

  it('preserva a hierarquia mesmo com o filho listado antes do pai no arquivo', () => {
    const parentId = createInstrument(origin, {
      parentId: null,
      name: 'WISC-V',
      acronym: 'WISC-V',
      cognitiveFunctionId: null,
      minAgeYears: 6,
      maxAgeYears: 16,
      reference: null,
      order: 0
    }).id
    const childId = seedInstrumentWithRanges(origin, { name: 'Semelhanças', parentId })

    const file = exportFile()
    // Filho ANTES do pai, explicitamente. A FK `instruments.parent_id` é real:
    // sem reordenar por profundidade, a inserção do filho estoura.
    file.instruments.sort((a, b) => (a.id === childId ? -1 : b.id === childId ? 1 : 0))
    expect(file.instruments[0]!.id).toBe(childId)

    applyCatalogImport(target, file)

    const imported = listInstruments(target).find((node) => node.id === childId)
    expect(imported?.parentId).toBe(parentId)
  })

  it('não leva nenhum dado de paciente no arquivo', () => {
    const patient = createPatient(origin, {
      fullName: 'Paciente de Teste',
      birthDate: '1990-05-04',
      sex: 'unspecified',
      education: 'Ensino médio',
      handedness: 'right',
      guardian: null,
      contact: 'contato@exemplo.com',
      notes: 'Anotação sigilosa.'
    })
    const instrumentId = seedInstrumentWithRanges(origin, { name: 'Teste' })
    const assessment = createAssessment(origin, {
      patientId: patient.id,
      date: '2026-01-10',
      referralReason: null,
      complaint: null,
      notes: null
    })
    saveResult(origin, null, {
      assessmentId: assessment.id,
      instrumentId,
      scoreType: 'percentile',
      value: 80,
      status: 'applied',
      notes: null,
      override: null
    })

    const serialized = JSON.stringify(buildCatalogFile(origin, '0.2.3'))

    expect(Object.keys(buildCatalogFile(origin, '0.2.3'))).toEqual([
      'schema',
      'exportedAt',
      'appVersion',
      'colors',
      'instruments',
      'ranges'
    ])
    expect(serialized).not.toContain('Paciente de Teste')
    expect(serialized).not.toContain('contato@exemplo.com')
    expect(serialized).not.toContain('Anotação sigilosa')
    expect(serialized).not.toContain(patient.id)
  })
})

// ─── Reimportação ────────────────────────────────────────────────────────────

describe('reimportação do mesmo catálogo', () => {
  it('não duplica nada e não incrementa a versão das faixas', () => {
    const id = seedInstrumentWithRanges(origin, { name: 'Teste de Trilhas' })
    const file = exportFile()

    applyCatalogImport(target, file)
    const versionAfterFirst = listRanges(target, id, 'percentile')[0]!.version

    const second = applyCatalogImport(target, file)

    // Nada mudou na origem: nem "atualizado" nem "criado" — inalterado.
    expect(second.instruments).toEqual({ created: 0, updated: 0, unchanged: 1 })
    expect(second.rangeSets).toEqual({ created: 0, updated: 0, unchanged: 1 })
    expect(listInstruments(target)).toHaveLength(1)

    // A versão é o que liga um resultado ao conjunto com que foi classificado
    // (§4.8). Subir sem mudança nenhuma esvaziaria esse rastro.
    expect(listRanges(target, id, 'percentile')[0]!.version).toBe(versionAfterFirst)
  })

  it('leva nível e inversão para um destino que já tinha o conjunto sem eles', () => {
    // O caso real: o catálogo foi exportado, os níveis foram preenchidos no
    // arquivo e ele volta para a MESMA instalação. Tudo o que define a faixa —
    // nome, limites, cor — continua idêntico ao que está gravado; só nível e
    // inversão mudaram. Se a comparação de "já é igual" ignorar esses dois
    // campos, o conjunto é dado como inalterado e a edição do usuário some sem
    // erro nenhum — que é o pior desfecho possível para uma importação.
    const id = seedInstrumentWithRanges(origin, { name: 'Escala de Sintomas' })
    applyCatalogImport(target, exportFile())

    const file = exportFile()
    const set = file.ranges.find((entry) => entry.instrumentId === id)!
    const graded = {
      ...file,
      ranges: file.ranges.map((entry) =>
        entry === set
          ? {
              ...entry,
              entries: entry.entries.map((range, index) => ({
                ...range,
                level: ([3, 2, 1] as const)[index]!,
                inverted: true
              }))
            }
          : entry
      )
    }

    const report = applyCatalogImport(target, graded)
    expect(report.rangeSets).toEqual({ created: 0, updated: 1, unchanged: 0 })

    const ranges = listRanges(target, id, 'percentile')
    expect(ranges.map((range) => range.level)).toEqual([3, 2, 1])
    expect(ranges.every((range) => range.inverted)).toBe(true)
  })

  it('dá o conjunto por inalterado quando nível e inversão também são iguais', () => {
    // A contrapartida do teste acima: incluir os dois campos na comparação não
    // pode fazer toda reimportação parecer uma mudança. A versão da faixa é o
    // rastro do snapshot (§4.8) e não pode subir à toa.
    const id = seedInstrumentWithRanges(origin, { name: 'Escala de Sintomas' })
    saveRanges(
      origin,
      id,
      'percentile',
      listRanges(origin, id, 'percentile').map((range, index) => ({
        classificationName: range.classificationName,
        minValue: range.minValue,
        maxValue: range.maxValue,
        colorId: range.colorId,
        level: ([1, 3, 5] as const)[index]!,
        inverted: false
      }))
    )

    const file = exportFile()
    applyCatalogImport(target, file)
    const versionAfterFirst = listRanges(target, id, 'percentile')[0]!.version

    const second = applyCatalogImport(target, file)
    expect(second.rangeSets).toEqual({ created: 0, updated: 0, unchanged: 1 })
    expect(listRanges(target, id, 'percentile')[0]!.version).toBe(versionAfterFirst)
  })

  it('atualiza só o que mudou na origem, e deixa o resto quieto', () => {
    const id = seedInstrumentWithRanges(origin, { name: 'Teste de Trilhas' })
    seedInstrumentWithRanges(origin, { name: 'Teste que não vai mudar' })
    applyCatalogImport(target, exportFile())
    const versionBefore = listRanges(target, id, 'percentile')[0]!.version

    origin.db
      .update(instruments)
      .set({ name: 'Teste de Trilhas (TMT)', acronym: 'TMT' })
      .where(eq(instruments.id, id))
      .run()
    saveRanges(origin, id, 'percentile', [
      {
        classificationName: 'Abaixo da média',
        minValue: 0,
        maxValue: 50,
        colorId: colorIdByName(origin, 'Vermelho'),
        level: null,
        inverted: false
      },
      {
        classificationName: 'Acima da média',
        minValue: 50,
        maxValue: 100,
        colorId: colorIdByName(origin, 'Verde escuro'),
        level: null,
        inverted: false
      }
    ])

    const report = applyCatalogImport(target, exportFile())

    // O segundo instrumento e as faixas dele não foram tocados nem contados.
    expect(report.instruments).toEqual({ created: 0, updated: 1, unchanged: 1 })
    expect(report.rangeSets).toEqual({ created: 0, updated: 1, unchanged: 1 })

    const imported = listInstruments(target).find((node) => node.id === id)
    expect(imported?.name).toBe('Teste de Trilhas (TMT)')
    expect(imported?.acronym).toBe('TMT')

    const ranges = listRanges(target, id, 'percentile')
    expect(ranges).toHaveLength(2)
    expect(ranges[0]!.version).toBeGreaterThan(versionBefore)
  })

  it('não exclui o que já existia no destino e não está no arquivo', () => {
    seedInstrumentWithRanges(origin, { name: 'Teste da origem' })
    const localId = seedInstrumentWithRanges(target, { name: 'Teste só do destino' })

    applyCatalogImport(target, exportFile())

    const survivor = listInstruments(target).find((node) => node.id === localId)
    expect(survivor?.name).toBe('Teste só do destino')
    expect(listRanges(target, localId, 'percentile')).toHaveLength(3)
  })
})

// ─── ADR-004 ─────────────────────────────────────────────────────────────────

describe('snapshot de classificação (ADR-004)', () => {
  it('não reclassifica resultado já lançado quando a importação troca as faixas', () => {
    const id = seedInstrumentWithRanges(origin, { name: 'Teste de Trilhas' })
    applyCatalogImport(target, exportFile())

    const patient = createPatient(target, {
      fullName: 'Paciente',
      birthDate: '1990-01-01',
      sex: 'unspecified',
      education: null,
      handedness: 'right',
      guardian: null,
      contact: null,
      notes: null
    })
    const assessment = createAssessment(target, {
      patientId: patient.id,
      date: '2026-01-10',
      referralReason: null,
      complaint: null,
      notes: null
    })
    saveResult(target, null, {
      assessmentId: assessment.id,
      instrumentId: id,
      scoreType: 'percentile',
      value: 80,
      status: 'applied',
      notes: null,
      override: null
    })

    expect(listResults(target, assessment.id)[0]!.classificationName).toBe('Superior')

    // A origem renomeia a faixa em que o valor 80 cai e reexporta.
    saveRanges(origin, id, 'percentile', [
      {
        classificationName: 'Inferior',
        minValue: 0,
        maxValue: 25,
        colorId: colorIdByName(origin, 'Vermelho'),
        level: null,
        inverted: false
      },
      {
        classificationName: 'Média',
        minValue: 25,
        maxValue: 75,
        colorId: colorIdByName(origin, 'Amarelo claro'),
        level: null,
        inverted: false
      },
      {
        classificationName: 'Muito acima da média',
        minValue: 75,
        maxValue: 100,
        colorId: colorIdByName(origin, 'Verde escuro'),
        level: null,
        inverted: false
      }
    ])

    applyCatalogImport(target, exportFile())

    // O laudo já emitido continua dizendo o que dizia. Reclassificar exige a
    // ação explícita de reprocessar.
    expect(listResults(target, assessment.id)[0]!.classificationName).toBe('Superior')
    expect(listRanges(target, id, 'percentile').map((r) => r.classificationName)).toContain(
      'Muito acima da média'
    )
  })
})

// ─── Cores ───────────────────────────────────────────────────────────────────

describe('paleta', () => {
  it('reaproveita a cor do destino quando o hex já existe, sem criar duplicata', () => {
    seedInstrumentWithRanges(origin, { name: 'Teste' })
    const paletteBefore = target.db.select().from(colors).all().length

    const report = applyCatalogImport(target, exportFile())

    expect(report.colors).toEqual({ created: 0, matched: 3 })
    expect(target.db.select().from(colors).all()).toHaveLength(paletteBefore)
  })

  it('cria no destino a cor personalizada que só existe na origem', () => {
    const customId = randomUUID()
    origin.db
      .insert(colors)
      .values({
        id: customId,
        name: 'Roxo do consultório',
        hex: '#6B46C1',
        order: 99,
        isSeed: false
      })
      .run()

    const instrumentId = createInstrument(origin, {
      parentId: null,
      name: 'Teste',
      acronym: null,
      cognitiveFunctionId: null,
      minAgeYears: null,
      maxAgeYears: null,
      reference: null,
      order: 0
    }).id
    saveRanges(origin, instrumentId, 'percentile', [
      {
        classificationName: 'Tudo',
        minValue: 0,
        maxValue: 100,
        colorId: customId,
        level: null,
        inverted: false
      }
    ])

    const report = applyCatalogImport(target, exportFile())

    expect(report.colors).toEqual({ created: 1, matched: 0 })
    const created = target.db.select().from(colors).where(eq(colors.id, customId)).get()
    expect(created?.hex).toBe('#6B46C1')
    expect(created?.isSeed).toBe(false)

    // Segunda importação: a cor já está lá e é reconhecida pelo hex.
    expect(applyCatalogImport(target, exportFile()).colors).toEqual({ created: 0, matched: 1 })
  })
})

// ─── Avisos ──────────────────────────────────────────────────────────────────

describe('avisos', () => {
  it('importa sem vínculo e avisa quando a função cognitiva não existe no destino', () => {
    const customFunction = createCognitiveFunction(origin, {
      parentId: null,
      name: 'Função que só existe na origem',
      description: null,
      order: 50
    })
    const id = createInstrument(origin, {
      parentId: null,
      name: 'Teste',
      acronym: null,
      cognitiveFunctionId: customFunction.id,
      minAgeYears: null,
      maxAgeYears: null,
      reference: null,
      order: 0
    }).id

    const report = applyCatalogImport(target, exportFile())

    expect(report.instruments.created).toBe(1)
    expect(report.warnings).toHaveLength(1)
    expect(report.warnings[0]!.code).toBe('unknown_cognitive_function')
    expect(report.warnings[0]!.message).toContain('Função que só existe na origem')

    const imported = listInstruments(target).find((node) => node.id === id)
    expect(imported?.cognitiveFunctionId).toBeNull()
  })

  it('avisa quando o destino já tem um instrumento de mesmo nome no mesmo nível', () => {
    seedInstrumentWithRanges(origin, { name: 'Stroop' })
    seedInstrumentWithRanges(target, { name: 'Stroop' })

    const report = applyCatalogImport(target, exportFile())

    expect(report.warnings.map((warning) => warning.code)).toEqual(['duplicate_name'])
    // Os dois convivem: mesclar por nome sobrescreveria as faixas de quem já
    // tinha o instrumento cadastrado com outra normatização.
    expect(listInstruments(target).filter((node) => node.name === 'Stroop')).toHaveLength(2)
  })
})

// ─── Recusa ──────────────────────────────────────────────────────────────────

describe('arquivo inválido', () => {
  it('recusa o que não é JSON', () => {
    expect(() => parseCatalogFile('isto não é json')).toThrowError(/não é um JSON válido/)
  })

  it('recusa arquivo de outro formato ou de versão incompatível', () => {
    expect(() =>
      parseCatalogFile(JSON.stringify({ schema: 'baremo/catalog@2', instruments: [] }))
    ).toThrowError(/não é um catálogo do Baremo válido/)

    // O JSON de prontuário é o vizinho mais provável de ser escolhido por engano.
    expect(() =>
      parseCatalogFile(JSON.stringify({ schema: 'baremo/medical-record@1', patient: {} }))
    ).toThrowError(/não é um catálogo do Baremo válido/)
  })

  it('recusa hierarquia circular', () => {
    const a = randomUUID()
    const b = randomUUID()
    const file = baseFile({
      instruments: [
        instrumentEntry({ id: a, parentId: b, name: 'A' }),
        instrumentEntry({ id: b, parentId: a, name: 'B' })
      ]
    })

    expect(() => applyCatalogImport(target, file)).toThrowError(/circular/)
    expect(listInstruments(target)).toHaveLength(0)
  })

  it('recusa conjunto de faixas com sobreposição, sem gravar nada', () => {
    const id = randomUUID()
    const colorId = colorIdByName(target, 'Vermelho')
    const file = baseFile({
      colors: [{ id: colorId, name: 'Vermelho', hex: '#C53030' }],
      instruments: [instrumentEntry({ id, parentId: null, name: 'Instrumento novo' })],
      ranges: [
        {
          instrumentId: id,
          scoreType: 'percentile',
          entries: [
            { classificationName: 'Baixo', minValue: 0, maxValue: 60, colorId },
            { classificationName: 'Alto', minValue: 40, maxValue: 100, colorId }
          ]
        }
      ]
    })

    expect(() => applyCatalogImport(target, file)).toThrowError(/inconsistente/)
    // Tudo ou nada: o instrumento da mesma importação não pode ter ficado.
    expect(listInstruments(target)).toHaveLength(0)
  })

  it('recusa faixa que aponta para cor ausente do próprio arquivo', () => {
    const id = randomUUID()
    const file = baseFile({
      colors: [],
      instruments: [instrumentEntry({ id, parentId: null, name: 'Instrumento' })],
      ranges: [
        {
          instrumentId: id,
          scoreType: 'percentile',
          entries: [
            { classificationName: 'Tudo', minValue: 0, maxValue: 100, colorId: randomUUID() }
          ]
        }
      ]
    })

    expect(() => applyCatalogImport(target, file)).toThrowError(/cor que não está/)
    expect(listInstruments(target)).toHaveLength(0)
  })

  /**
   * As outras recusas acontecem antes de qualquer escrita, então passariam mesmo
   * sem transação. Esta não: o id repetido só estoura na SEGUNDA inserção, com a
   * primeira já gravada. É o teste que de fato exercita o rollback.
   */
  it('desfaz o que já havia gravado quando a falha acontece no meio da aplicação', () => {
    const repeated = randomUUID()
    const file = baseFile({
      instruments: [
        instrumentEntry({ id: repeated, parentId: null, name: 'Primeiro' }),
        instrumentEntry({ id: randomUUID(), parentId: null, name: 'Do meio' }),
        instrumentEntry({ id: repeated, parentId: null, name: 'Id repetido' })
      ]
    })

    expect(() => applyCatalogImport(target, file)).toThrowError()
    expect(listInstruments(target)).toHaveLength(0)
  })

  it('recusa faixas de instrumento que não está no arquivo', () => {
    const file = baseFile({
      colors: [{ id: colorIdByName(target, 'Vermelho'), name: 'Vermelho', hex: '#C53030' }],
      instruments: [],
      ranges: [
        {
          instrumentId: randomUUID(),
          scoreType: 'percentile',
          entries: [
            {
              classificationName: 'Tudo',
              minValue: 0,
              maxValue: 100,
              colorId: colorIdByName(target, 'Vermelho'),
              level: null,
              inverted: false
            }
          ]
        }
      ]
    })

    expect(() => applyCatalogImport(target, file)).toThrowError(/instrumento que não está/)
  })
})

// ─── Prévia ──────────────────────────────────────────────────────────────────

describe('prévia', () => {
  it('anuncia exatamente o que a aplicação faz', () => {
    seedInstrumentWithRanges(origin, {
      name: 'Teste com função ausente',
      cognitiveFunctionName: null
    })
    seedInstrumentWithRanges(origin, {
      name: 'Teste com função',
      cognitiveFunctionName: 'Planejamento'
    })
    const file = exportFile()

    const plan = planCatalogImport(target, file)
    const applied = applyCatalogImport(target, file)

    expect(plan).toEqual(applied)
    expect(plan.instruments).toEqual({ created: 2, updated: 0, unchanged: 0 })
    expect(plan.rangeSets).toEqual({ created: 2, updated: 0, unchanged: 0 })
  })

  it('não escreve nada ao calcular a prévia', () => {
    seedInstrumentWithRanges(origin, { name: 'Teste' })

    planCatalogImport(target, exportFile())

    expect(listInstruments(target)).toHaveLength(0)
  })
})

// ─── Fábricas de arquivo cru ─────────────────────────────────────────────────

function baseFile(overrides: Partial<CatalogFile>): CatalogFile {
  return {
    schema: CATALOG_FILE_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion: '0.2.3',
    colors: [],
    instruments: [],
    ranges: [],
    ...overrides
  }
}

function instrumentEntry(options: {
  id: string
  parentId: string | null
  name: string
}): CatalogFile['instruments'][number] {
  return {
    id: options.id,
    parentId: options.parentId,
    name: options.name,
    acronym: null,
    cognitiveFunctionPath: null,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  }
}
