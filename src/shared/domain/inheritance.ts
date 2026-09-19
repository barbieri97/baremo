/**
 * Herança das faixas de classificação entre instrumentos (spec §4.6).
 *
 * Dentro de um mesmo teste, as faixas costumam ser as mesmas para todos os
 * subtestes. Em vez de exigir que cada subteste repita o cadastro do pai, um
 * instrumento marcado como `inheritsRanges` não tem faixas próprias: ele usa as
 * do ancestral mais próximo que NÃO herda. Editar o pai muda todos os filhos que
 * herdam; personalizar um filho para de afetar os irmãos.
 *
 * A herança é do INSTRUMENTO, não do par instrumento+tipo de escore: ou o
 * instrumento herda todos os conjuntos do ancestral, ou tem os seus. Resolver
 * tipo a tipo deixaria um subteste com percentil próprio e escore-z do pai — um
 * estado que ninguém pediu e que é difícil de ler numa tela só.
 *
 * `inheritsRanges = false` sem conjunto nenhum é estado legítimo, e não um
 * sinônimo de "herda": é como um subteste diz "não classifico" mesmo com o pai
 * classificando. Por isso a decisão mora numa coluna, e não na ausência de
 * linhas em `classification_ranges`.
 */

export interface RangeOwnerNode {
  readonly id: string
  readonly parentId: string | null
  readonly inheritsRanges: boolean
}

/**
 * Teto de profundidade da subida.
 *
 * `validateReparent` já impede criar ciclo, então isto nunca deveria disparar —
 * existe para que um banco corrompido à mão devolva uma resposta errada em vez
 * de travar o processo principal num laço infinito.
 */
const MAX_DEPTH = 100

/**
 * Quem cadastrou as faixas que valem para `id`.
 *
 * Sobe enquanto o nó herda e tem pai. Devolve o próprio `id` quando ele não
 * herda, quando é raiz, ou quando o pai declarado não existe.
 */
export function resolveRangeOwner(byId: ReadonlyMap<string, RangeOwnerNode>, id: string): string {
  let current = byId.get(id)
  if (current === undefined) return id

  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!current.inheritsRanges || current.parentId === null) return current.id

    const parent = byId.get(current.parentId)
    if (parent === undefined) return current.id

    current = parent
  }

  return current.id
}

/** O mesmo para vários instrumentos de uma vez — o lançamento de teste completo. */
export function resolveRangeOwners(
  byId: ReadonlyMap<string, RangeOwnerNode>,
  ids: readonly string[]
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const id of ids) owners.set(id, resolveRangeOwner(byId, id))
  return owners
}

/** Indexa a lista de instrumentos no formato que a resolução espera. */
export function indexRangeOwnerNodes(
  nodes: readonly RangeOwnerNode[]
): Map<string, RangeOwnerNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}
