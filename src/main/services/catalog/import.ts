/**
 * Importação do catálogo.
 *
 * A operação é DESCRITA antes de ser feita: `planCatalogImport` não escreve nada
 * e devolve exatamente as contagens que `applyCatalogImport` produzirá. É o
 * mesmo padrão da prévia de reprocessamento (ADR-004) e pelo mesmo motivo —
 * importar substitui conjuntos de faixas, e substituir faixa é coisa que o
 * usuário precisa ver antes de aceitar.
 *
 * Três regras que definem o comportamento:
 *
 * **Importar nunca exclui.** Instrumento que existe no destino e não está no
 * arquivo permanece. Conjunto de faixas que não está no arquivo permanece. O
 * arquivo acrescenta e atualiza; quem remove é o usuário, pela tela.
 *
 * **O arquivo é entrada não confiável.** Pode ter sido editado à mão ou vir de
 * outra pessoa. Estrutura, ciclos na árvore, referências internas e a validade
 * de cada conjunto de faixas são checados ANTES de qualquer escrita, e um
 * problema estrutural recusa o arquivo inteiro em vez de importar metade.
 *
 * **Tudo ou nada.** A aplicação inteira roda em uma transação. Uma falha no
 * último conjunto de faixas desfaz também o primeiro instrumento criado.
 */

import { asc, eq, sql } from 'drizzle-orm'
import type { BaremoDatabase } from '../../db/gateway'
import { colors, instruments } from '../../db/schema'
import { conflict, invalid } from '../../ipc/register'
import { listCognitiveFunctions, listInstruments } from '../../repositories/trees'
import {
  listConfiguredScoreTypes,
  listRanges,
  saveRanges
} from '../../repositories/classification-ranges'
import { catalogFileSchema } from '@shared/contracts/catalog'
import type {
  CatalogFile,
  CatalogImportPlan,
  CatalogInstrument,
  CatalogWarning
} from '@shared/contracts/catalog'
import type {
  ClassificationRangeDraft,
  CognitiveFunction,
  Instrument
} from '@shared/contracts/entities'
import { validateRangeSet } from '@shared/domain/ranges'
import { ancestorPath } from '@shared/domain/tree'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'

/**
 * Lê e valida o arquivo. Recusa com mensagem de usuário, não com stack trace:
 * quem escolheu o arquivo errado precisa saber que foi o arquivo, e não o app.
 */
export function parseCatalogFile(raw: string): CatalogFile {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw invalid('Este arquivo não é um catálogo do Baremo: não é um JSON válido.')
  }

  const parsed = catalogFileSchema.safeParse(json)
  if (!parsed.success) {
    throw invalid(
      'Este arquivo não é um catálogo do Baremo válido, ou foi gerado por uma versão incompatível.',
      parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message
      }))
    )
  }

  return parsed.data
}

// ─── Resolução ───────────────────────────────────────────────────────────────

interface ColorCreation {
  readonly id: string
  readonly name: string
  readonly hex: string
  readonly order: number
}

interface InstrumentWrite {
  readonly id: string
  readonly parentId: string | null
  readonly name: string
  readonly acronym: string | null
  readonly cognitiveFunctionId: string | null
  readonly minAgeYears: number | null
  readonly maxAgeYears: number | null
  readonly reference: string | null
  readonly order: number
  /** Profundidade dentro do arquivo — a ordem em que o pai precisa existir. */
  readonly depth: number
}

interface RangeSetWrite {
  readonly instrumentId: string
  readonly scoreType: ScoreType
  readonly drafts: ClassificationRangeDraft[]
  readonly existed: boolean
}

interface Resolution {
  readonly colorsToCreate: ColorCreation[]
  readonly colorsMatched: number
  readonly toCreate: InstrumentWrite[]
  readonly toUpdate: InstrumentWrite[]
  readonly instrumentsUnchanged: number
  readonly rangeSets: RangeSetWrite[]
  readonly rangeSetsUnchanged: number
  readonly warnings: CatalogWarning[]
}

/**
 * Decide tudo o que a importação faria, sem escrever nada.
 *
 * A resolução é recalculada na aplicação em vez de reaproveitada da prévia: o
 * banco pode ter mudado entre uma e outra, e um plano velho aplicaria decisões
 * tomadas sobre um estado que não existe mais.
 */
function resolve(handle: BaremoDatabase, file: CatalogFile): Resolution {
  const warnings = new WarningBag()

  const fileById = new Map(file.instruments.map((node) => [node.id, node]))
  assertNoCycles(file.instruments, fileById)

  const existingInstruments = listInstruments(handle)
  const existingById = new Map(existingInstruments.map((node) => [node.id, node]))

  // ── Cores ──
  const referencedColorIds = new Set(
    file.ranges.flatMap((set) => set.entries.map((entry) => entry.colorId))
  )
  const fileColorById = new Map(file.colors.map((color) => [color.id, color]))

  for (const colorId of referencedColorIds) {
    if (!fileColorById.has(colorId)) {
      throw conflict(
        'O arquivo está inconsistente: uma faixa de classificação aponta para uma cor que não está no próprio arquivo.'
      )
    }
  }

  const palette = handle.db.select().from(colors).orderBy(asc(colors.order)).all()
  const paletteByHex = new Map(palette.map((color) => [color.hex.toUpperCase(), color.id]))
  const highestOrder = handle.db
    .select({ value: sql<number>`coalesce(max("order"), -1)` })
    .from(colors)
    .get()

  const colorIdMap = new Map<string, string>()
  const colorsToCreate: ColorCreation[] = []
  let colorsMatched = 0
  let colorOrder = (highestOrder?.value ?? -1) + 1

  for (const colorId of referencedColorIds) {
    const fileColor = fileColorById.get(colorId)!
    const existing = paletteByHex.get(fileColor.hex.toUpperCase())

    if (existing !== undefined) {
      colorIdMap.set(colorId, existing)
      colorsMatched++
      continue
    }

    // A cor nova entra no fim da paleta com o id do arquivo: a próxima
    // importação do mesmo catálogo já a encontra por hex, e o id preservado
    // mantém as duas instalações falando dos mesmos registros.
    const created: ColorCreation = {
      id: fileColor.id,
      name: fileColor.name,
      hex: fileColor.hex,
      order: colorOrder++
    }
    colorsToCreate.push(created)
    colorIdMap.set(colorId, created.id)
  }

  // ── Funções cognitivas: por nome, nunca por id ──
  const functionRows = listCognitiveFunctions(handle)
  const functionByPath = indexFunctionsByPath(functionRows)

  // ── Instrumentos ──
  const depths = computeDepths(file.instruments, fileById)
  const toCreate: InstrumentWrite[] = []
  const toUpdate: InstrumentWrite[] = []
  let instrumentsUnchanged = 0

  const existingSiblingNames = new Map<string, string>()
  for (const node of existingInstruments) {
    existingSiblingNames.set(siblingKey(node.parentId, node.name), node.id)
  }

  for (const node of file.instruments) {
    const parentId = resolveParent(node, fileById, existingById, warnings)
    const cognitiveFunctionId = resolveFunction(node, functionByPath, warnings)
    const exists = existingById.has(node.id)

    if (!exists) {
      const collision = existingSiblingNames.get(siblingKey(parentId, node.name))
      if (collision !== undefined) {
        warnings.add(
          'duplicate_name',
          `Já existe um instrumento chamado "${node.name}" no mesmo nível. O do arquivo entra ao lado, e não mesclado.`
        )
      }
    }

    const write: InstrumentWrite = {
      id: node.id,
      parentId,
      name: node.name,
      acronym: node.acronym,
      cognitiveFunctionId,
      minAgeYears: node.minAgeYears,
      maxAgeYears: node.maxAgeYears,
      reference: node.reference,
      order: node.order,
      depth: depths.get(node.id) ?? 0
    }

    if (!exists) {
      toCreate.push(write)
      continue
    }

    // Reimportar o mesmo catálogo não deve anunciar "N instrumentos
    // atualizados" quando nada mudou: a contagem seria verdadeira sobre o UPDATE
    // e mentirosa sobre o efeito. Sem diferença, não há escrita nem contagem.
    if (sameAsStored(existingById.get(node.id)!, write)) instrumentsUnchanged++
    else toUpdate.push(write)
  }

  // Pai antes de filho: a FK `instruments.parent_id` é real e recusaria o filho.
  toCreate.sort((a, b) => a.depth - b.depth)

  // ── Conjuntos de faixas ──
  const rangeSets: RangeSetWrite[] = []
  let rangeSetsUnchanged = 0

  for (const set of file.ranges) {
    if (!fileById.has(set.instrumentId) && !existingById.has(set.instrumentId)) {
      throw conflict(
        'O arquivo está inconsistente: há faixas de classificação para um instrumento que não está no próprio arquivo.'
      )
    }

    if (!SCORE_TYPE_DOMAINS[set.scoreType].autoClassify) {
      warnings.add(
        'unclassifiable_score_type',
        'As faixas de escore bruto do arquivo foram ignoradas: esse tipo de escore não recebe classificação automática.'
      )
      continue
    }

    const drafts: ClassificationRangeDraft[] = set.entries.map((entry) => ({
      classificationName: entry.classificationName,
      minValue: entry.minValue,
      maxValue: entry.maxValue,
      colorId: colorIdMap.get(entry.colorId)!,
      level: entry.level ?? null,
      inverted: entry.inverted ?? false
    }))

    const issues = validateRangeSet(
      drafts.map((draft, index) => ({
        id: `arquivo-${index}`,
        classificationName: draft.classificationName,
        minValue: draft.minValue,
        maxValue: draft.maxValue,
        colorHex: '#000000',
        version: 1,
        level: draft.level,
        inverted: draft.inverted
      })),
      set.scoreType
    )

    if (issues.length > 0) {
      const instrumentName =
        fileById.get(set.instrumentId)?.name ??
        existingById.get(set.instrumentId)?.name ??
        set.instrumentId
      throw conflict(
        `O conjunto de faixas de "${instrumentName}" no arquivo está inconsistente e a importação foi cancelada.`,
        issues
      )
    }

    const existedBefore = existingById.has(set.instrumentId)
      ? listConfiguredScoreTypes(handle, set.instrumentId).includes(set.scoreType)
      : false

    if (existedBefore && matchesExisting(handle, set.instrumentId, set.scoreType, drafts)) {
      rangeSetsUnchanged++
      continue
    }

    rangeSets.push({
      instrumentId: set.instrumentId,
      scoreType: set.scoreType,
      drafts,
      existed: existedBefore
    })
  }

  return {
    colorsToCreate,
    colorsMatched,
    toCreate,
    toUpdate,
    instrumentsUnchanged,
    rangeSets,
    rangeSetsUnchanged,
    warnings: warnings.all()
  }
}

export function planCatalogImport(handle: BaremoDatabase, file: CatalogFile): CatalogImportPlan {
  return summarize(file, resolve(handle, file))
}

export function applyCatalogImport(handle: BaremoDatabase, file: CatalogFile): CatalogImportPlan {
  const resolution = resolve(handle, file)

  const apply = handle.raw.transaction(() => {
    if (resolution.colorsToCreate.length > 0) {
      handle.db
        .insert(colors)
        .values(
          resolution.colorsToCreate.map((color) => ({
            id: color.id,
            name: color.name,
            hex: color.hex,
            order: color.order,
            isSeed: false
          }))
        )
        .run()
    }

    for (const node of resolution.toCreate) {
      handle.db.insert(instruments).values(toRow(node)).run()
    }

    for (const node of resolution.toUpdate) {
      handle.db.update(instruments).set(toRow(node)).where(eq(instruments.id, node.id)).run()
    }

    // `saveRanges` é o único caminho de escrita de faixas do app: valida de
    // novo, incrementa a versão e preserva o snapshot dos resultados já
    // lançados (§4.8). Importar não é exceção a isso.
    for (const set of resolution.rangeSets) {
      saveRanges(handle, set.instrumentId, set.scoreType, set.drafts)
    }
  })

  apply()
  return summarize(file, resolution)
}

// ─── Apoio ───────────────────────────────────────────────────────────────────

function summarize(file: CatalogFile, resolution: Resolution): CatalogImportPlan {
  return {
    exportedAt: file.exportedAt,
    appVersion: file.appVersion,
    instruments: {
      created: resolution.toCreate.length,
      updated: resolution.toUpdate.length,
      unchanged: resolution.instrumentsUnchanged
    },
    rangeSets: {
      created: resolution.rangeSets.filter((set) => !set.existed).length,
      updated: resolution.rangeSets.filter((set) => set.existed).length,
      unchanged: resolution.rangeSetsUnchanged
    },
    colors: {
      created: resolution.colorsToCreate.length,
      matched: resolution.colorsMatched
    },
    warnings: resolution.warnings
  }
}

/** O instrumento do arquivo é, campo a campo, o que já está gravado? */
function sameAsStored(stored: Instrument, incoming: InstrumentWrite): boolean {
  return (
    stored.parentId === incoming.parentId &&
    stored.name === incoming.name &&
    stored.acronym === incoming.acronym &&
    stored.cognitiveFunctionId === incoming.cognitiveFunctionId &&
    stored.minAgeYears === incoming.minAgeYears &&
    stored.maxAgeYears === incoming.maxAgeYears &&
    stored.reference === incoming.reference &&
    stored.order === incoming.order
  )
}

function toRow(node: InstrumentWrite): typeof instruments.$inferInsert {
  return {
    id: node.id,
    parentId: node.parentId,
    name: node.name,
    acronym: node.acronym,
    cognitiveFunctionId: node.cognitiveFunctionId,
    minAgeYears: node.minAgeYears,
    maxAgeYears: node.maxAgeYears,
    reference: node.reference,
    order: node.order
  }
}

/**
 * Um arquivo com ciclo na árvore de instrumentos é recusado inteiro.
 *
 * Não é caso hipotético de arquivo hostil: basta uma edição manual desatenta. E
 * um ciclo gravado no banco quebra toda travessia de árvore do app, incluindo a
 * montagem do caminho do instrumento no relatório.
 */
function assertNoCycles(
  nodes: readonly CatalogInstrument[],
  byId: ReadonlyMap<string, CatalogInstrument>
): void {
  for (const node of nodes) {
    const seen = new Set<string>([node.id])
    let cursor = node.parentId

    while (cursor !== null) {
      if (seen.has(cursor)) {
        throw conflict(
          `O arquivo tem uma hierarquia circular de instrumentos em "${node.name}" e não pode ser importado.`
        )
      }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
  }
}

/** Profundidade dentro do arquivo — usada só para inserir pai antes de filho. */
function computeDepths(
  nodes: readonly CatalogInstrument[],
  byId: ReadonlyMap<string, CatalogInstrument>
): Map<string, number> {
  const depths = new Map<string, number>()

  for (const node of nodes) {
    let depth = 0
    let cursor = node.parentId
    const seen = new Set<string>([node.id])

    while (cursor !== null && byId.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor)
      depth++
      cursor = byId.get(cursor)!.parentId
    }

    depths.set(node.id, depth)
  }

  return depths
}

function resolveParent(
  node: CatalogInstrument,
  fileById: ReadonlyMap<string, CatalogInstrument>,
  existingById: ReadonlyMap<string, { id: string }>,
  warnings: WarningBag
): string | null {
  if (node.parentId === null) return null
  if (fileById.has(node.parentId) || existingById.has(node.parentId)) return node.parentId

  warnings.add(
    'orphan_parent',
    `"${node.name}" apontava para um instrumento pai que não existe no arquivo nem neste computador, e entrou na raiz.`
  )
  return null
}

function resolveFunction(
  node: CatalogInstrument,
  functionByPath: ReadonlyMap<string, string>,
  warnings: WarningBag
): string | null {
  if (node.cognitiveFunctionPath === null) return null

  const resolved = functionByPath.get(pathKey(node.cognitiveFunctionPath))
  if (resolved !== undefined) return resolved

  warnings.add(
    'unknown_cognitive_function',
    `A função cognitiva "${node.cognitiveFunctionPath.join(' / ')}" não existe neste computador. "${node.name}" foi importado sem vínculo — crie a função e refaça o vínculo pela tela.`
  )
  return null
}

function indexFunctionsByPath(rows: readonly CognitiveFunction[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const row of rows) {
    const path = ancestorPath(rows, row.id).map((node) => node.name)
    if (path.length > 0) index.set(pathKey(path), row.id)
  }
  return index
}

/** Caixa e espaço não distinguem funções cognitivas; acento sim. */
function pathKey(path: readonly string[]): string {
  return path.map(normalizeName).join(' / ')
}

function siblingKey(parentId: string | null, name: string): string {
  return `${parentId ?? ''} ${normalizeName(name)}`
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

/**
 * O conjunto do arquivo é igual ao que já está gravado?
 *
 * Serve para não incrementar a versão das faixas à toa: a versão é o que liga um
 * resultado já lançado ao conjunto com que foi classificado (§4.8), e subi-la
 * sem mudança nenhuma esvazia esse rastro.
 */
function matchesExisting(
  handle: BaremoDatabase,
  instrumentId: string,
  scoreType: ScoreType,
  drafts: readonly ClassificationRangeDraft[]
): boolean {
  const current = listRanges(handle, instrumentId, scoreType)
  if (current.length !== drafts.length) return false

  const byMin = <T extends { minValue: number }>(rows: readonly T[]): T[] =>
    [...rows].sort((a, b) => a.minValue - b.minValue)

  const sortedCurrent = byMin(current)
  const sortedDrafts = byMin(drafts)

  return sortedCurrent.every((row, index) => {
    const draft = sortedDrafts[index]!
    return (
      row.classificationName === draft.classificationName &&
      row.minValue === draft.minValue &&
      row.maxValue === draft.maxValue &&
      row.colorId === draft.colorId
    )
  })
}

/** Junta avisos sem repetir a mesma mensagem, e com teto para não virar parede. */
class WarningBag {
  private readonly seen = new Map<string, CatalogWarning>()

  add(code: CatalogWarning['code'], message: string): void {
    const key = `${code} ${message}`
    if (this.seen.has(key) || this.seen.size >= 50) return
    this.seen.set(key, { code, message })
  }

  all(): CatalogWarning[] {
    return [...this.seen.values()]
  }
}
