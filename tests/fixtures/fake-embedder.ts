/**
 * Embedder falso e determinístico para os testes da base de referências.
 *
 * Saco de palavras com hashing em 384 dimensões, normalizado: textos que
 * compartilham palavras ficam próximos no cosseno. Não tem nada de semântico,
 * mas é o bastante para a busca vetorial ter uma ordem previsível sem baixar o
 * modelo real.
 */

import { EMBEDDING_DIMENSIONS } from '../../src/main/services/knowledge/embedder'
import type { Embedder, EmbeddingKind } from '../../src/main/services/knowledge/embedder'

export class FakeEmbedder implements Embedder {
  readonly calls: { texts: readonly string[]; kind: EmbeddingKind }[] = []

  /** Sem palavra em comum, a distância é 1; qualquer sobreposição passa. */
  readonly maxDistance = 0.95

  constructor(readonly model = 'fake/bag-of-words') {}

  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    this.calls.push({ texts, kind })
    return texts.map(vectorize)
  }
}

export function vectorize(text: string): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS)
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)

  for (const word of words) {
    let hash = 2166136261
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    vector[Math.abs(hash) % EMBEDDING_DIMENSIONS]! += 1
  }

  const norm = Math.hypot(...vector) || 1
  return vector.map((value) => value / norm)
}
