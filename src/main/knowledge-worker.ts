/**
 * Processo utilitário de embeddings (entry próprio no electron.vite.config.ts).
 *
 * Roda o transformers.js com onnxruntime-node FORA do processo principal: gerar
 * vetores de um PDF grande ocupa a CPU por segundos, e no main isso congelaria
 * o IPC e, com ele, a janela.
 *
 * O modelo é baixado do Hugging Face na primeira vez e fica em cache na pasta
 * recebida em `BAREMO_MODELS_DIR`. Depois disso, tudo roda offline.
 *
 * Protocolo (parentPort):
 *   ← { id, texts, kind }
 *   → { id, vectors } | { id, error }
 *   → { type: 'progress', file, percent }   durante o download do modelo
 */

import { env, pipeline } from '@huggingface/transformers'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

interface Request {
  readonly id: number
  readonly model: string
  readonly texts: readonly string[]
  readonly kind: 'query' | 'passage'
}

const parentPort = process.parentPort

env.cacheDir = process.env['BAREMO_MODELS_DIR'] ?? env.cacheDir
env.allowLocalModels = false

const extractors = new Map<string, Promise<FeatureExtractionPipeline>>()

function extractorFor(model: string): Promise<FeatureExtractionPipeline> {
  let extractor = extractors.get(model)
  if (extractor === undefined) {
    extractor = pipeline('feature-extraction', model, {
      dtype: 'q8',
      progress_callback: (info: { status: string; file?: string; progress?: number }) => {
        if (info.status === 'progress') {
          parentPort.postMessage({
            type: 'progress',
            file: info.file ?? null,
            percent: typeof info.progress === 'number' ? info.progress : null
          })
        }
      }
    }) as Promise<FeatureExtractionPipeline>
    // Uma falha (rede fora no primeiro download) não pode ficar presa no cache.
    extractor.catch(() => extractors.delete(model))
    extractors.set(model, extractor)
  }
  return extractor
}

// Uma requisição por vez: o onnxruntime já paraleliza internamente, e lotes
// concorrentes só disputariam a mesma CPU.
let queue: Promise<void> = Promise.resolve()

parentPort.on('message', (event: { data: Request }) => {
  const request = event.data
  queue = queue.then(async () => {
    try {
      const extractor = await extractorFor(request.model)
      const prefixed = request.texts.map((text) => `${request.kind}: ${text}`)
      const output = await extractor(prefixed, { pooling: 'mean', normalize: true })
      parentPort.postMessage({ id: request.id, vectors: output.tolist() as number[][] })
    } catch (error) {
      parentPort.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })
})
