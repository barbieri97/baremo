/**
 * Embedder que delega a um `utilityProcess` (ver `src/main/knowledge-worker.ts`).
 *
 * O processo sobe na primeira chamada e fica vivo enquanto o app estiver
 * aberto: carregar o modelo leva alguns segundos, e pagar isso a cada busca do
 * assistente seria perceptível. Se o processo morrer, a próxima chamada sobe
 * outro.
 */

import { utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import workerPath from '../../knowledge-worker?modulePath'
import { modelsDir } from '../../paths'
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_DISTANCE,
  EMBEDDING_MODEL,
  EmbedderUnavailableError
} from './embedder'
import type { Embedder, EmbeddingKind, ModelProgress } from './embedder'

/** Trechos por mensagem: lotes maiores não aceleram e atrasam o progresso. */
const BATCH_SIZE = 16

type WorkerMessage =
  | { id: number; vectors: number[][] }
  | { id: number; error: string }
  | { type: 'progress'; file: string | null; percent: number | null }

interface Pending {
  resolve: (vectors: number[][]) => void
  reject: (error: Error) => void
}

export class UtilityEmbedder implements Embedder {
  readonly model = EMBEDDING_MODEL
  readonly maxDistance = EMBEDDING_MAX_DISTANCE

  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(private readonly onProgress: (progress: ModelProgress) => void = () => {}) {}

  async embed(texts: readonly string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    const vectors: Float32Array[] = []

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = await this.request(texts.slice(start, start + BATCH_SIZE), kind)
      for (const vector of batch) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbedderUnavailableError(
            `O modelo devolveu vetores de ${vector.length} dimensões; a base espera ${EMBEDDING_DIMENSIONS}.`
          )
        }
        vectors.push(Float32Array.from(vector))
      }
    }

    return vectors
  }

  dispose(): void {
    this.child?.kill()
    this.child = null
  }

  private request(texts: readonly string[], kind: EmbeddingKind): Promise<number[][]> {
    const child = this.ensureChild()
    const id = this.nextId++

    return new Promise<number[][]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.postMessage({ id, model: this.model, texts, kind })
    })
  }

  private ensureChild(): UtilityProcess {
    if (this.child !== null) return this.child

    const child = utilityProcess.fork(workerPath, [], {
      serviceName: 'Baremo — embeddings',
      env: { ...process.env, BAREMO_MODELS_DIR: modelsDir() },
      stdio: 'inherit'
    })

    child.on('message', (message: WorkerMessage) => {
      if ('type' in message) {
        this.onProgress({ file: message.file, percent: message.percent })
        return
      }

      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)

      if ('error' in message) pending.reject(new EmbedderUnavailableError(describe(message.error)))
      else pending.resolve(message.vectors)
    })

    child.on('exit', (code) => {
      this.child = null
      for (const pending of this.pending.values()) {
        pending.reject(
          new EmbedderUnavailableError(`O processo de embeddings encerrou (código ${code}).`)
        )
      }
      this.pending.clear()
    })

    this.child = child
    return child
  }
}

/** Falha de download no primeiro uso é o caso comum: diz isso ao usuário. */
function describe(raw: string): string {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)) {
    return 'Não foi possível baixar o modelo de busca (cerca de 130 MB, só na primeira vez). Verifique a conexão e tente de novo.'
  }
  return `Falha no modelo de busca: ${raw}`
}
