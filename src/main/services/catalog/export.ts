/**
 * Exportação do catálogo — instrumentos e faixas de classificação.
 *
 * O pacote leva o suficiente para ser reconstruído em outra instalação e nada
 * além disso: nenhum dado de paciente, avaliação ou documento entra aqui. É a
 * diferença entre este arquivo e a exportação de prontuário (§6.4), que carrega
 * exatamente o oposto.
 *
 * As cores acompanham porque uma faixa sem cor não é reconstituível — a cor é
 * parte da classificação, não decoração. Só as efetivamente referenciadas vão:
 * a paleta inteira do destino não deve mudar por causa de uma importação.
 */

import { asc } from 'drizzle-orm'
import type { BaremoDatabase } from '../../db/gateway'
import { colors } from '../../db/schema'
import { listCognitiveFunctions, listInstruments } from '../../repositories/trees'
import { listConfiguredScoreTypes, listRanges } from '../../repositories/classification-ranges'
import { CATALOG_FILE_SCHEMA } from '@shared/contracts/catalog'
import type { CatalogColor, CatalogFile, CatalogRangeSet } from '@shared/contracts/catalog'
import type { CognitiveFunction } from '@shared/contracts/entities'
import { ancestorPath } from '@shared/domain/tree'

export function buildCatalogFile(handle: BaremoDatabase, appVersion: string): CatalogFile {
  const instrumentRows = listInstruments(handle)
  const functionRows = listCognitiveFunctions(handle)

  const rangeSets: CatalogRangeSet[] = []
  const usedColorIds = new Set<string>()

  for (const instrument of instrumentRows) {
    for (const scoreType of listConfiguredScoreTypes(handle, instrument.id)) {
      const entries = listRanges(handle, instrument.id, scoreType)
      if (entries.length === 0) continue

      for (const entry of entries) usedColorIds.add(entry.colorId)

      rangeSets.push({
        instrumentId: instrument.id,
        scoreType,
        entries: entries.map((entry) => ({
          classificationName: entry.classificationName,
          minValue: entry.minValue,
          maxValue: entry.maxValue,
          colorId: entry.colorId,
          level: entry.level,
          inverted: entry.inverted
        }))
      })
    }
  }

  const palette = handle.db
    .select()
    .from(colors)
    .orderBy(asc(colors.order))
    .all()
    .filter((color) => usedColorIds.has(color.id))
    .map<CatalogColor>((color) => ({ id: color.id, name: color.name, hex: color.hex }))

  return {
    schema: CATALOG_FILE_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion,
    colors: palette,
    instruments: instrumentRows.map((instrument) => ({
      id: instrument.id,
      parentId: instrument.parentId,
      name: instrument.name,
      acronym: instrument.acronym,
      cognitiveFunctionPath:
        instrument.cognitiveFunctionId === null
          ? null
          : namePathOf(functionRows, instrument.cognitiveFunctionId),
      minAgeYears: instrument.minAgeYears,
      maxAgeYears: instrument.maxAgeYears,
      reference: instrument.reference,
      order: instrument.order
    })),
    ranges: rangeSets
  }
}

/**
 * Caminho de nomes da função cognitiva, da raiz até ela.
 *
 * `null` quando o id não resolve — um vínculo apontando para função que não
 * existe mais. Exportar `[]` diria "função sem nome"; `null` diz "sem vínculo",
 * que é o que de fato sobrou.
 */
function namePathOf(
  functionRows: readonly CognitiveFunction[],
  functionId: string
): string[] | null {
  const path = ancestorPath(functionRows, functionId)
  return path.length === 0 ? null : path.map((node) => node.name)
}
