/**
 * Diff por bloco das edições sugeridas pela IA (spec §10.6).
 *
 * O comportamento essencial é o de "rejeitar": rejeitar uma mudança precisa
 * significar **nada muda aqui**, e não "some com esse trecho". Se rejeitar uma
 * remoção apagasse o bloco, o profissional perderia texto ao recusar uma
 * proposta — exatamente o oposto do que a recusa quer dizer.
 */

import { describe, expect, it } from 'vitest'
import {
  applyAcceptedChanges,
  blockText,
  countChanges,
  diffBlocks
} from '@shared/domain/block-diff'

function paragraph(text: string): unknown {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function doc(...blocks: unknown[]): unknown {
  return { type: 'doc', content: blocks }
}

describe('blockText', () => {
  it('extrai o texto de um parágrafo', () => {
    expect(blockText(paragraph('Olá mundo'))).toBe('Olá mundo')
  })

  it('representa tokens pela forma que o usuário reconhece', () => {
    const node = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Paciente: ' },
        { type: 'variable', attrs: { token: 'paciente.nome' } }
      ]
    }
    expect(blockText(node)).toBe('Paciente: {{paciente.nome}}')
  })

  it('dá um rótulo aos nós atômicos, que não têm texto', () => {
    // Sem isso, o usuário veria uma linha vazia no diff e não saberia o que está
    // aceitando.
    expect(blockText({ type: 'resultsBlock' })).toBe('[tabela de resultados]')
    expect(blockText({ type: 'chartBlock' })).toBe('[gráfico de perfil]')
    expect(blockText({ type: 'signature' })).toBe('[bloco de assinatura]')
  })
})

describe('diffBlocks', () => {
  it('marca blocos idênticos como keep', () => {
    const same = doc(paragraph('A'), paragraph('B'))
    const changes = diffBlocks(same, doc(paragraph('A'), paragraph('B')))

    expect(changes.every((change) => change.kind === 'keep')).toBe(true)
    expect(countChanges(changes)).toBe(0)
  })

  it('detecta inserção', () => {
    const changes = diffBlocks(doc(paragraph('A')), doc(paragraph('A'), paragraph('B')))
    expect(changes.map((change) => change.kind)).toEqual(['keep', 'insert'])
  })

  it('detecta remoção', () => {
    const changes = diffBlocks(doc(paragraph('A'), paragraph('B')), doc(paragraph('A')))
    expect(changes.map((change) => change.kind)).toEqual(['keep', 'delete'])
  })

  it('une remoção seguida de inserção num único replace', () => {
    // Ler "removeu X, inseriu Y" quando o que houve foi uma reescrita torna a
    // decisão mais difícil do que precisa.
    const changes = diffBlocks(doc(paragraph('texto antigo')), doc(paragraph('texto novo')))

    expect(changes).toHaveLength(1)
    expect(changes[0]!.kind).toBe('replace')
    expect(changes[0]!.before).toBe('texto antigo')
    expect(changes[0]!.after).toBe('texto novo')
  })

  it('ignora diferença apenas de espaço e caixa na comparação', () => {
    const changes = diffBlocks(doc(paragraph('Texto  Igual')), doc(paragraph('texto igual')))
    expect(changes[0]!.kind).toBe('keep')
  })

  it('preserva blocos intactos no meio de uma edição', () => {
    const current = doc(paragraph('intro'), paragraph('meio'), paragraph('fim'))
    const proposed = doc(paragraph('intro'), paragraph('meio reescrito'), paragraph('fim'))

    const changes = diffBlocks(current, proposed)
    expect(changes.map((change) => change.kind)).toEqual(['keep', 'replace', 'keep'])
  })

  it('numera os índices em sequência', () => {
    const changes = diffBlocks(doc(paragraph('A'), paragraph('B')), doc(paragraph('A2')))
    expect(changes.map((change) => change.index)).toEqual([0, 1])
  })

  it('trata documento vazio dos dois lados', () => {
    expect(diffBlocks(null, null)).toEqual([])
    expect(diffBlocks(doc(), doc())).toEqual([])
  })
})

describe('applyAcceptedChanges', () => {
  const current = doc(paragraph('mantido'), paragraph('para reescrever'), paragraph('para remover'))
  const proposed = doc(paragraph('mantido'), paragraph('reescrito'), paragraph('inserido'))
  const changes = diffBlocks(current, proposed)

  it('aplica tudo quando tudo é aceito', () => {
    const all = changes.filter((change) => change.kind !== 'keep').map((change) => change.index)
    const result = applyAcceptedChanges(changes, all)

    expect((result.content as unknown[]).map(blockText)).toEqual([
      'mantido',
      'reescrito',
      'inserido'
    ])
  })

  it('rejeitar TUDO devolve o documento atual, intacto', () => {
    // A propriedade mais importante do módulo: recusar não pode custar texto.
    const result = applyAcceptedChanges(changes, [])

    expect((result.content as unknown[]).map(blockText)).toEqual([
      'mantido',
      'para reescrever',
      'para remover'
    ])
  })

  it('aceita só o bloco escolhido e preserva o resto', () => {
    const replace = changes.find((change) => change.kind === 'replace')!
    const result = applyAcceptedChanges(changes, [replace.index])

    expect((result.content as unknown[]).map(blockText)).toEqual([
      'mantido',
      'reescrito',
      'para remover'
    ])
  })

  it('rejeitar uma remoção mantém o bloco', () => {
    const deletion = diffBlocks(doc(paragraph('A'), paragraph('B')), doc(paragraph('A')))
    const result = applyAcceptedChanges(deletion, [])

    expect((result.content as unknown[]).map(blockText)).toEqual(['A', 'B'])
  })

  it('aceitar uma remoção apaga o bloco', () => {
    const deletion = diffBlocks(doc(paragraph('A'), paragraph('B')), doc(paragraph('A')))
    const target = deletion.find((change) => change.kind === 'delete')!
    const result = applyAcceptedChanges(deletion, [target.index])

    expect((result.content as unknown[]).map(blockText)).toEqual(['A'])
  })

  it('nunca devolve documento sem blocos', () => {
    // Um `doc` vazio quebra o editor ao reabrir.
    const removeAll = diffBlocks(doc(paragraph('único')), doc())
    const result = applyAcceptedChanges(
      removeAll,
      removeAll.map((change) => change.index)
    )

    expect((result.content as unknown[]).length).toBeGreaterThan(0)
  })

  it('preserva o nó original, e não apenas o texto', () => {
    const withToken = {
      type: 'paragraph',
      content: [{ type: 'variable', attrs: { token: 'paciente.nome' } }]
    }
    const changes2 = diffBlocks(doc(withToken), doc(paragraph('nome literal')))
    const result = applyAcceptedChanges(changes2, [])

    // Rejeitado: o token continua sendo um nó `variable`, não virou texto.
    expect(JSON.stringify(result.content)).toContain('"variable"')
  })
})
