/**
 * Loop do orquestrador com um Gemini falso — o que o histórico de tools do chat
 * depende de receber (spec §10.4).
 *
 *  - `tool_start` e `tool_end` da mesma chamada carregam o mesmo `callId`;
 *  - a chamada é gravada com esse id e presa à mensagem do usuário do turno;
 *  - uma escrita recusada fica registrada como `rejected`, não como sucesso.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type * as GenAi from '@google/genai'
import type { Content } from '@google/genai'

const responses: unknown[] = []
/** O que o orquestrador mandou ao modelo em cada chamada. */
const requests: {
  contents: Content[]
  config: { systemInstruction: string }
  toolNames: string[]
}[] = []

vi.mock('../../src/main/ai/key-store', () => ({ loadKey: () => 'chave-de-teste' }))

vi.mock('@google/genai', async (importOriginal) => {
  const original = await importOriginal<typeof GenAi>()
  return {
    ...original,
    GoogleGenAI: class {
      models = {
        generateContent: async (request: {
          contents: Content[]
          config: {
            systemInstruction: string
            tools?: { functionDeclarations?: { name?: string }[] }[]
          }
        }): Promise<unknown> => {
          // Cópia profunda: o orquestrador continua mexendo em `contents` depois.
          requests.push(
            structuredClone({
              contents: request.contents,
              config: { systemInstruction: request.config.systemInstruction },
              toolNames: (request.config.tools?.[0]?.functionDeclarations ?? []).map(
                (declaration) => declaration.name ?? ''
              )
            })
          )
          const next = responses.shift()
          if (next === undefined) throw new Error('Nenhuma resposta falsa restante.')
          return next
        }
      }
    }
  }
})

const { openDatabase } = await import('../../src/main/db/gateway')
const { runMigrations } = await import('../../src/main/db/migrate')
const { aiMessages, aiSessions, aiSkills, aiToolCalls, patients } =
  await import('../../src/main/db/schema')
const { listSkills, saveSkill, setSkillEnabled } =
  await import('../../src/main/repositories/ai-skills')
const { applySkillCreation, previewSkillCreation } =
  await import('../../src/main/services/ai-skill-write')
const { getAiConfig, updateAiConfig } = await import('../../src/main/repositories/ai-config')
const { AgentOrchestrator, parseSkillCommand } = await import('../../src/main/ai/orchestrator')
const { KnowledgeIndexer } = await import('../../src/main/services/knowledge/ingest')
const { listKnowledgeDocuments } = await import('../../src/main/repositories/knowledge')
const { openKnowledgeDatabase } = await import('../../src/main/db/gateway')
const { FakeEmbedder } = await import('../fixtures/fake-embedder')

type Handle = ReturnType<typeof openDatabase>
type StreamEvent = Parameters<ConstructorParameters<typeof AgentOrchestrator>[1]>[0]

let handle: Handle
let directory: string
let sessionId: string

function callResponse(name: string, args: Record<string, unknown>): unknown {
  return {
    functionCalls: [{ name, args }],
    candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }]
  }
}

function textResponse(text: string): unknown {
  return {
    text,
    functionCalls: [],
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }]
  }
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-orchestrator-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
  getAiConfig(handle) // cria a linha singleton que o update altera
  updateAiConfig(handle, { enabled: true })

  const patientId = randomUUID()
  handle.db
    .insert(patients)
    .values({
      id: patientId,
      fullName: 'Ana Alves',
      birthDate: '1990-01-01',
      sex: 'unspecified',
      education: null,
      handedness: 'right',
      guardian: null,
      contact: null,
      notes: null,
      createdAt: new Date().toISOString(),
      archivedAt: null
    })
    .run()

  sessionId = randomUUID()
  const now = new Date().toISOString()
  handle.db
    .insert(aiSessions)
    .values({
      id: sessionId,
      patientId,
      title: 'Teste',
      model: 'gemini-flash-latest',
      createdAt: now,
      updatedAt: now
    })
    .run()
})

beforeEach(() => {
  responses.length = 0
  requests.length = 0
  handle.db.delete(aiSkills).run()
  handle.db.delete(aiToolCalls).run()
  handle.db.delete(aiMessages).run()
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('AgentOrchestrator — histórico de tools', () => {
  it('pareia início e fim por callId e prende a chamada à pergunta do turno', async () => {
    const events: StreamEvent[] = []
    const orchestrator = new AgentOrchestrator(handle, (event) => events.push(event), {
      prepare: () => ({ description: '', blockDiff: null }),
      apply: async () => ''
    })

    responses.push(callResponse('listar_avaliacoes', {}), textResponse('Nenhuma avaliação.'))
    await orchestrator.send({ sessionId, text: 'Quais avaliações?', requestId: 'r1' })

    const start = events.find((event) => event.kind === 'tool_start')
    const end = events.find((event) => event.kind === 'tool_end')
    const callId = start?.kind === 'tool_start' ? start.callId : ''
    expect(callId).not.toBe('')
    expect(end).toMatchObject({ callId, ok: true, rejected: false })
    expect(events.at(-1)?.kind).toBe('done')

    const userMessage = handle.db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.role, 'user'))
      .get()
    const recorded = handle.db.select().from(aiToolCalls).all()

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      id: callId,
      messageId: userMessage?.id,
      toolName: 'listar_avaliacoes',
      status: 'executed'
    })
  })

  it('registra a escrita recusada como rejected, com a tabela de resultados no pedido', async () => {
    const events: StreamEvent[] = []
    const apply = vi.fn(async () => 'gravado')

    const orchestrator = new AgentOrchestrator(
      handle,
      (event) => {
        events.push(event)
        // O profissional recusa assim que o diálogo aparece.
        if (event.kind === 'confirmation_required') {
          queueMicrotask(() => orchestrator.confirm(event.confirmationId, false, null))
        }
      },
      {
        prepare: () => ({
          description: 'Registrar 1 resultado.',
          blockDiff: null,
          resultPreview: [
            {
              index: 0,
              instrumentId: null,
              instrumentName: 'Dígitos',
              scoreType: 'Ponderado',
              value: 10,
              classificationName: 'Média',
              colorHex: '#2B6CB0',
              status: 'new',
              existingValue: null,
              existingClassification: null,
              error: null,
              warning: null
            }
          ]
        }),
        apply
      }
    )

    responses.push(
      callResponse('registrar_resultados', { avaliacaoId: randomUUID(), resultados: [] }),
      textResponse('Entendido, nada foi gravado.')
    )
    await orchestrator.send({ sessionId, text: 'Importe o PDF.', requestId: 'r2' })

    const confirmation = events.find((event) => event.kind === 'confirmation_required')
    expect(
      confirmation?.kind === 'confirmation_required' ? confirmation.resultPreview : null
    ).toHaveLength(1)
    expect(events.find((event) => event.kind === 'tool_end')).toMatchObject({
      ok: true,
      rejected: true
    })
    expect(apply).not.toHaveBeenCalled()
    expect(handle.db.select().from(aiToolCalls).get()?.status).toBe('rejected')
  })
})

/** Orquestrador que recusa (ou aprova) toda escrita assim que o diálogo aparece. */
function orchestratorWith(
  events: StreamEvent[],
  approve: boolean,
  writes: ConstructorParameters<typeof AgentOrchestrator>[2] = {
    prepare: () => ({ description: '', blockDiff: null }),
    apply: async () => ''
  }
): InstanceType<typeof AgentOrchestrator> {
  const orchestrator = new AgentOrchestrator(
    handle,
    (event) => {
      events.push(event)
      if (event.kind === 'confirmation_required') {
        queueMicrotask(() => orchestrator.confirm(event.confirmationId, approve, null))
      }
    },
    writes
  )
  return orchestrator
}

/** prepare/apply reais de `criar_skill`, como os handlers de IPC os montam. */
const skillWrites: ConstructorParameters<typeof AgentOrchestrator>[2] = {
  prepare: (_patientId, _toolName, args) => {
    const preview = previewSkillCreation(handle, args)
    return { description: preview.description, blockDiff: null, skillPreview: preview.skill }
  },
  apply: async (_patientId, _toolName, args) => applySkillCreation(handle, args)
}

function functionResponseText(request: (typeof requests)[number]): string {
  const last = request.contents.at(-1)
  return JSON.stringify(last?.parts?.map((part) => part.functionResponse) ?? [])
}

describe('AgentOrchestrator — skills', () => {
  it('lista só as skills ativas na instrução de sistema, sem o conteúdo', async () => {
    saveSkill(
      handle,
      { name: 'devolutiva', description: 'Redigir devolutiva.', content: 'SEGREDO-ATIVA' },
      'user'
    )
    const off = saveSkill(
      handle,
      { name: 'desligada', description: 'Não deve aparecer.', content: 'SEGREDO-INATIVA' },
      'user'
    )
    setSkillEnabled(handle, off.id, false)

    responses.push(textResponse('Ok.'))
    await orchestratorWith([], false).send({ sessionId, text: 'Oi', requestId: 's1' })

    const instruction = requests[0]!.config.systemInstruction
    expect(instruction).toContain('## Skills')
    expect(instruction).toContain('- devolutiva: Redigir devolutiva.')
    expect(instruction).not.toContain('desligada')
    expect(instruction).not.toContain('SEGREDO')
  })

  it('omite a seção de skills quando não há nenhuma ativa', async () => {
    responses.push(textResponse('Ok.'))
    await orchestratorWith([], false).send({ sessionId, text: 'Oi', requestId: 's2' })
    expect(requests[0]!.config.systemInstruction).not.toContain('## Skills')
  })

  it('ler_skill devolve o conteúdo no envelope <skill>, não em <dados_do_prontuario>', async () => {
    saveSkill(
      handle,
      { name: 'devolutiva', description: 'Redigir devolutiva.', content: 'Use o formato X.' },
      'user'
    )
    const events: StreamEvent[] = []

    responses.push(callResponse('ler_skill', { nome: 'devolutiva' }), textResponse('Feito.'))
    await orchestratorWith(events, false).send({ sessionId, text: 'Devolutiva', requestId: 's3' })

    const sent = functionResponseText(requests[1]!)
    expect(sent).toContain('<skill nome=\\"devolutiva\\">')
    expect(sent).toContain('Use o formato X.')
    expect(sent).not.toContain('dados_do_prontuario')
    expect(events.find((event) => event.kind === 'tool_end')).toMatchObject({ ok: true })
    expect(handle.db.select().from(aiToolCalls).get()?.toolName).toBe('ler_skill')
  })

  it('skill desativada não é lida', async () => {
    const skill = saveSkill(
      handle,
      { name: 'devolutiva', description: 'Redigir devolutiva.', content: 'SEGREDO' },
      'user'
    )
    setSkillEnabled(handle, skill.id, false)
    const events: StreamEvent[] = []

    responses.push(callResponse('ler_skill', { nome: 'devolutiva' }), textResponse('Ok.'))
    await orchestratorWith(events, false).send({ sessionId, text: 'x', requestId: 's4' })

    expect(events.find((event) => event.kind === 'tool_end')).toMatchObject({ ok: false })
    expect(functionResponseText(requests[1]!)).not.toContain('SEGREDO')
  })

  it('/nome injeta o conteúdo no turno e grava a mensagem como foi digitada', async () => {
    saveSkill(
      handle,
      { name: 'devolutiva', description: 'Redigir devolutiva.', content: 'Use o formato X.' },
      'user'
    )

    responses.push(textResponse('Ok.'))
    await orchestratorWith([], false).send({
      sessionId,
      text: '/devolutiva para a escola',
      requestId: 's5'
    })

    const turn = requests[0]!.contents.at(-1)!
    expect(turn.role).toBe('user')
    expect(turn.parts?.[0]?.text).toBe('<skill nome="devolutiva">\nUse o formato X.\n</skill>')
    expect(turn.parts?.at(-1)?.text).toBe('/devolutiva para a escola')

    const stored = handle.db.select().from(aiMessages).where(eq(aiMessages.role, 'user')).get()
    expect(stored?.text).toBe('/devolutiva para a escola')
  })

  it('/comando desconhecido segue como texto normal', async () => {
    responses.push(textResponse('Ok.'))
    await orchestratorWith([], false).send({ sessionId, text: '/xyz oi', requestId: 's6' })

    const turn = requests[0]!.contents.at(-1)!
    expect(turn.parts).toHaveLength(1)
    expect(turn.parts?.[0]?.text).toBe('/xyz oi')
  })

  it('reconhece só o formato de comando no início da mensagem', () => {
    expect(parseSkillCommand('/devolutiva')).toBe('devolutiva')
    expect(parseSkillCommand('/devolutiva-escolar texto')).toBe('devolutiva-escolar')
    expect(parseSkillCommand('texto /devolutiva')).toBeNull()
    expect(parseSkillCommand('/Devolutiva')).toBeNull()
    expect(parseSkillCommand('/devolutiva/x')).toBeNull()
  })

  it('criar_skill não grava nada sem confirmação', async () => {
    const events: StreamEvent[] = []

    responses.push(
      callResponse('criar_skill', {
        nome: 'resumo',
        descricao: 'Resumir anamnese.',
        conteudo: 'Roteiro.'
      }),
      textResponse('Entendido.')
    )
    await orchestratorWith(events, false, skillWrites).send({
      sessionId,
      text: 'Salve isso como uma skill',
      requestId: 's7'
    })

    const confirmation = events.find((event) => event.kind === 'confirmation_required')
    expect(confirmation).toMatchObject({
      skillPreview: { name: 'resumo', description: 'Resumir anamnese.', content: 'Roteiro.' }
    })
    expect(events.find((event) => event.kind === 'tool_end')).toMatchObject({ rejected: true })
    expect(listSkills(handle)).toHaveLength(0)
  })

  it('criar_skill aprovada grava com origin = agent', async () => {
    responses.push(
      callResponse('criar_skill', {
        nome: 'resumo',
        descricao: 'Resumir anamnese.',
        conteudo: 'Roteiro.'
      }),
      textResponse('Criada.')
    )
    await orchestratorWith([], true, skillWrites).send({
      sessionId,
      text: 'Salve isso como uma skill',
      requestId: 's8'
    })

    expect(listSkills(handle)).toMatchObject([
      { name: 'resumo', origin: 'agent', enabled: true, content: 'Roteiro.' }
    ])
  })

  it('criar_skill inválida volta ao modelo como erro, sem abrir diálogo', async () => {
    const events: StreamEvent[] = []

    responses.push(
      callResponse('criar_skill', { nome: 'Nome Inválido', descricao: '', conteudo: 'x' }),
      textResponse('Ok.')
    )
    await orchestratorWith(events, true, skillWrites).send({
      sessionId,
      text: 'Salve isso como uma skill',
      requestId: 's9'
    })

    expect(events.some((event) => event.kind === 'confirmation_required')).toBe(false)
    expect(events.find((event) => event.kind === 'tool_end')).toMatchObject({ ok: false })
    expect(listSkills(handle)).toHaveLength(0)
  })
})

describe('AgentOrchestrator — base de referências', () => {
  const writes: ConstructorParameters<typeof AgentOrchestrator>[2] = {
    prepare: () => ({ description: '', blockDiff: null }),
    apply: async () => ''
  }

  let knowledge: ReturnType<typeof openKnowledgeDatabase>

  beforeAll(() => {
    knowledge = openKnowledgeDatabase(join(directory, 'referencias.db'))
  })

  afterAll(() => knowledge.close())

  const base = (embedder: InstanceType<typeof FakeEmbedder>) => ({
    embedder,
    database: () => knowledge
  })

  async function withDocument(embedder: InstanceType<typeof FakeEmbedder>): Promise<void> {
    const indexer = new KnowledgeIndexer(() => knowledge, embedder, () => join(directory, 'refs'))
    const path = join(directory, 'Manual_WISC.txt')
    writeFileSync(
      path,
      'O subteste Dígitos é interrompido após dois erros consecutivos no mesmo item.'
    )
    await indexer.importFiles([path])
    await indexer.idle()
  }

  afterEach(async () => {
    const indexer = new KnowledgeIndexer(
      () => knowledge,
      new FakeEmbedder(),
      () => join(directory, 'refs')
    )
    for (const document of listKnowledgeDocuments(knowledge)) await indexer.remove(document.id)
  })

  it('sem documento pronto, não oferece a tool nem a seção do prompt', async () => {
    responses.push(textResponse('Ok.'))
    await new AgentOrchestrator(handle, () => {}, writes, base(new FakeEmbedder())).send({
      sessionId,
      text: 'Oi',
      requestId: 'k1'
    })

    expect(requests[0]!.toolNames).not.toContain('buscar_referencias')
    expect(requests[0]!.config.systemInstruction).not.toContain('## Base de referências')
  })

  it('com documento pronto, manda dar preferência à base para confirmar informações', async () => {
    const embedder = new FakeEmbedder()
    await withDocument(embedder)

    responses.push(textResponse('Ok.'))
    await new AgentOrchestrator(handle, () => {}, writes, base(embedder)).send({
      sessionId,
      text: 'Oi',
      requestId: 'k2'
    })

    const instruction = requests[0]!.config.systemInstruction
    expect(requests[0]!.toolNames).toContain('buscar_referencias')
    expect(instruction).toContain('## Base de referências')
    expect(instruction).toContain('1 documento(s)')
    expect(instruction).toContain('Dê preferência ao que a base de referências retornar')
    expect(instruction).toContain('[Título, p. X]')
    expect(instruction).toContain('não confirmou a informação')
  })

  it('buscar_referencias vetoriza a pergunta como query e devolve os trechos no envelope próprio', async () => {
    const embedder = new FakeEmbedder()
    await withDocument(embedder)
    const events: StreamEvent[] = []

    responses.push(
      callResponse('buscar_referencias', { consulta: 'quando interromper o subteste Dígitos' }),
      textResponse('Após dois erros consecutivos [Manual WISC].')
    )
    await new AgentOrchestrator(handle, (event) => events.push(event), writes, base(embedder)).send({
      sessionId,
      text: 'Quando interrompo Dígitos?',
      requestId: 'k3'
    })

    const sent = functionResponseText(requests[1]!)
    expect(sent).toContain('<referencias_tecnicas>')
    expect(sent).toContain('Manual WISC')
    expect(sent).toContain('dois erros consecutivos')
    expect(sent).not.toContain('dados_do_prontuario')
    expect(embedder.calls.at(-1)).toMatchObject({ kind: 'query' })
    expect(events.find((event) => event.kind === 'tool_end')).toMatchObject({
      ok: true,
      summary: '1 trecho(s) encontrado(s) em 1 documento(s).'
    })
  })

  it('base indisponível (extensão não carregou) só desliga a busca; o turno segue', async () => {
    const events: StreamEvent[] = []
    responses.push(textResponse('Ok.'))
    await new AgentOrchestrator(handle, (event) => events.push(event), writes, {
      embedder: new FakeEmbedder(),
      database: () => null
    }).send({ sessionId, text: 'Oi', requestId: 'k5' })

    expect(requests[0]!.toolNames).not.toContain('buscar_referencias')
    expect(events.at(-1)?.kind).toBe('done')
  })

  it('busca sem resultado orienta o modelo a dizer que a base não confirmou', async () => {
    const embedder = new FakeEmbedder()
    await withDocument(embedder)

    responses.push(
      callResponse('buscar_referencias', { consulta: 'zzz' }),
      textResponse('A base não confirmou.')
    )
    await new AgentOrchestrator(handle, () => {}, writes, base(embedder)).send({
      sessionId,
      text: 'Pergunta sem resposta na base',
      requestId: 'k4'
    })

    const sent = functionResponseText(requests[1]!)
    expect(sent).toContain('Nenhum trecho relevante')
    expect(sent).toContain('não confirmou')
  })
})
