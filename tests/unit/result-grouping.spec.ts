/**
 * Agrupamento dos resultados pela árvore (spec §4.8).
 *
 * A poda é o que se testa aqui: a grade precisa mostrar o que foi aplicado sem
 * esconder a hierarquia. Um pai sem resultados próprios que desaparecesse
 * levaria as filhas para o nível de cima, que é exatamente o achatamento que
 * esta função existe para desfazer.
 */

import { describe, expect, it } from 'vitest'
import { groupResultsByTree } from '@shared/domain/result-grouping'

interface Node {
  id: string
  parentId: string | null
  order: number
  name: string
  acronym?: string
}

function node(id: string, parentId: string | null, order: number): Node {
  return { id, parentId, order, name: id }
}

/**
 *   desenvolvimento
 *     ├── cognitivo
 *     └── linguagem
 *   atencao
 *     └── sustentada
 *   memoria           (sem resultado nenhum na subárvore)
 */
const NODES: Node[] = [
  node('desenvolvimento', null, 0),
  node('cognitivo', 'desenvolvimento', 0),
  node('linguagem', 'desenvolvimento', 1),
  node('atencao', null, 1),
  node('sustentada', 'atencao', 0),
  node('memoria', null, 2)
]

interface Row {
  id: string
  nodeId: string | null
}

function group(rows: Row[], orphanName = 'Sem função cognitiva associada') {
  return groupResultsByTree(NODES, rows, (row: Row) => row.nodeId, { orphanName })
}

describe('groupResultsByTree', () => {
  it('poda os ramos sem nenhum resultado', () => {
    const groups = group([{ id: 'r1', nodeId: 'atencao' }])

    expect(groups.map((entry) => entry.id)).toEqual(['atencao'])
  })

  it('mantém o pai sem resultados próprios quando uma filha tem', () => {
    const groups = group([
      { id: 'r1', nodeId: 'cognitivo' },
      { id: 'r2', nodeId: 'linguagem' }
    ])

    expect(groups).toHaveLength(1)
    const raiz = groups[0]!
    expect(raiz.id).toBe('desenvolvimento')
    expect(raiz.rows).toEqual([])
    expect(raiz.children.map((child) => child.id)).toEqual(['cognitivo', 'linguagem'])
  })

  it('conta a subárvore em total e só o que é direto em rows', () => {
    const groups = group([
      { id: 'r1', nodeId: 'desenvolvimento' },
      { id: 'r2', nodeId: 'cognitivo' },
      { id: 'r3', nodeId: 'linguagem' }
    ])

    const raiz = groups[0]!
    expect(raiz.total).toBe(3)
    expect(raiz.rows.map((row) => row.id)).toEqual(['r1'])
    expect(raiz.children.map((child) => child.total)).toEqual([1, 1])
  })

  it('preserva a ordem de entrada das linhas dentro do nó', () => {
    const groups = group([
      { id: 'r2', nodeId: 'atencao' },
      { id: 'r1', nodeId: 'atencao' }
    ])

    expect(groups[0]!.rows.map((row) => row.id)).toEqual(['r2', 'r1'])
  })

  it('respeita a ordem do catálogo, e não a dos resultados', () => {
    const groups = group([
      { id: 'r1', nodeId: 'sustentada' },
      { id: 'r2', nodeId: 'linguagem' },
      { id: 'r3', nodeId: 'cognitivo' }
    ])

    expect(groups.map((entry) => entry.id)).toEqual(['desenvolvimento', 'atencao'])
    expect(groups[0]!.children.map((child) => child.id)).toEqual(['cognitivo', 'linguagem'])
  })

  it('leva ao balde final o que não tem nó, e o mantém por último', () => {
    const groups = group([
      { id: 'r1', nodeId: null },
      { id: 'r2', nodeId: 'apagado' },
      { id: 'r3', nodeId: 'atencao' }
    ])

    expect(groups.map((entry) => entry.id)).toEqual(['atencao', null])
    const orfaos = groups[1]!
    expect(orfaos.name).toBe('Sem função cognitiva associada')
    expect(orfaos.rows.map((row) => row.id)).toEqual(['r1', 'r2'])
    expect(orfaos.children).toEqual([])
  })

  it('não cria o balde quando não há órfãos', () => {
    const groups = group([{ id: 'r1', nodeId: 'atencao' }])

    expect(groups.some((entry) => entry.id === null)).toBe(false)
  })

  it('usa labelOf quando o nome cru não basta', () => {
    const comSigla: Node[] = [
      { id: 'bv', parentId: null, order: 0, name: 'Bateria', acronym: 'BV' }
    ]

    const groups = groupResultsByTree(
      comSigla,
      [{ id: 'r1', nodeId: 'bv' }],
      (row: Row) => row.nodeId,
      {
        orphanName: 'Instrumento removido do catálogo',
        labelOf: (entry) => (entry.acronym ? `${entry.name} (${entry.acronym})` : entry.name)
      }
    )

    expect(groups[0]!.name).toBe('Bateria (BV)')
  })

  it('devolve lista vazia quando não há resultado nenhum', () => {
    expect(group([])).toEqual([])
  })
})
