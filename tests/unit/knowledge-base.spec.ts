/**
 * Base de referências: ingestão, busca híbrida e exclusão, num banco real com
 * a extensão sqlite-vec carregada e um embedder falso. E a garantia de
 * isolamento: o banco do prontuário nunca depende da extensão.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, openKnowledgeDatabase } from '../../src/main/db/gateway'
import type { KnowledgeDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import {
  countReadyKnowledgeDocuments,
  getKnowledgeDocument,
  listKnowledgeDocuments,
  searchKnowledge,
  toFtsQuery
} from '../../src/main/repositories/knowledge'
import { KnowledgeIndexer } from '../../src/main/services/knowledge/ingest'
import { FakeEmbedder, vectorize } from '../fixtures/fake-embedder'

let handle: KnowledgeDatabase
let directory: string
let storage: string
let embedder: FakeEmbedder
let indexer: KnowledgeIndexer

const NORMA = [
  'Resolução sobre elaboração de documentos escritos pelo psicólogo.',
  '',
  'O laudo psicológico deve conter identificação, descrição da demanda, procedimento, análise e conclusão.',
  '',
  'O atestado psicológico certifica uma determinada situação ou estado psicológico.'
].join('\n')

const MANUAL = [
  'Manual de aplicação do teste.',
  '',
  'O subteste Dígitos é interrompido após dois erros consecutivos no mesmo item.',
  '',
  'A pontuação ponderada é obtida pela tabela normativa da faixa etária.'
].join('\n')

function file(name: string, content: string | Buffer): string {
  const path = join(directory, name)
  writeFileSync(path, content)
  return path
}

function search(text: string, limit?: number) {
  return searchKnowledge(handle, {
    embedding: vectorize(text),
    text,
    model: embedder.model,
    maxDistance: embedder.maxDistance,
    ...(limit === undefined ? {} : { limit })
  })
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-knowledge-'))
  storage = join(directory, 'referencias')
  handle = openKnowledgeDatabase(join(directory, 'referencias.db'))
})

beforeEach(async () => {
  embedder = new FakeEmbedder()
  indexer = new KnowledgeIndexer(() => handle, embedder, () => storage)
  for (const document of listKnowledgeDocuments(handle)) await indexer.remove(document.id)
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('KnowledgeIndexer', () => {
  it('importa, indexa em segundo plano e deixa o documento pronto', async () => {
    const result = await indexer.importFiles([file('Resolucao_CFP_06-2019.txt', NORMA)])
    expect(result.rejected).toEqual([])
    expect(result.added[0]).toMatchObject({ title: 'Resolucao CFP 06-2019', status: 'pending' })

    await indexer.idle()

    const document = getKnowledgeDocument(handle, result.added[0]!.id)
    expect(document).toMatchObject({
      status: 'ready',
      chunkCount: 1,
      embeddingModel: 'fake/bag-of-words',
      error: null
    })
    expect(embedder.calls.every((call) => call.kind === 'passage')).toBe(true)
    expect(existsSync(join(storage, `${document.sha256}.txt`))).toBe(true)
    expect(countReadyKnowledgeDocuments(handle)).toBe(1)
  })

  it('recusa o mesmo arquivo duas vezes e tipos fora da lista', async () => {
    await indexer.importFiles([file('norma.txt', NORMA)])
    const again = await indexer.importFiles([file('norma-copia.txt', NORMA)])
    expect(again.added).toEqual([])
    expect(again.rejected[0]?.reason).toContain('já está na base')

    const binary = await indexer.importFiles([file('planilha.txt', Buffer.from([0, 1, 2, 3]))])
    expect(binary.rejected[0]?.reason).toContain('Tipo não aceito')
    await indexer.idle()
  })

  it('marca como falha quando o embedder quebra, e reindexar recupera', async () => {
    const broken = new KnowledgeIndexer(
      () => handle,
      {
        model: embedder.model,
        maxDistance: 1,
        embed: async () => Promise.reject(new Error('sem rede'))
      },
      () => storage
    )
    const { added } = await broken.importFiles([file('manual.md', MANUAL)])
    await broken.idle()
    expect(getKnowledgeDocument(handle, added[0]!.id)).toMatchObject({
      status: 'failed',
      error: 'sem rede'
    })

    indexer.reindex(added[0]!.id)
    await indexer.idle()
    expect(getKnowledgeDocument(handle, added[0]!.id).status).toBe('ready')
  })

  it('exclusão remove trechos, vetores, FTS e o original', async () => {
    const { added } = await indexer.importFiles([file('norma.txt', NORMA)])
    await indexer.idle()
    const document = getKnowledgeDocument(handle, added[0]!.id)

    await indexer.remove(document.id)

    const count = (sql: string): number =>
      (handle.raw.prepare(sql).get() as { n: number }).n
    expect(count('SELECT count(*) AS n FROM knowledge_chunks')).toBe(0)
    expect(count('SELECT count(*) AS n FROM knowledge_vec')).toBe(0)
    expect(count("SELECT count(*) AS n FROM knowledge_fts WHERE knowledge_fts MATCH 'laudo'")).toBe(0)
    expect(readdirSync(storage)).not.toContain(`${document.sha256}.txt`)
  })
})

describe('searchKnowledge', () => {
  beforeEach(async () => {
    await indexer.importFiles([file('norma.txt', NORMA), file('manual.txt', MANUAL)])
    await indexer.idle()
  })

  it('encontra o documento certo e devolve título e trecho', () => {
    const [first] = search('o que o laudo psicológico deve conter')
    expect(first).toMatchObject({ title: 'norma' })
    expect(first!.text).toContain('laudo psicológico deve conter')

    const [manual] = search('quando interromper o subteste Dígitos')
    expect(manual).toMatchObject({ title: 'manual' })
  })

  it('a busca lexical ignora acentos', () => {
    // "digitos" sem acento, num texto com "Dígitos".
    const hits = searchKnowledge(handle, {
      embedding: new Float32Array(384).fill(1 / Math.sqrt(384)),
      text: 'digitos',
      model: embedder.model,
      maxDistance: 0
    })
    expect(hits[0]?.title).toBe('manual')
  })

  it('não devolve trechos vetorizados por outro modelo', () => {
    const hits = searchKnowledge(handle, {
      embedding: vectorize('laudo'),
      text: 'laudo',
      model: 'outro/modelo',
      maxDistance: 2
    })
    expect(hits).toEqual([])
  })

  it('sem palavra em comum nem vizinho próximo, a busca volta vazia', () => {
    expect(search('zzzz qqqq')).toEqual([])
  })

  it('respeita o limite, com teto em 10', () => {
    expect(search('psicológico teste', 1)).toHaveLength(1)
    expect(search('psicológico teste', 50).length).toBeLessThanOrEqual(10)
  })
})

describe('isolamento do prontuário', () => {
  it('o baremo.db não carrega a extensão vetorial nem tem tabelas da base', () => {
    const clinical = openDatabase(join(directory, 'baremo.db'))
    runMigrations(clinical)

    expect(() => clinical.raw.prepare('SELECT vec_version()').get()).toThrow()
    const tables = clinical.raw
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'knowledge%'")
      .all()
    expect(tables).toEqual([])
    clinical.close()
  })

  it('reabrir o banco de referências não reaplica a migration', () => {
    const again = openKnowledgeDatabase(handle.path)
    const [row] = again.raw.pragma('user_version') as [{ user_version: number }]
    expect(row.user_version).toBe(1)
    again.close()
  })
})

describe('toFtsQuery', () => {
  it('neutraliza a sintaxe do FTS5 e descarta palavras curtas', () => {
    expect(toFtsQuery('critério A: "NEAR" (TDAH) -x de 2019')).toBe(
      '"critério" OR "near" OR "tdah" OR "2019"'
    )
    expect(toFtsQuery('a de o')).toBeNull()
  })
})
