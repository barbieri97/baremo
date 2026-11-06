/**
 * Funções efetivas de cada instrumento, já resolvidas pela herança (SPEC
 * funções múltiplas, F3).
 *
 * Tudo o que agrupa resultados por função passa por aqui em vez de fazer join
 * direto em `instruments.cognitive_function_id`: um subteste sem função própria
 * cai no grupo da função do teste pai, e não em "Sem função cognitiva associada".
 *
 * O catálogo inteiro cabe em memória (centenas de linhas no máximo), então o
 * resolvedor carrega as três tabelas uma vez e responde por instrumento.
 */

import type { BaremoDatabase } from '../db/gateway'
import { cognitiveFunctions, instrumentSecondaryFunctions, instruments } from '../db/schema'
import { indexSecondaryLinks, resolveFunctions } from '@shared/domain/instrument-functions'
import type { FunctionOwnerNode } from '@shared/domain/instrument-functions'

export interface NamedFunction {
  readonly id: string
  readonly name: string
}

export interface EffectiveFunctions {
  readonly primaryId: string | null
  readonly primaryName: string | null
  readonly secondaryFunctions: NamedFunction[]
  /** Verdadeiro quando a principal veio de um ancestral. */
  readonly functionInherited: boolean
}

const NONE: EffectiveFunctions = {
  primaryId: null,
  primaryName: null,
  secondaryFunctions: [],
  functionInherited: false
}

export function loadFunctionResolver(
  handle: BaremoDatabase
): (instrumentId: string) => EffectiveFunctions {
  const nodes = handle.db
    .select({
      id: instruments.id,
      parentId: instruments.parentId,
      cognitiveFunctionId: instruments.cognitiveFunctionId
    })
    .from(instruments)
    .all()
  const byId = new Map<string, FunctionOwnerNode>(nodes.map((node) => [node.id, node]))
  const secondary = indexSecondaryLinks(handle.db.select().from(instrumentSecondaryFunctions).all())
  const names = new Map(
    handle.db
      .select({ id: cognitiveFunctions.id, name: cognitiveFunctions.name })
      .from(cognitiveFunctions)
      .all()
      .map((row) => [row.id, row.name])
  )

  const cache = new Map<string, EffectiveFunctions>()
  return (instrumentId) => {
    const cached = cache.get(instrumentId)
    if (cached) return cached

    const resolved = resolveFunctions(instrumentId, byId, secondary)
    const value: EffectiveFunctions =
      resolved.primaryId === null
        ? NONE
        : {
            primaryId: resolved.primaryId,
            primaryName: names.get(resolved.primaryId) ?? null,
            secondaryFunctions: resolved.secondaryIds.flatMap((id) => {
              const name = names.get(id)
              return name === undefined ? [] : [{ id, name }]
            }),
            functionInherited: resolved.inheritedFrom !== null
          }
    cache.set(instrumentId, value)
    return value
  }
}
