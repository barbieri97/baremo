/**
 * Contrato do gerador de embeddings da base de referências.
 *
 * Fica separado da implementação (`utility-embedder.ts`, que sobe um
 * `utilityProcess`) para que o orquestrador, a ingestão e os testes dependam só
 * desta interface. Nos testes de unidade, um embedder falso entra no lugar.
 */

/** Modelo local (ONNX quantizado). Trocar exige reindexar os documentos. */
export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'

/** Dimensão dos vetores do modelo; precisa casar com `float[384]` da migration 5. */
export const EMBEDDING_DIMENSIONS = 384

/**
 * O e5 foi treinado com prefixos: `query:` para a pergunta e `passage:` para o
 * texto indexado. Sem eles, a qualidade da busca cai bastante.
 */
export type EmbeddingKind = 'query' | 'passage'

export interface ModelProgress {
  /** Arquivo do modelo sendo baixado, quando há download em curso. */
  readonly file: string | null
  /** 0–100, ou `null` quando o provedor não informa. */
  readonly percent: number | null
}

/**
 * Distância de cosseno máxima para um trecho contar como relevante pela busca
 * vetorial, no modelo e5-small. O e5 comprime as similaridades numa faixa alta:
 * na calibração com perguntas de neuropsicologia, os trechos certos ficaram
 * entre 0,84 e 0,90 de similaridade, e os sem relação, entre 0,80 e 0,85.
 * Com 0,18 (similaridade ≥ 0,82), sai o que é claramente fora do assunto; o
 * resto quem julga é o modelo, que lê o trecho. A busca lexical não passa por
 * este filtro.
 */
export const EMBEDDING_MAX_DISTANCE = 0.18

export interface Embedder {
  readonly model: string
  /** Acima disto, o vizinho vetorial é descartado (ver `EMBEDDING_MAX_DISTANCE`). */
  readonly maxDistance: number
  embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]>
}

export class EmbedderUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbedderUnavailableError'
  }
}
