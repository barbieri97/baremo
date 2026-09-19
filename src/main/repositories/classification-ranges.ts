/**
 * Faixas de classificação (spec §4.6).
 *
 * O conjunto de faixas de um par `instrumento + tipo de escore` é gravado
 * inteiro, de uma vez: é a única forma de garantir que ele nunca fique em um
 * estado intermediário com lacuna ou sobreposição. A validação roda no processo
 * principal mesmo já tendo rodado na UI — a fronteira IPC não confia no cliente.
 *
 * Há dois olhares sobre as mesmas linhas, e confundi-los é o erro fácil aqui:
 *
 * - as funções PRÓPRIAS (`listRanges`, `listConfiguredScoreTypes`) enxergam só o
 *   que o instrumento cadastrou. São a base da gravação, da exportação do
 *   catálogo e da detecção de "nada mudou" na importação;
 * - as funções RESOLVIDAS (`listResolved*`) aplicam a herança de §4.6 e são o
 *   que a UI e a classificação de resultados consomem.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { classificationRanges, colors, instruments } from '../db/schema'
import type {
  ClassificationRangeDraft,
  ClassificationRangeWithColor,
  RangeOrigin,
  RangeSource,
  ResolvedClassificationRange
} from '@shared/contracts/entities'
import type { ScoreType } from '@shared/domain/score-types'
import { validateRangeSet } from '@shared/domain/ranges'
import type { RangeIssue } from '@shared/domain/ranges'
import {
  indexRangeOwnerNodes,
  resolveRangeOwner,
  resolveRangeOwners
} from '@shared/domain/inheritance'
import type { RangeOwnerNode } from '@shared/domain/inheritance'
import { conflict, notFound } from '../ipc/register'
import { countWhere } from './helpers'

export function listRanges(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType
): ClassificationRangeWithColor[] {
  return selectRangesWithColor(handle)
    .where(
      and(
        eq(classificationRanges.instrumentId, instrumentId),
        eq(classificationRanges.scoreType, scoreType)
      )
    )
    .orderBy(asc(classificationRanges.minValue))
    .all() as ClassificationRangeWithColor[]
}

/**
 * Todas as faixas, de todos os tipos, de um conjunto de instrumentos.
 *
 * Alimenta o lançamento de um teste completo: uma chamada só traz o que a grade
 * inteira precisa para oferecer os tipos de escore e prever a classificação.
 */
export function listRangesForInstruments(
  handle: BaremoDatabase,
  instrumentIds: readonly string[]
): ClassificationRangeWithColor[] {
  if (instrumentIds.length === 0) return []

  return selectRangesWithColor(handle)
    .where(inArray(classificationRanges.instrumentId, [...instrumentIds]))
    .orderBy(asc(classificationRanges.minValue))
    .all() as ClassificationRangeWithColor[]
}

function selectRangesWithColor(handle: BaremoDatabase) {
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
    .$dynamic()
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

// ─── Herança (§4.6) ──────────────────────────────────────────────────────────

/**
 * A árvore de instrumentos reduzida ao que a resolução precisa.
 *
 * Carregar a tabela inteira é aceitável porque ela é pequena por natureza — um
 * catálogo clínico tem dezenas de instrumentos, não milhares — e porque subir a
 * hierarquia em SQL exigiria uma CTE recursiva por chamada.
 */
function ownerNodes(handle: BaremoDatabase): Map<string, RangeOwnerNode> {
  const rows = handle.db
    .select({
      id: instruments.id,
      parentId: instruments.parentId,
      inheritsRanges: instruments.inheritsRanges
    })
    .from(instruments)
    .all()

  return indexRangeOwnerNodes(rows)
}

/** Quem cadastrou as faixas que valem para este instrumento. */
export function rangeOwnerOf(handle: BaremoDatabase, instrumentId: string): string {
  return resolveRangeOwner(ownerNodes(handle), instrumentId)
}

/** A origem das faixas de um instrumento, para a UI declarar de onde elas vêm. */
export function describeRangeOrigin(handle: BaremoDatabase, instrumentId: string): RangeOrigin {
  const nodes = ownerNodes(handle)
  const node = nodes.get(instrumentId)
  if (node === undefined) throw notFound('Instrumento não encontrado.')

  const ownerId = resolveRangeOwner(nodes, instrumentId)
  const owner = handle.db
    .select({ name: instruments.name })
    .from(instruments)
    .where(eq(instruments.id, ownerId))
    .get()

  return {
    ownerId,
    ownerName: owner?.name ?? '',
    inherited: ownerId !== instrumentId,
    canInherit: node.parentId !== null
  }
}

/** Faixas que valem para o instrumento, já resolvida a herança, mais a origem. */
export function listResolvedRanges(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType
): RangeSource {
  const origin = describeRangeOrigin(handle, instrumentId)

  return {
    ...origin,
    ranges: listRanges(handle, origin.ownerId, scoreType).map((range) => ({
      ...range,
      instrumentId,
      ownerInstrumentId: origin.ownerId
    }))
  }
}

/** Tipos de escore que classificam este instrumento — próprios ou herdados. */
export function listResolvedScoreTypes(
  handle: BaremoDatabase,
  instrumentId: string
): ScoreType[] {
  return listConfiguredScoreTypes(handle, rangeOwnerOf(handle, instrumentId))
}

/**
 * Faixas de vários instrumentos com a herança já resolvida.
 *
 * `instrumentId` sai reescrito para o instrumento PEDIDO — é por ele que a grade
 * do teste completo agrupa —, e `ownerInstrumentId` guarda quem cadastrou. O
 * `id` da faixa continua sendo o da linha real: é ele que vai para o snapshot do
 * resultado.
 */
export function listResolvedRangesForInstruments(
  handle: BaremoDatabase,
  instrumentIds: readonly string[]
): ResolvedClassificationRange[] {
  if (instrumentIds.length === 0) return []

  const owners = resolveRangeOwners(ownerNodes(handle), instrumentIds)
  const byOwner = new Map<string, ClassificationRangeWithColor[]>()

  for (const range of listRangesForInstruments(handle, [...new Set(owners.values())])) {
    const bucket = byOwner.get(range.instrumentId)
    if (bucket) bucket.push(range)
    else byOwner.set(range.instrumentId, [range])
  }

  return instrumentIds.flatMap((instrumentId) => {
    const ownerId = owners.get(instrumentId) ?? instrumentId
    return (byOwner.get(ownerId) ?? []).map((range) => ({
      ...range,
      instrumentId,
      ownerInstrumentId: ownerId
    }))
  })
}

/**
 * Materializa no instrumento as faixas que ele vinha herdando.
 *
 * Copia TODOS os conjuntos do dono, e não só o tipo de escore que o usuário
 * está olhando, porque a herança é tudo-ou-nada: personalizar o percentil sem
 * trazer junto o escore-z faria o instrumento perder silenciosamente uma
 * classificação que ele tinha um instante antes.
 */
export function detachRanges(handle: BaremoDatabase, instrumentId: string): RangeOrigin {
  const origin = describeRangeOrigin(handle, instrumentId)
  if (!origin.inherited) return origin

  const inheritedSets = listConfiguredScoreTypes(handle, origin.ownerId).map((scoreType) => ({
    scoreType,
    entries: listRanges(handle, origin.ownerId, scoreType)
  }))

  const apply = handle.raw.transaction(() => {
    for (const set of inheritedSets) {
      handle.db
        .insert(classificationRanges)
        .values(
          set.entries.map((entry) => ({
            id: randomUUID(),
            instrumentId,
            scoreType: set.scoreType,
            classificationName: entry.classificationName,
            minValue: entry.minValue,
            maxValue: entry.maxValue,
            colorId: entry.colorId,
            // A cópia nasce na versão 1: é um conjunto novo, cujo histórico
            // começa agora. A versão do dono é dele, não deste instrumento.
            version: 1,
            level: entry.level,
            inverted: entry.inverted
          }))
        )
        .run()
    }

    claimOwnership(handle, instrumentId)
  })

  apply()
  return describeRangeOrigin(handle, instrumentId)
}

/** Devolve o instrumento à herança, descartando as faixas próprias. */
export function reattachRanges(handle: BaremoDatabase, instrumentId: string): RangeOrigin {
  const origin = describeRangeOrigin(handle, instrumentId)
  if (!origin.canInherit) {
    throw conflict(
      'Este instrumento é a raiz de um teste: não há instrumento pai de quem herdar faixas.'
    )
  }

  const apply = handle.raw.transaction(() => {
    handle.db
      .delete(classificationRanges)
      .where(eq(classificationRanges.instrumentId, instrumentId))
      .run()

    handle.db
      .update(instruments)
      .set({ inheritsRanges: true })
      .where(eq(instruments.id, instrumentId))
      .run()
  })

  apply()
  return describeRangeOrigin(handle, instrumentId)
}

/** Gravar um conjunto é reivindicar a posse dele — o instrumento deixa de herdar. */
function claimOwnership(handle: BaremoDatabase, instrumentId: string): void {
  handle.db
    .update(instruments)
    .set({ inheritsRanges: false })
    .where(eq(instruments.id, instrumentId))
    .run()
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

    // Gravar um conjunto é reivindicar a posse: a partir daqui o instrumento
    // para de acompanhar o ancestral, mesmo que o conjunto tenha ficado vazio.
    // Um conjunto vazio de um instrumento PRÓPRIO é "não classifico"; devolver a
    // herança é uma decisão separada, e tem botão próprio.
    claimOwnership(handle, instrumentId)
  })

  apply()
  return listRanges(handle, instrumentId, scoreType)
}
