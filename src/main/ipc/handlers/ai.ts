/**
 * Handlers de `ai:*` (spec §10).
 *
 * Nada aqui devolve a chave de API ao renderer — só `keyHint`, com os quatro
 * últimos caracteres (§10.1, princípio 2).
 */

import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { getDatabase } from '../../db'
import { conflict, notFound, registerHandler } from '../register'
import { aiMessages, aiSessions, consents } from '../../db/schema'
import { getAiConfig, updateAiConfig } from '../../repositories/ai-config'
import { getPatient } from '../../repositories/patients'
import { clearKey, encryptionAvailable, keyHint, saveKey } from '../../ai/key-store'
import { AgentOrchestrator, contentToTiptap } from '../../ai/orchestrator'
import type { WritePreview } from '../../ai/orchestrator'
import { applyAcceptedChanges, countChanges, diffBlocks } from '@shared/domain/block-diff'
import { listAiAudit, recordAiEvent } from '../../ai/audit'
import { createAiDraft, getDocument, saveContent } from '../../repositories/documents'
import { nowIso } from '../../repositories/helpers'
import { AI_STREAM_CHANNEL } from '@shared/contracts'
import { AI_MODELS } from '@shared/contracts/entities-ai'
import type { AiModel, AiSession, AiStreamEvent } from '@shared/contracts/entities-ai'
import type { DocumentType } from '@shared/labels'
import { DOCUMENT_TYPES } from '@shared/labels'

/**
 * Versão do texto de consentimento.
 *
 * Sobe quando o texto muda: um consentimento dado sob outra redação não vale
 * para a nova, e o registro precisa dizer a que o usuário consentiu.
 */
export const CONSENT_TEXT_VERSION = '2026-08-1'

let orchestrator: AgentOrchestrator | null = null

export function registerAiHandlers(): void {
  registerHandler('ai:getConfig', () => currentConfig())

  registerHandler('ai:setEnabled', ({ enabled }) => {
    const handle = getDatabase()
    updateAiConfig(handle, { enabled })
    recordAiEvent(
      handle,
      enabled ? 'Módulo de IA ativado pelo usuário.' : 'Módulo de IA desativado pelo usuário.',
      { pseudonymized: getAiConfig(handle).pseudonymize }
    )
    return currentConfig()
  })

  registerHandler('ai:setModel', ({ model }) => {
    updateAiConfig(getDatabase(), { model })
    return currentConfig()
  })

  /**
   * Desligar a pseudonimização exige confirmação explícita e fica registrado em
   * `ai_audit` (§10.3). Ligar de volta não exige nada — voltar ao padrão seguro
   * nunca deve ter atrito.
   */
  registerHandler('ai:setPseudonymize', ({ enabled, confirmed }) => {
    const handle = getDatabase()

    if (!enabled && !confirmed) {
      throw conflict(
        'Desligar a pseudonimização faz com que nome completo, data de nascimento e contatos do paciente sejam enviados ao provedor de IA. Confirme explicitamente para prosseguir.'
      )
    }

    updateAiConfig(handle, { pseudonymize: enabled })
    recordAiEvent(
      handle,
      enabled
        ? 'Pseudonimização reativada.'
        : 'Pseudonimização DESLIGADA por confirmação explícita do usuário.',
      { pseudonymized: enabled }
    )

    return currentConfig()
  })

  registerHandler('ai:setBudget', ({ monthlyTokenBudget }) => {
    updateAiConfig(getDatabase(), { monthlyTokenBudget })
    return currentConfig()
  })

  registerHandler('ai:saveKey', ({ key, persist }) => {
    const handle = getDatabase()

    try {
      saveKey(key, { persist })
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : 'Falha ao gravar a chave.')
    }

    updateAiConfig(handle, { keyHint: keyHint(key), keyPersisted: persist })
    return currentConfig()
  })

  /** Chamada de teste antes de salvar (§10.2). A chave não é gravada aqui. */
  registerHandler('ai:testKey', async ({ key }) => {
    try {
      const client = new GoogleGenAI({ apiKey: key })
      await client.models.generateContent({
        model: 'gemini-flash-lite-latest',
        contents: 'ok',
        config: { maxOutputTokens: 1, automaticFunctionCalling: { disable: true } }
      })
      return { ok: true, message: 'Chave válida. A conexão com o provedor funcionou.' }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)

      if (/\b401\b|API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(raw)) {
        return { ok: false, message: 'A chave foi recusada pelo provedor. Verifique se copiou corretamente.' }
      }
      if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed/i.test(raw)) {
        return { ok: false, message: 'Sem conexão com o provedor. Verifique a rede e tente de novo.' }
      }
      return { ok: false, message: `Não foi possível validar a chave: ${raw}` }
    }
  })

  registerHandler('ai:clearKey', () => {
    clearKey()
    updateAiConfig(getDatabase(), { keyHint: null })
    return currentConfig()
  })

  // ─── Consentimento (§10.3) ───────────────────────────────────────────────

  registerHandler('ai:getConsent', ({ patientId }) => {
    const handle = getDatabase()

    const moduleConsent = handle.db
      .select()
      .from(consents)
      .where(and(eq(consents.scope, 'module'), isNull(consents.patientId)))
      .get()

    const patientConsent =
      patientId === null
        ? undefined
        : handle.db
            .select()
            .from(consents)
            .where(and(eq(consents.scope, 'patient'), eq(consents.patientId, patientId)))
            .get()

    return {
      moduleGranted: moduleConsent?.consentTextVersion === CONSENT_TEXT_VERSION,
      patientGranted: patientConsent?.consentTextVersion === CONSENT_TEXT_VERSION,
      textVersion: CONSENT_TEXT_VERSION
    }
  })

  registerHandler('ai:grantConsent', ({ scope, patientId }) => {
    const handle = getDatabase()

    if (scope === 'patient' && patientId === null) {
      throw conflict('Consentimento por paciente exige o paciente.')
    }

    handle.raw
      .prepare(
        `INSERT INTO consents (id, scope, patient_id, granted_at, consent_text_version)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (scope, COALESCE(patient_id, ''))
         DO UPDATE SET granted_at = excluded.granted_at,
                       consent_text_version = excluded.consent_text_version`
      )
      .run(randomUUID(), scope, scope === 'module' ? null : patientId, nowIso(), CONSENT_TEXT_VERSION)

    return { ok: true as const }
  })

  // ─── Sessões e mensagens ─────────────────────────────────────────────────

  registerHandler('ai:listSessions', ({ patientId }) =>
    getDatabase()
      .db.select()
      .from(aiSessions)
      .where(eq(aiSessions.patientId, patientId))
      .orderBy(desc(aiSessions.updatedAt))
      .all()
      .map(toSession)
  )

  /**
   * O `patientId` é fixado na criação e nunca muda (§10.1, princípio 3): não
   * existe canal para trocá-lo, e o orquestrador o lê do banco, não do renderer.
   */
  registerHandler('ai:createSession', ({ patientId, title }) => {
    const handle = getDatabase()
    getPatient(handle, patientId)

    const config = getAiConfig(handle)
    const id = randomUUID()
    const timestamp = nowIso()

    handle.db
      .insert(aiSessions)
      .values({
        id,
        patientId,
        title: title || 'Nova conversa',
        model: config.model,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()

    const session = handle.db.select().from(aiSessions).where(eq(aiSessions.id, id)).get()
    if (!session) throw notFound('Sessão não encontrada após criação.')
    return toSession(session)
  })

  registerHandler('ai:deleteSession', ({ sessionId }) => {
    const result = getDatabase().db.delete(aiSessions).where(eq(aiSessions.id, sessionId)).run()
    if (result.changes === 0) throw notFound('Sessão não encontrada.')
    return { ok: true as const }
  })

  registerHandler('ai:listMessages', ({ sessionId }) =>
    getDatabase()
      .db.select()
      .from(aiMessages)
      .where(eq(aiMessages.sessionId, sessionId))
      .orderBy(asc(aiMessages.createdAt))
      .all()
      .map((row) => ({ ...row, role: row.role as 'user' | 'model' | 'tool' | 'system' }))
  )

  registerHandler('ai:sendMessage', ({ sessionId, text, requestId }) => {
    // O turno roda solto: a resposta chega pelo canal de streaming, e travar o
    // `invoke` até o fim impediria o cancelamento.
    void getOrchestrator().send({ sessionId, text, requestId })
    return { ok: true as const }
  })

  registerHandler('ai:cancel', ({ requestId }) => {
    getOrchestrator().cancel(requestId)
    return { ok: true as const }
  })

  registerHandler('ai:confirmToolCall', ({ confirmationId, approved, acceptedBlocks }) => {
    const found = getOrchestrator().confirm(confirmationId, approved, acceptedBlocks)
    if (!found) throw notFound('Esta confirmação não está mais pendente.')
    return { ok: true as const }
  })

  registerHandler('ai:listAudit', ({ limit }) => listAiAudit(getDatabase(), limit))
}

/** O banco guarda o modelo como texto; o contrato exige um dos valores do enum. */
function toSession(row: typeof aiSessions.$inferSelect): AiSession {
  return {
    ...row,
    model: (AI_MODELS as readonly string[]).includes(row.model)
      ? (row.model as AiModel)
      : 'gemini-flash-latest'
  }
}

function currentConfig(): ReturnType<typeof getAiConfig> {
  return getAiConfig(getDatabase(), encryptionAvailable())
}

function getOrchestrator(): AgentOrchestrator {
  if (orchestrator === null) {
    orchestrator = new AgentOrchestrator(getDatabase(), emitToRenderer, {
      prepare: prepareWriteTool,
      apply: applyWriteTool
    })
  }
  return orchestrator
}

/**
 * Monta o que o diálogo de confirmação mostra (§10.6).
 *
 * Para a edição de um documento existente, produz o diff POR BLOCO: o
 * profissional aceita ou rejeita parágrafo a parágrafo, porque essa é a unidade
 * que ele revisa e assina. Um "aceitar tudo ou nada" empurraria para aceitar o
 * que não foi lido.
 *
 * Vive aqui, e não no orquestrador, porque montar o diff exige LER o documento —
 * e `src/main/ai/**` está proibido de importar os repositórios gerais (§10.5).
 */
function prepareWriteTool(
  patientId: string,
  toolName: string,
  args: Record<string, unknown>
): WritePreview {
  if (toolName === 'criar_rascunho_documento') {
    const title = typeof args['titulo'] === 'string' ? args['titulo'] : 'Sem título'
    const content = typeof args['conteudo'] === 'string' ? args['conteudo'] : ''
    const words = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length

    return {
      description: `Criar o rascunho "${title}" com ${words} palavra(s). Ele nascerá marcado como assistido por IA e precisará de revisão antes de ser finalizado.`,
      blockDiff: null
    }
  }

  if (toolName === 'sugerir_edicao_documento') {
    const documentId = typeof args['documentoId'] === 'string' ? args['documentoId'] : ''

    try {
      const document = getDocument(getDatabase(), documentId)

      // Revalidação de propriedade também aqui: o ID veio do modelo, e mostrar
      // o conteúdo de outro prontuário no diálogo já seria um vazamento.
      if (document.patientId !== patientId) {
        return {
          description: 'O documento indicado não pertence ao paciente desta sessão.',
          blockDiff: null
        }
      }

      const changes = diffBlocks(document.contentJson, contentToTiptap(args['conteudo']))
      const reason = typeof args['justificativa'] === 'string' ? args['justificativa'] : ''

      return {
        description: `Propor nova versão de "${document.title}" — ${countChanges(changes)} bloco(s) alterado(s). Justificativa: ${reason}`,
        blockDiff: changes.map((change) => ({
          index: change.index,
          kind: change.kind,
          before: change.before,
          after: change.after
        }))
      }
    } catch {
      return { description: 'Documento não encontrado.', blockDiff: null }
    }
  }

  return { description: 'Gravação solicitada pelo assistente.', blockDiff: null }
}

/** Difunde o evento de streaming; o renderer filtra por `requestId` (§10.4). */
function emitToRenderer(event: AiStreamEvent): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(AI_STREAM_CHANNEL, event)
  }
}

/**
 * Aplica a tool de escrita DEPOIS da confirmação humana (§10.6).
 *
 * O `patientId` chega do contexto de sessão do orquestrador, não dos argumentos
 * do modelo — mesmo aqui, do lado da escrita, o paciente nunca é algo que o
 * modelo escolhe.
 */
async function applyWriteTool(
  patientId: string,
  toolName: string,
  args: Record<string, unknown>,
  acceptedBlocks: readonly number[] | null
): Promise<string> {
  const handle = getDatabase()

  if (toolName === 'criar_rascunho_documento') {
    const type = typeof args['tipo'] === 'string' ? args['tipo'] : 'other'
    const title = typeof args['titulo'] === 'string' ? args['titulo'] : 'Rascunho'
    const assessmentId = typeof args['avaliacaoId'] === 'string' ? args['avaliacaoId'] : null

    const document = createAiDraft(handle, {
      patientId,
      assessmentId,
      type: (DOCUMENT_TYPES as readonly string[]).includes(type)
        ? (type as DocumentType)
        : 'other',
      title,
      content: contentToTiptap(args['conteudo'])
    })

    return `Rascunho "${document.title}" criado. Ele precisa de revisão antes de ser finalizado.`
  }

  if (toolName === 'sugerir_edicao_documento') {
    const documentId = typeof args['documentoId'] === 'string' ? args['documentoId'] : ''
    const document = getDocument(handle, documentId)

    // Revalidação de propriedade também na escrita: o ID veio do modelo.
    if (document.patientId !== patientId) {
      throw new Error('O documento indicado não pertence ao paciente desta sessão.')
    }

    const proposed = contentToTiptap(args['conteudo'])

    // Sem seleção de blocos, aplica a proposta inteira; com seleção, monta o
    // documento a partir do que foi aceito — o rejeitado volta ao estado atual.
    const changes = diffBlocks(document.contentJson, proposed)
    const content =
      acceptedBlocks === null
        ? proposed
        : applyAcceptedChanges(changes, acceptedBlocks)

    saveContent(handle, documentId, content)

    const applied = acceptedBlocks === null ? countChanges(changes) : acceptedBlocks.length
    return `Documento "${document.title}" atualizado: ${applied} bloco(s) aplicado(s). A versão anterior foi preservada no histórico.`
  }

  throw new Error(`Ferramenta de escrita desconhecida: ${toolName}.`)
}
