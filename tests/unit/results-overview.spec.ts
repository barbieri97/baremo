/**
 * Radares hierárquicos por função cognitiva (spec §7.3).
 *
 * O que estes testes travam é uma distinção fácil de apagar por simplificação:
 * existem DUAS contagens por função, e elas têm de continuar diferentes.
 *
 * A **direta** é a dos cartões e das tabelas — só o que foi de fato aplicado
 * naquela função. A **somada** é a dos radares — a função mais tudo o que pende
 * dela. Fundir as duas é a "melhoria" óbvia, e ela quebra os dois lados: ou a
 * tabela de "Atenção" passa a listar resultados que ninguém lançou nela, ou
 * "Atenção" volta a sumir do radar quando os instrumentos estão nas filhas.
 *
 * Roda contra um banco real, atravessando repositórios e serviços.
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
import { createCognitiveFunction, createInstrument } from '../../src/main/repositories/trees'
import { saveRanges } from '../../src/main/repositories/classification-ranges'
import { createAssessment, saveResult } from '../../src/main/repositories/assessments'
import { buildResultsOverview } from '../../src/main/services/results-overview'
import type { ResultsOverview } from '@shared/contracts/results'

let handle: BaremoDatabase
let directory: string
let assessmentId: string
let colorId: string

/** Funções da árvore montada no `beforeAll`, para os testes se referirem a elas. */
const fn: Record<string, string> = {}

/**
 * Uma função cognitiva com um instrumento próprio, já pontuado.
 *
 * `percentile` com duas faixas: abaixo de 50 é nível 1, daí para cima é 5. O
 * valor escolhido em cada chamada é o que define o nível do resultado.
 */
function addFunction(name: string, parentId: string | null): string {
  const id = createCognitiveFunction(handle, {
    parentId,
    name,
    description: null,
    order: 0
  }).id
  fn[name] = id
  return id
}

function addScoredInstrument(name: string, cognitiveFunctionId: string, value: number): void {
  const instrumentId = createInstrument(handle, {
    parentId: null,
    name,
    acronym: null,
    cognitiveFunctionId,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  }).id

  saveRanges(handle, instrumentId, 'percentile', [
    {
      classificationName: 'Rebaixado',
      minValue: 0,
      maxValue: 50,
      colorId,
      level: 1,
      inverted: false
    },
    {
      classificationName: 'Preservado',
      minValue: 50,
      maxValue: 100,
      colorId,
      level: 5,
      inverted: false
    }
  ])

  saveResult(handle, null, {
    assessmentId,
    instrumentId,
    scoreType: 'percentile',
    value,
    status: 'applied',
    notes: null,
    override: null
  })
}

/** Instrumento sem faixas: grava resultado, mas o nível fica nulo. */
function addUnleveledInstrument(name: string, cognitiveFunctionId: string): void {
  const instrumentId = createInstrument(handle, {
    parentId: null,
    name,
    acronym: null,
    cognitiveFunctionId,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 0
  }).id

  saveResult(handle, null, {
    assessmentId,
    instrumentId,
    scoreType: 'percentile',
    value: 42,
    status: 'applied',
    notes: null,
    override: null
  })
}

let overview: ResultsOverview

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-overview-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  seedIfEmpty(handle)

  colorId = handle.db.select().from(colors).all()[0]!.id

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

  // ── A árvore de teste ────────────────────────────────────────────────────
  //
  // Atenção          ← nenhum instrumento próprio; 3 filhas pontuadas
  //   Sustentada     nível 1
  //   Seletiva       nível 1
  //   Dividida       nível 5
  // Memória          ← 1 instrumento PRÓPRIO (nível 5) + 2 filhas
  //   Trabalho       nível 1
  //   Episódica      nível 1
  // Linguagem        ← só instrumento próprio, sem filhas
  //   (nível 5)
  // Praxias          ← filha sem nível, para o eixo ter de sumir
  //   Sem faixa      (resultado sem classificação)

  const atencao = addFunction('Atenção', null)
  addScoredInstrument('Teste Sustentada', addFunction('Sustentada', atencao), 10)
  addScoredInstrument('Teste Seletiva', addFunction('Seletiva', atencao), 10)
  addScoredInstrument('Teste Dividida', addFunction('Dividida', atencao), 90)

  const memoria = addFunction('Memória', null)
  addScoredInstrument('Teste Memória Global', memoria, 90)
  addScoredInstrument('Teste Trabalho', addFunction('Trabalho', memoria), 10)
  addScoredInstrument('Teste Episódica', addFunction('Episódica', memoria), 10)

  addScoredInstrument('Teste Linguagem', addFunction('Linguagem', null), 90)

  const praxias = addFunction('Praxias', null)
  addUnleveledInstrument('Teste Sem Faixa', addFunction('Sem nível', praxias))

  overview = buildResultsOverview(handle, assessmentId, [])
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

const groupNamed = (name: string): NonNullable<ResultsOverview['functionGroups'][number]> => {
  const group = overview.functionGroups.find((entry) => entry.name === name)
  if (group === undefined) throw new Error(`grupo "${name}" não foi montado`)
  return group
}

describe('a lista plana de funções continua por atribuição direta', () => {
  it('a função pai sem instrumentos próprios não vira cartão', () => {
    expect(overview.functions.map((entry) => entry.name)).not.toContain('Atenção')
  })

  it('a função pai COM instrumento próprio conta só o dela', () => {
    const memoria = overview.functions.find((entry) => entry.name === 'Memória')
    expect(memoria?.points).toHaveLength(1)
    expect(memoria?.averageLevel).toBe(5)
  })
})

describe('radar geral', () => {
  it('compara as funções raiz, inclusive a que não tem instrumento próprio', () => {
    const names = overview.overallRadar?.axes.map((axis) => axis.name)
    expect(names).toContain('Atenção')
    expect(names).toEqual(['Atenção', 'Memória', 'Linguagem'])
  })

  it('a raiz sem nível em nenhum lugar da subárvore não vira eixo', () => {
    expect(overview.overallRadar?.axes.map((axis) => axis.name)).not.toContain('Praxias')
  })

  it('o nível da raiz soma a subárvore inteira, e não só os resultados diretos', () => {
    const memoria = overview.overallRadar?.axes.find((axis) => axis.name === 'Memória')
    // próprio 5, filhas 1 e 1 → 7/3. Só o direto daria 5.
    expect(memoria?.averageLevel).toBeCloseTo(7 / 3)
    expect(memoria?.resultCount).toBe(3)
  })

  it('ordena os eixos pela árvore, não pelo nível', () => {
    // Atenção (1+1+5)/3 = 2,33 vem antes de Memória 2,33 e de Linguagem 5 por
    // ordem de cadastro — a forma do polígono tem de ser estável entre datas.
    const levels = overview.overallRadar?.axes.map((axis) => axis.name)
    expect(levels).toEqual(['Atenção', 'Memória', 'Linguagem'])
  })
})

describe('radar por função pai', () => {
  it('compara as filhas quando há três com nível', () => {
    const radar = groupNamed('Atenção').radars[0]
    expect(radar?.parentId).toBe(fn['Atenção'])
    expect(radar?.axes.map((axis) => axis.name)).toEqual(['Sustentada', 'Seletiva', 'Dividida'])
  })

  it('some com menos de três eixos', () => {
    // Memória tem duas filhas: um radar de dois eixos seria um traço.
    expect(groupNamed('Memória').radars).toHaveLength(0)
  })

  it('não desenha radar para função raiz sem filhas', () => {
    expect(groupNamed('Linguagem').radars).toHaveLength(0)
  })

  it('o resultado direto do pai não vira eixo do radar dele', () => {
    const nomes = groupNamed('Atenção').radars[0]?.axes.map((axis) => axis.name)
    expect(nomes).not.toContain('Atenção')
  })
})

describe('grupos por função raiz', () => {
  it('agregam a subárvore inteira no cabeçalho', () => {
    const atencao = groupNamed('Atenção')
    expect(atencao.resultCount).toBe(3)
    expect(atencao.belowExpected).toBe(2)
    expect(atencao.distribution[1]).toBe(2)
    expect(atencao.distribution[5]).toBe(1)
  })

  it('aninham as tabelas das filhas, e a do próprio pai quando existe', () => {
    // Dentro do bloco vale a mesma ordem do panorama: mais rebaixada
    // primeiro, empate de nível desfeito pelo nome em pt-BR.
    expect(groupNamed('Atenção').functions.map((entry) => entry.name)).toEqual([
      'Seletiva',
      'Sustentada',
      'Dividida'
    ])
    expect(groupNamed('Memória').functions.map((entry) => entry.name)).toEqual([
      'Episódica',
      'Trabalho',
      'Memória'
    ])
  })

  it('a raiz sem nível nenhum ainda aparece, para os resultados não sumirem', () => {
    const praxias = groupNamed('Praxias')
    expect(praxias.averageLevel).toBeNull()
    expect(praxias.resultCount).toBe(1)
    expect(praxias.radars).toHaveLength(0)
  })

  it('ordena da mais rebaixada para a mais preservada, sem nível por último', () => {
    expect(overview.functionGroups.map((group) => group.name)).toEqual([
      'Atenção',
      'Memória',
      'Linguagem',
      'Praxias'
    ])
  })
})
