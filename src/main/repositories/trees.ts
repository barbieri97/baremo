/**
 * Funções cognitivas (§4.3) e instrumentos (§4.4).
 *
 * As duas árvores compartilham forma e regras — profundidade ilimitada,
 * ordenação por nível, validação contra ciclos ao reparentar — então
 * compartilham também a implementação. O que difere é o modal de impacto e a
 * política de exclusão, que estão separados por entidade no fim do arquivo.
 */

import { randomUUID } from 'node:crypto'
import { asc, eq, inArray } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import {
  assessmentResults,
  classificationRanges,
  cognitiveFunctions,
  instrumentSecondaryFunctions,
  instruments
} from '../db/schema'
import type {
  CognitiveFunction,
  CognitiveFunctionInput,
  Instrument,
  InstrumentInput
} from '@shared/contracts/entities'
import { conflict, notFound } from '../ipc/register'
import { descendantIds, REPARENT_ERROR_MESSAGES, validateReparent } from '@shared/domain/tree'
import {
  FUNCTION_VALIDATION_MESSAGES,
  indexSecondaryLinks,
  validateFunctions
} from '@shared/domain/instrument-functions'
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
    .values({
      id,
      ...input,
      order: input.order || nextOrder(handle, 'cognitive_functions', input.parentId)
    })
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
  const secondaryLinks = subtree.reduce(
    (total, functionId) =>
      total +
      countWhere(
        handle,
        instrumentSecondaryFunctions,
        eq(instrumentSecondaryFunctions.cognitiveFunctionId, functionId)
      ),
    0
  )

  return {
    label: node.name,
    counts: [
      { entity: 'Subfunções que serão excluídas junto', count: subtree.length - 1 },
      { entity: 'Instrumentos que perderão o vínculo', count: linkedInstruments },
      // Só aparece quando há o que contar: a maioria das funções não é secundária
      // de nada, e uma linha "0" a mais só alonga o aviso.
      ...(secondaryLinks > 0
        ? [{ entity: 'Instrumentos que perderão a função secundária', count: secondaryLinks }]
        : [])
    ]
  }
}

export function deleteCognitiveFunction(handle: BaremoDatabase, id: string): void {
  getCognitiveFunction(handle, id)
  // A cascata da FK remove as subfunções e os vínculos secundários; o vínculo
  // principal dos instrumentos vira NULL.
  handle.db.delete(cognitiveFunctions).where(eq(cognitiveFunctions.id, id)).run()
}

// ─── Instrumentos ────────────────────────────────────────────────────────────

export function listInstruments(handle: BaremoDatabase): Instrument[] {
  const rows = handle.db
    .select()
    .from(instruments)
    .orderBy(asc(instruments.order), asc(instruments.name))
    .all()
  const secondary = indexSecondaryLinks(listSecondaryFunctionLinks(handle))
  return rows.map((row) => ({ ...row, secondaryFunctionIds: secondary.get(row.id) ?? [] }))
}

export function getInstrument(handle: BaremoDatabase, id: string): Instrument {
  const row = handle.db.select().from(instruments).where(eq(instruments.id, id)).get()
  if (!row) throw notFound('Instrumento não encontrado.')
  const secondary = indexSecondaryLinks(listSecondaryFunctionLinks(handle, [id]))
  return { ...row, secondaryFunctionIds: secondary.get(id) ?? [] }
}

/** Vínculos secundários crus — de todos os instrumentos ou só dos pedidos. */
export function listSecondaryFunctionLinks(
  handle: BaremoDatabase,
  instrumentIds?: readonly string[]
): { instrumentId: string; cognitiveFunctionId: string; order: number }[] {
  const query = handle.db.select().from(instrumentSecondaryFunctions)
  if (instrumentIds === undefined) return query.all()
  if (instrumentIds.length === 0) return []
  return query.where(inArray(instrumentSecondaryFunctions.instrumentId, [...instrumentIds])).all()
}

export function createInstrument(handle: BaremoDatabase, input: InstrumentInput): Instrument {
  assertParentExists(handle, instruments, input.parentId)
  const { secondaryFunctionIds, ...columns } = input
  const secondary = secondaryFunctionIds ?? []
  assertFunctionsValid(handle, columns.cognitiveFunctionId, secondary)

  const id = randomUUID()
  handle.raw.transaction(() => {
    handle.db
      .insert(instruments)
      .values({
        id,
        ...columns,
        order: columns.order || nextOrder(handle, 'instruments', columns.parentId)
      })
      .run()
    writeSecondaryFunctions(handle, id, secondary)
  })()

  return getInstrument(handle, id)
}

/**
 * Atualiza os dados do instrumento e, quando `secondaryFunctionIds` vier, as
 * secundárias — na mesma transação. Sem o campo, as secundárias ficam como
 * estão, a menos que a principal tenha sido removida (F4): aí elas caem junto.
 */
export function updateInstrument(
  handle: BaremoDatabase,
  id: string,
  input: InstrumentInput
): Instrument {
  assertReparentAllowed(handle, listInstruments(handle), id, input.parentId)
  const { secondaryFunctionIds, ...columns } = input

  const secondary =
    secondaryFunctionIds ??
    (columns.cognitiveFunctionId === null
      ? []
      : (indexSecondaryLinks(listSecondaryFunctionLinks(handle, [id])).get(id) ?? []))
  assertFunctionsValid(handle, columns.cognitiveFunctionId, secondary)

  handle.raw.transaction(() => {
    const result = handle.db.update(instruments).set(columns).where(eq(instruments.id, id)).run()
    if (result.changes === 0) throw notFound('Instrumento não encontrado.')
    writeSecondaryFunctions(handle, id, secondary)
  })()

  return getInstrument(handle, id)
}

/** Substitui as secundárias de um instrumento. Quem chama valida F1/F4. */
export function writeSecondaryFunctions(
  handle: BaremoDatabase,
  instrumentId: string,
  functionIds: readonly string[]
): void {
  handle.db
    .delete(instrumentSecondaryFunctions)
    .where(eq(instrumentSecondaryFunctions.instrumentId, instrumentId))
    .run()
  if (functionIds.length === 0) return
  handle.db
    .insert(instrumentSecondaryFunctions)
    .values(
      functionIds.map((cognitiveFunctionId, order) => ({
        instrumentId,
        cognitiveFunctionId,
        order
      }))
    )
    .run()
}

/** F1 (sem repetição), F4 (secundária exige principal) e existência das funções. */
function assertFunctionsValid(
  handle: BaremoDatabase,
  primaryId: string | null,
  secondaryIds: readonly string[]
): void {
  const error = validateFunctions(primaryId, secondaryIds)
  if (error !== null) throw conflict(FUNCTION_VALIDATION_MESSAGES[error])

  for (const functionId of primaryId === null ? secondaryIds : [primaryId, ...secondaryIds]) {
    if (countWhere(handle, cognitiveFunctions, eq(cognitiveFunctions.id, functionId)) === 0) {
      throw notFound('Função cognitiva não encontrada.')
    }
  }
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
