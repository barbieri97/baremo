/**
 * Resolução e gravação da classificação (spec §4.6, §4.8, ADR-004).
 *
 * O ponto central deste módulo é o snapshot: quando um resultado é gravado, a
 * classificação e a cor viram COLUNA no resultado, e não uma referência viva à
 * faixa. Editar depois a tabela de faixas de um instrumento não pode
 * reclassificar retroativamente uma avaliação que já saiu em laudo — é
 * documento com validade técnica.
 *
 * `rangeId` e `rangeVersion` ficam guardados só para rastreabilidade: permitem
 * responder "que faixa gerou esta classificação?" sem que a resposta mude o
 * dado.
 */

import { and, eq, inArray } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { classificationRanges, colors } from '../db/schema'
import { resolveRange } from '@shared/domain/ranges'
import type { RangeLike } from '@shared/domain/ranges'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'

export interface ResolvedRange extends RangeLike {
  readonly colorName: string
}

/** Faixas de um par instrumento + tipo de escore, com a cor já resolvida. */
export function loadRanges(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType
): ResolvedRange[] {
  return handle.db
    .select({
      id: classificationRanges.id,
      classificationName: classificationRanges.classificationName,
      minValue: classificationRanges.minValue,
      maxValue: classificationRanges.maxValue,
      version: classificationRanges.version,
      colorHex: colors.hex,
      colorName: colors.name
    })
    .from(classificationRanges)
    .innerJoin(colors, eq(colors.id, classificationRanges.colorId))
    .where(
      and(
        eq(classificationRanges.instrumentId, instrumentId),
        eq(classificationRanges.scoreType, scoreType)
      )
    )
    .orderBy(classificationRanges.minValue)
    .all()
}

/** Carrega as faixas de vários instrumentos de uma vez — usado no reprocessamento. */
export function loadRangesForInstruments(
  handle: BaremoDatabase,
  instrumentIds: readonly string[]
): Map<string, ResolvedRange[]> {
  const byKey = new Map<string, ResolvedRange[]>()
  if (instrumentIds.length === 0) return byKey

  const rows = handle.db
    .select({
      instrumentId: classificationRanges.instrumentId,
      scoreType: classificationRanges.scoreType,
      id: classificationRanges.id,
      classificationName: classificationRanges.classificationName,
      minValue: classificationRanges.minValue,
      maxValue: classificationRanges.maxValue,
      version: classificationRanges.version,
      colorHex: colors.hex,
      colorName: colors.name
    })
    .from(classificationRanges)
    .innerJoin(colors, eq(colors.id, classificationRanges.colorId))
    .where(inArray(classificationRanges.instrumentId, [...instrumentIds]))
    .all()

  for (const row of rows) {
    const key = rangeKey(row.instrumentId, row.scoreType as ScoreType)
    const bucket = byKey.get(key)
    const value: ResolvedRange = {
      id: row.id,
      classificationName: row.classificationName,
      minValue: row.minValue,
      maxValue: row.maxValue,
      version: row.version,
      colorHex: row.colorHex,
      colorName: row.colorName
    }
    if (bucket) bucket.push(value)
    else byKey.set(key, [value])
  }

  return byKey
}

export function rangeKey(instrumentId: string, scoreType: ScoreType): string {
  return `${instrumentId}::${scoreType}`
}

/** O snapshot que vai para as colunas do resultado. */
export interface ClassificationSnapshot {
  readonly classificationName: string | null
  readonly colorHex: string | null
  readonly rangeId: string | null
  readonly rangeVersion: number | null
}

export const EMPTY_SNAPSHOT: ClassificationSnapshot = {
  classificationName: null,
  colorHex: null,
  rangeId: null,
  rangeVersion: null
}

/**
 * Calcula o snapshot para um valor.
 *
 * Devolve o snapshot vazio quando não há valor, quando o tipo de escore não
 * classifica (escore bruto, §4.5) ou quando nenhuma faixa cobre o valor. Este
 * último caso não é erro: significa que o cadastro de faixas está incompleto, e
 * o resultado fica gravado sem classificação em vez de bloquear a digitação.
 */
export function classify(
  value: number | null,
  scoreType: ScoreType,
  ranges: readonly ResolvedRange[]
): ClassificationSnapshot {
  if (value === null) return EMPTY_SNAPSHOT
  if (!SCORE_TYPE_DOMAINS[scoreType].autoClassify) return EMPTY_SNAPSHOT

  const match = resolveRange(value, ranges, scoreType)
  if (match === null) return EMPTY_SNAPSHOT

  return {
    classificationName: match.classificationName,
    colorHex: match.colorHex,
    rangeId: match.id,
    rangeVersion: match.version
  }
}

/** Atalho que carrega as faixas e classifica em uma chamada. */
export function classifyWithLookup(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType,
  value: number | null
): ClassificationSnapshot {
  if (value === null || !SCORE_TYPE_DOMAINS[scoreType].autoClassify) return EMPTY_SNAPSHOT
  return classify(value, scoreType, loadRanges(handle, instrumentId, scoreType))
}
