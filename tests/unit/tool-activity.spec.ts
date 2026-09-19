/**
 * Agrupamento do histórico de tools por turno da conversa.
 *
 * O accordion de cada pergunta precisa mostrar exatamente as tools usadas para
 * respondê-la — nem as do turno anterior, nem sumir quando a resposta chega.
 */

import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { groupToolCallsByMessage, toolLabel } from '../../src/shared/ai/tool-activity'
import type { AiMessage, AiToolCall } from '../../src/shared/contracts/entities-ai'

const SESSION = randomUUID()

function message(role: AiMessage['role'], createdAt: string): AiMessage {
  return { id: randomUUID(), sessionId: SESSION, role, text: '', toolName: null, createdAt }
}

function call(createdAt: string, messageId: string | null, toolName = 'listar_avaliacoes'): AiToolCall {
  return {
    id: randomUUID(),
    sessionId: SESSION,
    messageId,
    toolName,
    argumentsJson: '{}',
    status: 'executed',
    resultSummary: 'Leitura concluída.',
    createdAt
  }
}

describe('groupToolCallsByMessage', () => {
  const first = message('user', '2026-09-19T10:00:00.000Z')
  const firstAnswer = message('model', '2026-09-19T10:00:05.000Z')
  const second = message('user', '2026-09-19T10:01:00.000Z')
  const secondAnswer = message('model', '2026-09-19T10:01:09.000Z')
  const messages = [first, firstAnswer, second, secondAnswer]

  it('prende cada chamada à pergunta gravada no vínculo, em ordem cronológica', () => {
    const b = call('2026-09-19T10:01:03.000Z', second.id, 'ler_arquivo')
    const a = call('2026-09-19T10:01:02.000Z', second.id, 'listar_arquivos')
    const c = call('2026-09-19T10:00:02.000Z', first.id)

    const groups = groupToolCallsByMessage(messages, [b, a, c])

    expect(groups.get(first.id)?.map((item) => item.id)).toEqual([c.id])
    expect(groups.get(second.id)?.map((item) => item.toolName)).toEqual([
      'listar_arquivos',
      'ler_arquivo'
    ])
    expect(groups.has(firstAnswer.id)).toBe(false)
  })

  it('turnos sem tool não ganham grupo', () => {
    const groups = groupToolCallsByMessage(messages, [call('2026-09-19T10:01:02.000Z', second.id)])
    expect(groups.has(first.id)).toBe(false)
  })

  it('chamadas antigas, sem vínculo, caem na última pergunta anterior a elas', () => {
    const legacyFirst = call('2026-09-19T10:00:03.000Z', null)
    const legacySecond = call('2026-09-19T10:01:04.000Z', null)
    const beforeEverything = call('2026-09-19T09:00:00.000Z', null)

    const groups = groupToolCallsByMessage(messages, [legacyFirst, legacySecond, beforeEverything])

    expect(groups.get(first.id)?.map((item) => item.id)).toEqual([legacyFirst.id])
    expect(groups.get(second.id)?.map((item) => item.id)).toEqual([legacySecond.id])
  })

  it('vínculo para mensagem fora da conversa cai no critério cronológico', () => {
    const orphan = call('2026-09-19T10:00:03.000Z', randomUUID())
    expect(groupToolCallsByMessage(messages, [orphan]).get(first.id)).toHaveLength(1)
  })
})

describe('toolLabel', () => {
  it('traduz as tools conhecidas e devolve o nome cru das demais', () => {
    expect(toolLabel('registrar_resultados')).toBe('Registrando resultados')
    expect(toolLabel('tool_nova')).toBe('tool_nova')
  })
})
