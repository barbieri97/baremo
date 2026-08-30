/**
 * View-model da visualização de resultados (spec §7.3).
 *
 * Uma montagem só, consumida por dois destinos: a página "Visualizar
 * resultados" no renderer e o relatório em PDF. É deliberado — os dois precisam
 * dizer exatamente a mesma coisa, e manter duas agregações em paralelo é como
 * elas passam a divergir.
 *
 * Duas organizações do mesmo conjunto de resultados convivem aqui, porque
 * respondem a perguntas diferentes:
 *
 * **Por função cognitiva** responde "onde está o problema?". É a leitura de
 * relance, ordenada da função mais rebaixada para a mais preservada.
 *
 * **Por teste** responde "como este instrumento se comportou?". Agrupa pelo
 * instrumento RAIZ e alinha os subtestes lado a lado, que é o que torna o
 * gráfico de comparação possível.
 *
 * As avaliações de comparação entram como colunas adicionais das mesmas
 * entradas, nunca como um segundo conjunto paralelo: é isso que faz a evolução
 * no tempo cair de graça, sem uma terceira agregação.
 */

import type { BaremoDatabase } from '../db/gateway'
import { buildContext } from './reports'
import type {
  FunctionSummary,
  OverviewAssessment,
  ResultPoint,
  ResultsOverview,
  TestEntry,
  TestGroup
} from '@shared/contracts/results'
import { loadRangesForInstruments, rangeKey } from './classification'
import { getAssessment, listResultsForAssessments } from '../repositories/assessments'
import type { ResultRow } from '../repositories/assessments'
import { listCognitiveFunctions, listInstruments } from '../repositories/trees'
import type { CognitiveFunction, Instrument } from '@shared/contracts/entities'
import { ancestorPath, flatten } from '@shared/domain/tree'
import { normalizeScore } from '@shared/domain/normalize'
import { aggregateLevel, countBelowExpected, levelDistribution } from '@shared/domain/levels'
import { formatIsoDate } from '@shared/domain/dates'
import { RESULT_STATUS_LABELS, SCORE_TYPE_SHORT_LABELS } from '@shared/labels'

export function buildResultsOverview(
  handle: BaremoDatabase,
  assessmentId: string,
  comparisonIds: readonly string[]
): ResultsOverview {
  const context = buildContext(handle, assessmentId)

  // A principal sempre primeiro, e sem repetir se vier duplicada no pedido.
  const orderedIds = [assessmentId, ...comparisonIds.filter((id) => id !== assessmentId)]
  const assessments: OverviewAssessment[] = orderedIds.map((id) => {
    const row = getAssessment(handle, id)
    return {
      id,
      date: row.date,
      dateLabel: formatIsoDate(row.date),
      isPrimary: id === assessmentId
    }
  })

  const rows = listResultsForAssessments(handle, orderedIds)
  const instrumentCatalog = listInstruments(handle)
  const functionCatalog = listCognitiveFunctions(handle)

  const rangesByKey = loadRangesForInstruments(handle, [
    ...new Set(rows.map((row) => row.instrumentId))
  ])
  const invertedOf = (row: ResultRow): boolean =>
    rangesByKey.get(rangeKey(row.instrumentId, row.scoreType))?.[0]?.inverted ?? false

  const pathOf = instrumentPathResolver(instrumentCatalog)
  const points = rows.map((row) => toPoint(row, pathOf(row.instrumentId), invertedOf(row)))

  const primaryPoints = points.filter((point) => point.assessmentId === assessmentId)

  return {
    ...context,
    assessmentId,
    assessments,
    functions: summarizeFunctions(primaryPoints, functionCatalog),
    tests: groupByTest(points, instrumentCatalog, assessments, rangesByKey),
    missingLevels: primaryPoints.filter(
      (point) => point.classificationLevel === null && point.value !== null
    ).length,
    totalResults: primaryPoints.length
  }
}

function toPoint(row: ResultRow, instrumentPath: string, inverted: boolean): ResultPoint {
  return {
    resultId: row.id,
    assessmentId: row.assessmentId,
    instrumentId: row.instrumentId,
    instrumentName: row.instrumentName,
    instrumentAcronym: row.instrumentAcronym,
    instrumentPath,
    scoreType: row.scoreType,
    scoreTypeLabel: SCORE_TYPE_SHORT_LABELS[row.scoreType],
    value: row.value,
    normalized: normalizeScore(row.value, row.scoreType, inverted),
    classificationName: row.classificationName,
    colorHex: row.colorHex,
    classificationLevel: row.classificationLevel,
    status: row.status,
    statusLabel: RESULT_STATUS_LABELS[row.status],
    manuallyOverridden: row.manuallyOverridden,
    notes: row.notes,
    cognitiveFunctionId: row.cognitiveFunctionId,
    cognitiveFunctionName: row.cognitiveFunctionName
  }
}

/**
 * Resolve o caminho hierárquico de um instrumento, com memória.
 *
 * `ancestorPath` reconstrói o índice da árvore a cada chamada; numa avaliação
 * com dezenas de subtestes isso é trabalho repetido à toa.
 */
function instrumentPathResolver(catalog: readonly Instrument[]): (id: string) => string {
  const cache = new Map<string, string>()

  return (id) => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached

    const path = ancestorPath(catalog, id)
      .map((node) => node.name)
      .join(' › ')
    cache.set(id, path)
    return path
  }
}

/**
 * Agrega por função cognitiva, da mais rebaixada para a mais preservada.
 *
 * A ordem é o produto principal: é ela que faz o panorama responder "onde está
 * o problema?" sem que o usuário tenha de comparar cartões um a um. Funções sem
 * nível nenhum vão para o fim — não têm como ser ordenadas, e fingir uma
 * posição para elas seria pior do que admitir a ausência.
 */
function summarizeFunctions(
  points: readonly ResultPoint[],
  catalog: readonly CognitiveFunction[]
): FunctionSummary[] {
  const byFunction = new Map<string | null, ResultPoint[]>()
  for (const point of points) {
    const bucket = byFunction.get(point.cognitiveFunctionId)
    if (bucket) bucket.push(point)
    else byFunction.set(point.cognitiveFunctionId, [point])
  }

  const summaries: FunctionSummary[] = []

  for (const { node, depth } of flatten(catalog)) {
    const bucket = byFunction.get(node.id)
    if (bucket === undefined || bucket.length === 0) continue
    summaries.push(summarize(node.id, node.name, depth, bucket))
  }

  const unassigned = byFunction.get(null)
  if (unassigned !== undefined && unassigned.length > 0) {
    summaries.push(summarize(null, 'Sem função cognitiva associada', 0, unassigned))
  }

  return summaries.sort((a, b) => {
    if (a.averageLevel === null && b.averageLevel === null) {
      return a.name.localeCompare(b.name, 'pt-BR')
    }
    if (a.averageLevel === null) return 1
    if (b.averageLevel === null) return -1
    if (a.averageLevel !== b.averageLevel) return a.averageLevel - b.averageLevel
    return a.name.localeCompare(b.name, 'pt-BR')
  })
}

function summarize(
  id: string | null,
  name: string,
  depth: number,
  points: ResultPoint[]
): FunctionSummary {
  const levels = points.map((point) => point.classificationLevel)
  const normalized = points
    .map((point) => point.normalized)
    .filter((value): value is number => value !== null)

  return {
    id,
    name,
    depth,
    points,
    averageLevel: aggregateLevel(levels),
    averageNormalized:
      normalized.length === 0
        ? null
        : normalized.reduce((sum, value) => sum + value, 0) / normalized.length,
    distribution: levelDistribution(levels),
    belowExpected: countBelowExpected(levels)
  }
}

/**
 * Agrupa pelo instrumento RAIZ, alinhando as entradas por avaliação.
 *
 * A raiz é o "teste" no sentido em que o clínico fala dele — o WAIS, e não cada
 * um dos seus dez subtestes. Um instrumento sem pai é raiz de si mesmo, e nesse
 * caso o grupo tem uma entrada só: aparece como tabela, sem gráfico de
 * comparação, porque não existe comparação de um item com nada.
 */
function groupByTest(
  points: readonly ResultPoint[],
  catalog: readonly Instrument[],
  assessments: readonly OverviewAssessment[],
  rangesByKey: ReturnType<typeof loadRangesForInstruments>
): TestGroup[] {
  const rootOf = rootResolver(catalog)
  const byId = new Map(catalog.map((node) => [node.id, node]))

  const groups = new Map<string, Map<string, ResultPoint[]>>()

  for (const point of points) {
    const rootId = rootOf(point.instrumentId)
    const entryKey = `${point.instrumentId}::${point.scoreType}`

    const group = groups.get(rootId) ?? new Map<string, ResultPoint[]>()
    const entry = group.get(entryKey) ?? []
    entry.push(point)
    group.set(entryKey, entry)
    groups.set(rootId, group)
  }

  const out: TestGroup[] = []

  for (const [rootId, entryMap] of groups) {
    const root = byId.get(rootId)
    if (root === undefined) continue

    const entries: TestEntry[] = [...entryMap.entries()].map(([key, entryPoints]) => {
      const sample = entryPoints[0]!
      const node = byId.get(sample.instrumentId)
      return {
        key,
        label: entryLabel(node, root, sample),
        instrumentId: sample.instrumentId,
        scoreType: sample.scoreType,
        scoreTypeLabel: sample.scoreTypeLabel,
        values: assessments.map(
          (assessment) => entryPoints.find((point) => point.assessmentId === assessment.id) ?? null
        )
      }
    })

    // Ordem do catálogo, para o gráfico sair na sequência do manual do teste, e
    // não na ordem em que os resultados foram digitados.
    const order = new Map(catalog.map((node, index) => [node.id, index]))
    entries.sort((a, b) => (order.get(a.instrumentId) ?? 0) - (order.get(b.instrumentId) ?? 0))

    out.push({
      instrumentId: rootId,
      name: root.name,
      acronym: root.acronym,
      label: instrumentLabel(root),
      inverted:
        rangesByKey.get(rangeKey(entries[0]!.instrumentId, entries[0]!.scoreType))?.[0]?.inverted ??
        false,
      entries,
      comparable: entries.length >= 2
    })
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Rótulo de uma entrada dentro do teste.
 *
 * Quando a entrada é o próprio nó raiz, repetir o nome do teste no eixo seria
 * ruído — o título do card já o diz —, então usa-se o tipo de escore. É o caso
 * do instrumento que produz vários escores sem ter subtestes.
 */
function entryLabel(node: Instrument | undefined, root: Instrument, sample: ResultPoint): string {
  const name = node?.name ?? sample.instrumentName
  return node?.id === root.id ? `${name} · ${sample.scoreTypeLabel}` : name
}

function instrumentLabel(instrument: Instrument): string {
  return instrument.acronym !== null && instrument.acronym.length > 0
    ? `${instrument.name} (${instrument.acronym})`
    : instrument.name
}

/** Sobe até a raiz da árvore de instrumentos, com memória e guarda de ciclo. */
function rootResolver(catalog: readonly Instrument[]): (id: string) => string {
  const byId = new Map(catalog.map((node) => [node.id, node]))
  const cache = new Map<string, string>()

  return (id) => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached

    const seen = new Set<string>()
    let cursor = id
    while (!seen.has(cursor)) {
      seen.add(cursor)
      const parent = byId.get(cursor)?.parentId
      if (parent === null || parent === undefined || !byId.has(parent)) break
      cursor = parent
    }

    cache.set(id, cursor)
    return cursor
  }
}
