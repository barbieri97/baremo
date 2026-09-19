/**
 * Regras da entrada de resultados (spec §4.5, §16.4), comuns ao lançamento
 * individual e ao lançamento de um teste completo.
 *
 * Ficam fora dos componentes para que as duas telas escolham o tipo de escore do
 * mesmo jeito — e para que a regra seja testável sem montar Vue.
 */

import { SCORE_TYPES } from './score-types'
import type { ScoreType } from './score-types'

/**
 * Tipos de escore oferecidos para um instrumento.
 *
 * Com faixas cadastradas, só os tipos que as têm — mais o escore bruto, que por
 * definição não tem faixa e continua sempre lançável. Sem faixa nenhuma, todos:
 * o instrumento pode ainda não ter a norma cadastrada, e isso não pode bloquear a
 * digitação. `current` preserva o tipo de um resultado antigo em edição, mesmo
 * que as faixas dele tenham sido removidas depois.
 */
export function availableScoreTypes(
  configured: readonly ScoreType[],
  current?: ScoreType | null
): ScoreType[] {
  if (configured.length === 0) return [...SCORE_TYPES]

  const allowed = new Set<ScoreType>([...configured, 'raw'])
  if (current !== undefined && current !== null) allowed.add(current)
  return SCORE_TYPES.filter((type) => allowed.has(type))
}

/**
 * Tipo de escore a pré-selecionar: o último usado para o instrumento, se ainda
 * estiver disponível; senão o primeiro com faixas; senão o primeiro disponível.
 */
export function defaultScoreType(
  available: readonly ScoreType[],
  configured: readonly ScoreType[],
  remembered?: ScoreType | null
): ScoreType {
  if (remembered !== undefined && remembered !== null && available.includes(remembered)) {
    return remembered
  }
  const firstConfigured = SCORE_TYPES.find((type) => configured.includes(type))
  return firstConfigured ?? available[0] ?? 'percentile'
}

/** Aceita vírgula decimal — é como se digita número em português. */
export function parseDecimalInput(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (normalized === '') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

/** Valor gravado de volta no formato de digitação. */
export function formatDecimalInput(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}
