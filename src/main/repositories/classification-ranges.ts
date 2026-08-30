/**
 * Faixas de classificação (spec §4.6).
 *
 * O conjunto de faixas de um par `instrumento + tipo de escore` é gravado
 * inteiro, de uma vez: é a única forma de garantir que ele nunca fique em um
 * estado intermediário com lacuna ou sobreposição. A validação roda no processo
 * principal mesmo já tendo rodado na UI — a fronteira IPC não confia no cliente.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { classificationRanges, colors } from '../db/schema'
import type {
  ClassificationRangeDraft,
  ClassificationRangeWithColor
} from '@shared/contracts/entities'
import type { ScoreType } from '@shared/domain/score-types'
import { validateRangeSet } from '@shared/domain/ranges'
import type { RangeIssue } from '@shared/domain/ranges'
import { conflict } from '../ipc/register'
import { countWhere } from './helpers'

export function listRanges(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType
): ClassificationRangeWithColor[] {
  return handle.db
    .select({
      id: classificationRanges.id,
      instrumentId: classificationRanges.instrumentId,
      scoreType: classificationRanges.scoreType,
      classificationName: classificationRanges.classificationName,
      minValue: classificationRanges.minValue,
      maxValue: classificationRanges.maxValue,
      colorId: classificationRanges.colorId,
      version: classificationRanges.version,
      level: classificationRanges.level,
      inverted: classificationRanges.inverted,
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
    .orderBy(asc(classificationRanges.minValue))
    .all() as ClassificationRangeWithColor[]
}

/** Tipos de escore que já têm faixas para o instrumento — alimenta o seletor da UI. */
export function listConfiguredScoreTypes(
  handle: BaremoDatabase,
  instrumentId: string
): ScoreType[] {
  const rows = handle.db
    .selectDistinct({ scoreType: classificationRanges.scoreType })
    .from(classificationRanges)
    .where(eq(classificationRanges.instrumentId, instrumentId))
    .all()

  return rows.map((row) => row.scoreType as ScoreType)
}

/** Valida um rascunho sem gravar — a UI usa para dar retorno enquanto se digita. */
export function validateDraft(
  scoreType: ScoreType,
  ranges: readonly ClassificationRangeDraft[]
): RangeIssue[] {
  return validateRangeSet(
    ranges.map((range, index) => ({
      id: `draft-${index}`,
      classificationName: range.classificationName,
      minValue: range.minValue,
      maxValue: range.maxValue,
      colorHex: '#000000',
      version: 1,
      level: range.level,
      inverted: range.inverted
    })),
    scoreType
  )
}

/**
 * Substitui o conjunto inteiro.
 *
 * A versão sobe a cada gravação e vai junto no snapshot dos resultados criados
 * daqui em diante (§4.8). Resultados antigos continuam apontando para a versão
 * com que foram classificados: é isso que torna o rastro útil.
 */
export function saveRanges(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType,
  drafts: readonly ClassificationRangeDraft[]
): ClassificationRangeWithColor[] {
  // Um conjunto vazio é a ação legítima "remover as faixas deste instrumento",
  // e não um erro: sem faixas, os resultados passam a ser gravados sem
  // classificação automática — que é o comportamento documentado. Por isso o
  // problema `empty` não bloqueia aqui, do mesmo modo que não bloqueia na UI.
  const issues = validateDraft(scoreType, drafts).filter((issue) => issue.code !== 'empty')
  if (issues.length > 0) {
    throw conflict(
      'O conjunto de faixas está inconsistente. Corrija os problemas apontados antes de salvar.',
      issues
    )
  }

  for (const draft of drafts) {
    if (countWhere(handle, colors, eq(colors.id, draft.colorId)) === 0) {
      throw conflict(`A cor da faixa "${draft.classificationName}" não existe mais na paleta.`)
    }
  }

  const previous = listRanges(handle, instrumentId, scoreType)
  const nextVersion = previous.reduce((max, range) => Math.max(max, range.version), 0) + 1

  const apply = handle.raw.transaction(() => {
    handle.db
      .delete(classificationRanges)
      .where(
        and(
          eq(classificationRanges.instrumentId, instrumentId),
          eq(classificationRanges.scoreType, scoreType)
        )
      )
      .run()

    if (drafts.length > 0) {
      handle.db
        .insert(classificationRanges)
        .values(
          drafts.map((draft) => ({
            id: randomUUID(),
            instrumentId,
            scoreType,
            classificationName: draft.classificationName,
            minValue: draft.minValue,
            maxValue: draft.maxValue,
            colorId: draft.colorId,
            version: nextVersion,
            level: draft.level,
            // A flag vale para o conjunto: gravar o valor da primeira faixa em
            // todas mantém as linhas coerentes entre si, mesmo que a UI deixasse
            // passar um rascunho misto.
            inverted: drafts[0]?.inverted ?? false
          }))
        )
        .run()
    }
  })

  apply()
  return listRanges(handle, instrumentId, scoreType)
}
