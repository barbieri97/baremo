/**
 * Árvores hierárquicas de profundidade ilimitada — funções cognitivas (§4.3) e
 * instrumentos (§4.4) compartilham a mesma forma e as mesmas regras.
 *
 * A validação contra ciclos é obrigatória: sem ela, arrastar um nó para dentro
 * do próprio ramo deixa o banco com um subgrafo desconectado que some das
 * listagens e reaparece como referência quebrada nos relatórios.
 */

export interface TreeNodeLike {
  readonly id: string
  readonly parentId: string | null
  readonly order: number
}

export interface TreeNode<T extends TreeNodeLike> {
  readonly node: T
  readonly depth: number
  readonly children: TreeNode<T>[]
}

/**
 * Monta a floresta a partir da lista plana, ordenando cada nível por `order` e
 * desempatando por `id` para que a ordem seja estável entre execuções.
 *
 * Nós cujo `parentId` não existe na lista são tratados como raízes: uma lista
 * parcial (um ramo filtrado) continua renderizável.
 */
export function buildTree<T extends TreeNodeLike>(nodes: readonly T[]): TreeNode<T>[] {
  const byId = new Map<string, T>(nodes.map((n) => [n.id, n]))
  const childrenOf = new Map<string | null, T[]>()

  for (const node of nodes) {
    const key = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null
    const siblings = childrenOf.get(key)
    if (siblings) siblings.push(node)
    else childrenOf.set(key, [node])
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  const build = (parentId: string | null, depth: number): TreeNode<T>[] =>
    (childrenOf.get(parentId) ?? []).map((node) => ({
      node,
      depth,
      children: build(node.id, depth + 1)
    }))

  return build(null, 0)
}

/** Percorre a árvore em pré-ordem — a ordem em que as linhas aparecem na UI e no PDF. */
export function flattenTree<T extends TreeNodeLike>(
  tree: readonly TreeNode<T>[]
): { node: T; depth: number }[] {
  const out: { node: T; depth: number }[] = []
  const walk = (branches: readonly TreeNode<T>[]): void => {
    for (const branch of branches) {
      out.push({ node: branch.node, depth: branch.depth })
      walk(branch.children)
    }
  }
  walk(tree)
  return out
}

/** Atalho para `flattenTree(buildTree(nodes))`. */
export function flatten<T extends TreeNodeLike>(nodes: readonly T[]): { node: T; depth: number }[] {
  return flattenTree(buildTree(nodes))
}

/** IDs de todos os descendentes de `rootId`, sem incluir o próprio. */
export function descendantIds<T extends TreeNodeLike>(
  nodes: readonly T[],
  rootId: string
): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const node of nodes) {
    if (node.parentId === null) continue
    const siblings = childrenOf.get(node.parentId)
    if (siblings) siblings.push(node.id)
    else childrenOf.set(node.parentId, [node.id])
  }

  const out: string[] = []
  const seen = new Set<string>([rootId])
  const stack = [...(childrenOf.get(rootId) ?? [])]

  while (stack.length > 0) {
    const id = stack.pop()!
    if (seen.has(id)) continue // defesa: dados já ciclados não travam a travessia
    seen.add(id)
    out.push(id)
    stack.push(...(childrenOf.get(id) ?? []))
  }

  return out
}

/** Caminho da raiz até o nó, inclusive — usado nos cabeçalhos dos relatórios. */
export function ancestorPath<T extends TreeNodeLike>(nodes: readonly T[], id: string): T[] {
  const byId = new Map<string, T>(nodes.map((n) => [n.id, n]))
  const path: T[] = []
  const seen = new Set<string>()

  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId !== null ? byId.get(current.parentId) : undefined
  }

  return path
}

export type ReparentError = 'self_parent' | 'cycle' | 'unknown_node' | 'unknown_parent'

/**
 * Verifica se mover `nodeId` para debaixo de `newParentId` é permitido.
 * Retorna `null` quando o movimento é válido.
 *
 * Um nó não pode ser pai de si mesmo nem descer para dentro do próprio ramo.
 */
export function validateReparent<T extends TreeNodeLike>(
  nodes: readonly T[],
  nodeId: string,
  newParentId: string | null
): ReparentError | null {
  const byId = new Map<string, T>(nodes.map((n) => [n.id, n]))

  if (!byId.has(nodeId)) return 'unknown_node'
  if (newParentId === null) return null
  if (newParentId === nodeId) return 'self_parent'
  if (!byId.has(newParentId)) return 'unknown_parent'

  // Subir a partir do novo pai: se o próprio nó aparecer, o movimento fecharia
  // um ciclo. `seen` protege contra dados já corrompidos travarem o laço.
  const seen = new Set<string>()
  let cursor: string | null = newParentId
  while (cursor !== null && !seen.has(cursor)) {
    if (cursor === nodeId) return 'cycle'
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }

  return null
}

export const REPARENT_ERROR_MESSAGES: Readonly<Record<ReparentError, string>> = {
  self_parent: 'Um item não pode ser pai de si mesmo.',
  cycle: 'Não é possível mover um item para dentro de um dos seus próprios subitens.',
  unknown_node: 'Item não encontrado.',
  unknown_parent: 'Item de destino não encontrado.'
}
