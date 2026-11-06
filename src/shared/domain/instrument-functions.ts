/**
 * Funções cognitivas de um instrumento: principal + secundárias, com herança
 * (SPEC `funcoes-cognitivas-multiplas.md`).
 *
 * - F1: cada instrumento tem uma função principal e zero ou mais secundárias,
 *   em ordem definida pelo usuário, sem repetição.
 * - F3: um instrumento SEM principal própria herda a principal e as secundárias
 *   do ancestral mais próximo que tem principal. Com principal própria, nada é
 *   herdado — nem as secundárias do pai.
 * - F4: secundária exige principal.
 *
 * Agrupar e agregar resultados usa SOMENTE a principal (F2); as secundárias são
 * etiqueta informativa.
 */

export interface FunctionOwnerNode {
  readonly id: string
  readonly parentId: string | null
  readonly cognitiveFunctionId: string | null
}

export interface SecondaryFunctionLink {
  readonly instrumentId: string
  readonly cognitiveFunctionId: string
  readonly order: number
}

export interface ResolvedFunctions {
  /** Principal efetiva, já com a herança. `null` quando nenhum ancestral tem. */
  readonly primaryId: string | null
  /** Secundárias efetivas, na ordem cadastrada. */
  readonly secondaryIds: readonly string[]
  /** Id do ancestral de onde veio a principal; `null` quando é própria (ou não há). */
  readonly inheritedFrom: string | null
}

/** Mesmo teto de `resolveRangeOwner`: protege contra banco corrompido à mão. */
const MAX_DEPTH = 100

const NONE: ResolvedFunctions = { primaryId: null, secondaryIds: [], inheritedFrom: null }

/** Agrupa os vínculos secundários por instrumento, já ordenados. */
export function indexSecondaryLinks(
  links: readonly SecondaryFunctionLink[]
): Map<string, string[]> {
  const sorted = [...links].sort((a, b) => a.order - b.order)
  const byInstrument = new Map<string, string[]>()
  for (const link of sorted) {
    const bucket = byInstrument.get(link.instrumentId)
    if (bucket) bucket.push(link.cognitiveFunctionId)
    else byInstrument.set(link.instrumentId, [link.cognitiveFunctionId])
  }
  return byInstrument
}

/**
 * Resolve as funções efetivas de `instrumentId`.
 *
 * Aceita a lista de instrumentos ou um mapa por id, e os vínculos crus ou já
 * indexados — quem resolve muitos instrumentos de uma vez indexa uma vez só.
 */
export function resolveFunctions(
  instrumentId: string,
  instruments: readonly FunctionOwnerNode[] | ReadonlyMap<string, FunctionOwnerNode>,
  secondaryLinks: readonly SecondaryFunctionLink[] | ReadonlyMap<string, readonly string[]>
): ResolvedFunctions {
  const byId: ReadonlyMap<string, FunctionOwnerNode> =
    instruments instanceof Map
      ? instruments
      : new Map((instruments as readonly FunctionOwnerNode[]).map((node) => [node.id, node]))
  const secondaryByInstrument: ReadonlyMap<string, readonly string[]> =
    secondaryLinks instanceof Map
      ? secondaryLinks
      : indexSecondaryLinks(secondaryLinks as readonly SecondaryFunctionLink[])

  let current = byId.get(instrumentId)
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined; depth++) {
    if (current.cognitiveFunctionId !== null) {
      const primaryId = current.cognitiveFunctionId
      return {
        primaryId,
        // F1/F4 já são validadas na escrita; o filtro só protege a leitura de
        // um banco editado à mão.
        secondaryIds: (secondaryByInstrument.get(current.id) ?? []).filter(
          (id, index, all) => id !== primaryId && all.indexOf(id) === index
        ),
        inheritedFrom: current.id === instrumentId ? null : current.id
      }
    }
    if (current.parentId === null) return NONE
    current = byId.get(current.parentId)
  }

  return NONE
}

/** Texto da etiqueta informativa das secundárias, ou `null` sem nenhuma. */
export function alsoAssessesLabel(
  secondary: readonly ({ readonly name: string } | string)[]
): string | null {
  if (secondary.length === 0) return null
  const names = secondary.map((item) => (typeof item === 'string' ? item : item.name))
  return `Também avalia: ${names.join(', ')}`
}

export type FunctionValidationError = 'secondary_without_primary' | 'duplicate'

export const FUNCTION_VALIDATION_MESSAGES: Record<FunctionValidationError, string> = {
  secondary_without_primary:
    'Para cadastrar funções secundárias, escolha antes a função principal.',
  duplicate: 'Uma função secundária não pode repetir a principal nem aparecer duas vezes.'
}

/** Valida F1 (sem repetição) e F4 (secundária exige principal). */
export function validateFunctions(
  primaryId: string | null,
  secondaryIds: readonly string[]
): FunctionValidationError | null {
  if (secondaryIds.length === 0) return null
  if (primaryId === null) return 'secondary_without_primary'
  const seen = new Set<string>([primaryId])
  for (const id of secondaryIds) {
    if (seen.has(id)) return 'duplicate'
    seen.add(id)
  }
  return null
}
