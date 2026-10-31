/**
 * Divisão em trechos da base de referências: tamanho, sobreposição e página.
 */

import { describe, expect, it } from 'vitest'
import { chunkPages } from '../../src/main/services/knowledge/chunk'

const sentence = (n: number): string => `Frase número ${n} sobre o procedimento de aplicação.`

describe('chunkPages', () => {
  it('mantém texto curto num único trecho, com a página de origem', () => {
    const chunks = chunkPages([{ page: 3, text: 'Primeiro parágrafo.\n\nSegundo parágrafo.' }])
    expect(chunks).toEqual([
      { ordinal: 0, page: 3, text: 'Primeiro parágrafo.\n\nSegundo parágrafo.' }
    ])
  })

  it('respeita o tamanho máximo e repete o fim do trecho anterior no seguinte', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => sentence(i)).join('\n\n')
    const chunks = chunkPages([{ page: 1, text: paragraphs }], { maxChars: 300, overlapChars: 60 })

    expect(chunks.length).toBeGreaterThan(3)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(302)

    for (let i = 1; i < chunks.length; i++) {
      const previousTail = chunks[i - 1]!.text.slice(-30)
      expect(chunks[i]!.text).toContain(previousTail.slice(previousTail.indexOf(' ') + 1))
    }

    // Toda frase do original está em algum trecho.
    for (let i = 0; i < 40; i++) {
      expect(chunks.some((chunk) => chunk.text.includes(sentence(i)))).toBe(true)
    }
  })

  it('não deixa a sobreposição atravessar páginas', () => {
    const chunks = chunkPages([
      { page: 1, text: 'Conteúdo da página um.' },
      { page: 2, text: 'Conteúdo da página dois.' }
    ])
    expect(chunks).toMatchObject([
      { ordinal: 0, page: 1, text: 'Conteúdo da página um.' },
      { ordinal: 1, page: 2, text: 'Conteúdo da página dois.' }
    ])
  })

  it('quebra parágrafo gigante por frase e junta a hifenização de fim de linha', () => {
    const long = Array.from({ length: 30 }, (_, i) => sentence(i)).join(' ')
    const chunks = chunkPages([{ page: null, text: `neuro-\npsicologia. ${long}` }], {
      maxChars: 400,
      overlapChars: 50
    })

    expect(chunks[0]!.text.startsWith('neuropsicologia.')).toBe(true)
    expect(chunks.every((chunk) => chunk.page === null)).toBe(true)
    expect(chunks.every((chunk) => chunk.text.length <= 402)).toBe(true)
  })

  it('ignora páginas vazias', () => {
    expect(chunkPages([{ page: 1, text: '   \n\n ' }])).toEqual([])
  })
})
