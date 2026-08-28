/**
 * Funções cognitivas (§4.3) e instrumentos (§4.4).
 *
 * As duas árvores compartilham forma e regras — profundidade ilimitada,
 * ordenação por nível, validação contra ciclos ao reparentar — então
 * compartilham também a implementação. O que difere é o modal de impacto e a
 * política de exclusão, que estão separados por entidade no fim do arquivo.
 */

import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { assessmentResults, classificationRanges, cognitiveFunctions, instruments } from '../db/schema'
import type {
  CognitiveFunction,
  CognitiveFunctionInput,
  Instrument,
  InstrumentInput
} from '@shared/contracts/entities'
import { conflict, notFound } from '../ipc/register'
import { descendantIds, REPARENT_ERROR_MESSAGES, validateReparent } from '@shared/domain/tree'
import { countWhere } from './helpers'
import type { Impact } from './helpers'

// ─── Funções cognitivas ──────────────────────────────────────────────────────

export function listCognitiveFunctions(handle: BaremoDatabase): CognitiveFunction[] {
  return handle.db
    .select()
    .from(cognitiveFunctions)
    .orderBy(asc(cognitiveFunctions.order), asc(cognitiveFunctions.name))
    .all() as CognitiveFunction[]
}

export function createCognitiveFunction(
  handle: BaremoDatabase,
  input: CognitiveFunctionInput
): CognitiveFunction {
  assertParentExists(handle, cognitiveFunctions, input.parentId)

  const id = randomUUID()
  handle.db
    .insert(cognitiveFunctions)
    .values({ id, ...input, order: input.order || nextOrder(handle, 'cognitive_functions', input.parentId) })
    .run()

  return getCognitiveFunction(handle, id)
}

export function getCognitiveFunction(handle: BaremoDatabase, id: string): CognitiveFunction {
  const row = handle.db.select().from(cognitiveFunctions).where(eq(cognitiveFunctions.id, id)).get()
  if (!row) throw notFound('Função cognitiva não encontrada.')
  return row as CognitiveFunction
}

export function updateCognitiveFunction(
  handle: BaremoDatabase,
  id: string,
  input: CognitiveFunctionInput
): CognitiveFunction {
  assertReparentAllowed(handle, listCognitiveFunctions(handle), id, input.parentId)

  const result = handle.db
    .update(cognitiveFunctions)
    .set(input)
    .where(eq(cognitiveFunctions.id, id))
    .run()
  if (result.changes === 0) throw notFound('Função cognitiva não encontrada.')

  return getCognitiveFunction(handle, id)
}

export function moveCognitiveFunction(
  handle: BaremoDatabase,
  id: string,
  parentId: string | null,
  order: number
): void {
  assertReparentAllowed(handle, listCognitiveFunctions(handle), id, parentId)

  const result = handle.db
    .update(cognitiveFunctions)
    .set({ parentId, order })
    .where(eq(cognitiveFunctions.id, id))
    .run()
  if (result.changes === 0) throw notFound('Função cognitiva não encontrada.')
}

/**
 * §6.3 — "A exclusão desta Função Cognitiva removerá o vínculo com N subtestes."
 * O vínculo cai (SET NULL na FK), os instrumentos permanecem.
 */
export function cognitiveFunctionImpact(handle: BaremoDatabase, id: string): Impact {
  const node = getCognitiveFunction(handle, id)
  const subtree = [id, ...descendantIds(listCognitiveFunctions(handle), id)]

  const linkedInstruments = subtree.reduce(
    (total, functionId) =>
      total + countWhere(handle, instruments, eq(instruments.cognitiveFunctionId, functionId)),
    0
  )

  return {
    label: node.name,
    counts: [
      { entity: 'Subfunções que serão excluídas junto', count: subtree.length - 1 },
      { entity: 'Instrumentos que perderão o vínculo', count: linkedInstruments }
    ]
  }
}

export function deleteCognitiveFunction(handle: BaremoDatabase, id: string): void {
  getCognitiveFunction(handle, id)
  // A cascata da FK remove as subfunções; o vínculo dos instrumentos vira NULL.
  handle.db.delete(cognitiveFunctions).where(eq(cognitiveFunctions.id, id)).run()
}

// ─── Instrumentos ────────────────────────────────────────────────────────────

export function listInstruments(handle: BaremoDatabase): Instrument[] {
  return handle.db
    .select()
    .from(instruments)
    .orderBy(asc(instruments.order), asc(instruments.name))
    .all() as Instrument[]
}

export function getInstrument(handle: BaremoDatabase, id: string): Instrument {
  const row = handle.db.select().from(instruments).where(eq(instruments.id, id)).get()
  if (!row) throw notFound('Instrumento não encontrado.')
  return row as Instrument
}

export function createInstrument(handle: BaremoDatabase, input: InstrumentInput): Instrument {
  assertParentExists(handle, instruments, input.parentId)

  const id = randomUUID()
  handle.db
    .insert(instruments)
    .values({ id, ...input, order: input.order || nextOrder(handle, 'instruments', input.parentId) })
    .run()

  return getInstrument(handle, id)
}

export function updateInstrument(
  handle: BaremoDatabase,
  id: string,
  input: InstrumentInput
): Instrument {
  assertReparentAllowed(handle, listInstruments(handle), id, input.parentId)

  const result = handle.db.update(instruments).set(input).where(eq(instruments.id, id)).run()
  if (result.changes === 0) throw notFound('Instrumento não encontrado.')

  return getInstrument(handle, id)
}

export function moveInstrument(
  handle: BaremoDatabase,
  id: string,
  parentId: string | null,
  order: number
): void {
  assertReparentAllowed(handle, listInstruments(handle), id, parentId)

  const result = handle.db
    .update(instruments)
    .set({ parentId, order })
    .where(eq(instruments.id, id))
    .run()
  if (result.changes === 0) throw notFound('Instrumento não encontrado.')
}

export function instrumentImpact(handle: BaremoDatabase, id: string): Impact {
  const node = getInstrument(handle, id)
  const subtree = [id, ...descendantIds(listInstruments(handle), id)]

  const totals = subtree.reduce(
    (acc, instrumentId) => ({
      results:
        acc.results +
        countWhere(handle, assessmentResults, eq(assessmentResults.instrumentId, instrumentId)),
      ranges:
        acc.ranges +
        countWhere(
          handle,
          classificationRanges,
          eq(classificationRanges.instrumentId, instrumentId)
        )
    }),
    { results: 0, ranges: 0 }
  )

  return {
    label: node.name,
    counts: [
      { entity: 'Subtestes que serão excluídos junto', count: subtree.length - 1 },
      { entity: 'Faixas de classificação que serão excluídas', count: totals.ranges },
      { entity: 'Resultados já registrados que impedem a exclusão', count: totals.results }
    ]
  }
}

/**
 * Excluir um instrumento apaga suas faixas, mas NUNCA resultados já lançados:
 * isso destruiria dado clínico de uma avaliação possivelmente já emitida em
 * laudo. Com resultados vinculados, a exclusão é recusada com a contagem.
 */
export function deleteInstrument(handle: BaremoDatabase, id: string): void {
  getInstrument(handle, id)
  const subtree = [id, ...descendantIds(listInstruments(handle), id)]

  const results = subtree.reduce(
    (total, instrumentId) =>
      total +
      countWhere(handle, assessmentResults, eq(assessmentResults.instrumentId, instrumentId)),
    0
  )

  if (results > 0) {
    throw conflict(
      `Este instrumento (ou um de seus subtestes) tem ${results} resultado(s) lançado(s) em avaliações. ` +
        'Remova esses resultados antes de excluir o instrumento.'
    )
  }

  handle.db.delete(instruments).where(eq(instruments.id, id)).run()
}

// ─── Regras compartilhadas ───────────────────────────────────────────────────

function assertParentExists(
  handle: BaremoDatabase,
  table: typeof cognitiveFunctions | typeof instruments,
  parentId: string | null
): void {
  if (parentId === null) return
  const exists = countWhere(handle, table, eq(table.id, parentId))
  if (exists === 0) throw notFound('O item pai informado não existe.')
}

function assertReparentAllowed(
  handle: BaremoDatabase,
  nodes: readonly { id: string; parentId: string | null; order: number }[],
  id: string,
  parentId: string | null
): void {
  const error = validateReparent(nodes, id, parentId)
  if (error !== null) throw conflict(REPARENT_ERROR_MESSAGES[error])
}

/** Coloca o novo nó no fim da lista de irmãos. */
function nextOrder(
  handle: BaremoDatabase,
  table: 'cognitive_functions' | 'instruments',
  parentId: string | null
): number {
  const row = handle.raw
    .prepare(
      `SELECT coalesce(max("order"), -1) + 1 AS next
         FROM ${table}
        WHERE parent_id IS ?`
    )
    .get(parentId) as { next: number }
  return row.next
}
