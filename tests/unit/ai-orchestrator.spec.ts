/**
 * Loop do orquestrador com um Gemini falso — o que o histórico de tools do chat
 * depende de receber (spec §10.4).
 *
 *  - `tool_start` e `tool_end` da mesma chamada carregam o mesmo `callId`;
 *  - a chamada é gravada com esse id e presa à mensagem do usuário do turno;
 *  - uma escrita recusada fica registrada como `rejected`, não como sucesso.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type * as GenAi from '@google/genai'

const responses: unknown[] = []

vi.mock('../../src/main/ai/key-store', () => ({ loadKey: () => 'chave-de-teste' }))

vi.mock('@google/genai', async (importOriginal) => {
  const original = await importOriginal<typeof GenAi>()
  return {
    ...original,
    GoogleGenAI: class {
      models = {
        generateContent: async (): Promise<unknown> => {
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
const { aiMessages, aiSessions, aiToolCalls, patients } = await import('../../src/main/db/schema')
const { getAiConfig, updateAiConfig } = await import('../../src/main/repositories/ai-config')
const { AgentOrchestrator } = await import('../../src/main/ai/orchestrator')

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
