/**
 * Árvores hierárquicas (spec §4.3, §4.4).
 *
 * A validação contra ciclos é o ponto crítico: sem ela, arrastar um nó para
 * dentro do próprio ramo produz um subgrafo desconectado, que some das
 * listagens e reaparece como referência quebrada nos relatórios.
 */

import { describe, expect, it } from 'vitest'
import {
  ancestorPath,
  buildTree,
  descendantIds,
  flatten,
  validateReparent
} from '@shared/domain/tree'

interface Node {
  id: string
  parentId: string | null
  order: number
  name: string
}

function node(id: string, parentId: string | null, order: number): Node {
  return { id, parentId, order, name: id }
}

/**
 *   atencao
 *     ├── sustentada
 *     └── dividida
 *   memoria
 *     └── trabalho
 *           └── visuoespacial
 */
const TREE: Node[] = [
  node('atencao', null, 0),
  node('sustentada', 'atencao', 0),
  node('dividida', 'atencao', 1),
  node('memoria', null, 1),
  node('trabalho', 'memoria', 0),
  node('visuoespacial', 'trabalho', 0)
]

describe('buildTree', () => {
  it('monta a floresta com a profundidade correta', () => {
    const tree = buildTree(TREE)
    expect(tree).toHaveLength(2)
    expect(tree[0]!.node.id).toBe('atencao')
    expect(tree[0]!.children.map((child) => child.node.id)).toEqual(['sustentada', 'dividida'])
    expect(tree[1]!.children[0]!.children[0]!.node.id).toBe('visuoespacial')
    expect(tree[1]!.children[0]!.children[0]!.depth).toBe(2)
  })

  it('ordena irmãos por `order` e desempata por id, para ficar estável', () => {
    const unordered: Node[] = [
      node('b', null, 5),
      node('a', null, 5),
      node('c', null, 1)
    ]
    expect(buildTree(unordered).map((branch) => branch.node.id)).toEqual(['c', 'a', 'b'])
  })

  it('trata como raiz um nó cujo pai não está na lista', () => {
    // Uma lista filtrada (um ramo isolado) continua renderizável.
    const partial: Node[] = [node('trabalho', 'memoria', 0), node('visuoespacial', 'trabalho', 0)]
    const tree = buildTree(partial)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.node.id).toBe('trabalho')
  })
})

describe('flatten', () => {
  it('percorre em pré-ordem — a ordem das linhas na UI e no PDF', () => {
    expect(flatten(TREE).map((entry) => entry.node.id)).toEqual([
      'atencao',
      'sustentada',
      'dividida',
      'memoria',
      'trabalho',
      'visuoespacial'
    ])
  })
})

describe('descendantIds', () => {
  it('devolve todos os descendentes, sem o próprio nó', () => {
    expect(descendantIds(TREE, 'memoria').sort()).toEqual(['trabalho', 'visuoespacial'])
  })

  it('devolve vazio para folha', () => {
    expect(descendantIds(TREE, 'sustentada')).toEqual([])
  })

  it('não trava com dados já ciclados', () => {
    // Defesa: se um ciclo escapou para o banco, a travessia precisa terminar.
    const cyclic: Node[] = [node('a', 'b', 0), node('b', 'a', 0)]
    expect(() => descendantIds(cyclic, 'a')).not.toThrow()
  })
})

describe('ancestorPath', () => {
  it('devolve o caminho da raiz até o nó, inclusive', () => {
    expect(ancestorPath(TREE, 'visuoespacial').map((entry) => entry.id)).toEqual([
      'memoria',
      'trabalho',
      'visuoespacial'
    ])
  })

  it('devolve só o próprio nó quando ele é raiz', () => {
    expect(ancestorPath(TREE, 'atencao').map((entry) => entry.id)).toEqual(['atencao'])
  })
})

describe('validateReparent', () => {
  it('permite mover para a raiz', () => {
    expect(validateReparent(TREE, 'trabalho', null)).toBeNull()
  })

  it('permite mover para outro ramo', () => {
    expect(validateReparent(TREE, 'trabalho', 'atencao')).toBeNull()
  })

  it('recusa o nó como pai de si mesmo', () => {
    expect(validateReparent(TREE, 'memoria', 'memoria')).toBe('self_parent')
  })

  it('recusa mover um nó para dentro do próprio filho', () => {
    expect(validateReparent(TREE, 'memoria', 'trabalho')).toBe('cycle')
  })

  it('recusa mover um nó para dentro de um descendente profundo', () => {
    // O caso que uma checagem só de filho direto deixaria passar.
    expect(validateReparent(TREE, 'memoria', 'visuoespacial')).toBe('cycle')
  })

  it('recusa nó inexistente', () => {
    expect(validateReparent(TREE, 'inexistente', null)).toBe('unknown_node')
  })

  it('recusa pai inexistente', () => {
    expect(validateReparent(TREE, 'memoria', 'inexistente')).toBe('unknown_parent')
  })

  it('termina mesmo com um ciclo já presente nos dados', () => {
    const cyclic: Node[] = [node('a', 'b', 0), node('b', 'a', 0), node('c', null, 0)]
    expect(() => validateReparent(cyclic, 'c', 'a')).not.toThrow()
  })
})
