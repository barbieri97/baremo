/**
 * Agrupa resultados de uma avaliação pela árvore a que eles pertencem.
 *
 * A grade da avaliação lê os mesmos resultados de duas maneiras — por função
 * cognitiva e por instrumento —, e as duas árvores têm a mesma forma
 * (`TreeNodeLike`). Uma implementação só serve as duas: o que muda entre elas é
 * a lista de nós e de qual campo do resultado sai a chave.
 *
 * A poda é o ponto central. A árvore mostra o que foi APLICADO, não o catálogo
 * inteiro: um ramo sem nenhum resultado na subárvore não aparece. Mas um nó com
 * filhas que têm resultados aparece mesmo sem ter resultados próprios — é o que
 * faz "Desenvolvimento" voltar a conter "Desenvolvimento cognitivo" em vez de os
 * dois figurarem lado a lado como se não tivessem relação.
 */

import { buildTree } from './tree'
import type { TreeNode, TreeNodeLike } from './tree'

export interface ResultGroup<R> {
  /** `null` apenas no balde dos órfãos. */
  id: string | null
  name: string
  depth: number
  /** Resultados lançados DIRETAMENTE neste nó. */
  rows: R[]
  /** Resultados de toda a subárvore, incluindo os próprios. */
  total: number
  children: ResultGroup<R>[]
}

export interface GroupingOptions<T> {
  /** Nome do grupo final, com o que não caiu em nó nenhum. */
  orphanName: string
  /** Rótulo do nó, quando o nome cru não basta (sigla do instrumento). */
  labelOf?: (node: T) => string
}

export function groupResultsByTree<T extends TreeNodeLike & { name: string }, R>(
  nodes: readonly T[],
  rows: readonly R[],
  keyOf: (row: R) => string | null,
  options: GroupingOptions<T>
): ResultGroup<R>[] {
  const known = new Set(nodes.map((node) => node.id))
  const byNode = new Map<string, R[]>()
  const orphans: R[] = []

  // A ordem das linhas dentro de cada nó é a de entrada: já vem ordenada pelo
  // catálogo na consulta, e reordenar aqui só faria a grade discordar dela.
  for (const row of rows) {
    const key = keyOf(row)
    if (key === null || !known.has(key)) {
      orphans.push(row)
      continue
    }
    const bucket = byNode.get(key)
    if (bucket) bucket.push(row)
    else byNode.set(key, [row])
  }

  const label = options.labelOf ?? ((node: T): string => node.name)

  const prune = (branch: TreeNode<T>): ResultGroup<R> | null => {
    const children = branch.children
      .map(prune)
      .filter((child): child is ResultGroup<R> => child !== null)

    const own = byNode.get(branch.node.id) ?? []
    const total = own.length + children.reduce((sum, child) => sum + child.total, 0)
    if (total === 0) return null

    return {
      id: branch.node.id,
      name: label(branch.node),
      depth: branch.depth,
      rows: own,
      total,
      children
    }
  }

  const groups = buildTree(nodes)
    .map(prune)
    .filter((group): group is ResultGroup<R> => group !== null)

  // Por último, e nunca escondido: um resultado sem função é uma pendência de
  // cadastro, e sumir com ele seria a maneira de ela nunca ser notada.
  if (orphans.length > 0) {
    groups.push({
      id: null,
      name: options.orphanName,
      depth: 0,
      rows: orphans,
      total: orphans.length,
      children: []
    })
  }

  return groups
}
