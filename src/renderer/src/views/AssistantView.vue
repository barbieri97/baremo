<script setup lang="ts">
/**
 * Assistente de IA (spec §10).
 *
 * Duas travas visíveis nesta tela, ambas exigidas pela spec:
 *
 *  - o consentimento por paciente é pedido na primeira sessão daquele prontuário
 *    (§10.3), além do consentimento geral do módulo;
 *  - toda escrita passa por confirmação humana (§10.1, princípio 4): a tool não
 *    executa antes do usuário aprovar o diálogo.
 */
import { computed, onMounted, onUnmounted, ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { api, onAiStream } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from '../components/BaseButton.vue'
import BaseDialog from '../components/BaseDialog.vue'
import ToolActivityAccordion from '../components/ToolActivityAccordion.vue'
import type { ToolActivityItem } from '../components/ToolActivityAccordion.vue'
import { groupToolCallsByMessage } from '@shared/ai/tool-activity'
import type { AiResultImportRow, AiStreamEvent, AiToolCall } from '@shared/contracts/entities-ai'
import type { ChannelOutput } from '@shared/contracts'
import type { Patient } from '@shared/contracts/entities'

const props = defineProps<{ patientId: string }>()

const router = useRouter()
const appStore = useAppStore()

type Session = ChannelOutput<'ai:listSessions'>[number]
type Message = ChannelOutput<'ai:listMessages'>[number]

const patient = ref<Patient | null>(null)
const sessions = ref<Session[]>([])
const activeSessionId = ref<string | null>(null)
const messages = ref<Message[]>([])
const draft = ref('')

const consent = ref<{ moduleGranted: boolean; patientGranted: boolean; textVersion: string } | null>(
  null
)
const consentOpen = ref(false)

const streaming = ref(false)
const streamText = ref('')
/** Tools do turno em andamento, pareadas por `callId`. */
const liveCalls = ref<ToolActivityItem[]>([])
/** Tools já gravadas da conversa — o histórico que fica depois da resposta. */
const toolCalls = ref<AiToolCall[]>([])
const currentRequestId = ref<string | null>(null)

interface BlockDiffEntry {
  index: number
  kind: 'keep' | 'insert' | 'delete' | 'replace'
  before: string | null
  after: string | null
}

const confirmation = ref<{
  confirmationId: string
  toolName: string
  preview: string
  blockDiff: BlockDiffEntry[] | null
  resultPreview: AiResultImportRow[] | null
} | null>(null)

/** Blocos que o profissional aceitou. Começa vazio: aceitar é ato deliberado. */
const acceptedBlocks = ref<Set<number>>(new Set())

const changedBlocks = computed(
  () => confirmation.value?.blockDiff?.filter((entry) => entry.kind !== 'keep') ?? []
)

function toggleBlock(index: number): void {
  const next = new Set(acceptedBlocks.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  acceptedBlocks.value = next
}

function acceptAllBlocks(): void {
  acceptedBlocks.value = new Set(changedBlocks.value.map((entry) => entry.index))
}

const resultRows = computed(() => confirmation.value?.resultPreview ?? [])
const selectableRows = computed(() => resultRows.value.filter((row) => row.status !== 'invalid'))

/** Com diff ou tabela de resultados, autorizar exige ter marcado alguma coisa. */
const needsSelection = computed(
  () => changedBlocks.value.length > 0 || resultRows.value.length > 0
)

function acceptAllRows(): void {
  acceptedBlocks.value = new Set(selectableRows.value.map((row) => row.index))
}

function formatScore(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('pt-BR')
}

/** Histórico gravado, agrupado pela pergunta que abriu cada turno. */
const callsByMessage = computed(() => {
  const grouped = groupToolCallsByMessage(messages.value, toolCalls.value)
  const items = new Map<string, ToolActivityItem[]>()
  for (const [messageId, calls] of grouped) {
    items.set(
      messageId,
      calls.map((call) => ({
        id: call.id,
        toolName: call.toolName,
        argumentsJson: call.argumentsJson,
        status: call.status,
        summary: call.resultSummary
      }))
    )
  }
  return items
})

const DIFF_LABELS: Record<BlockDiffEntry['kind'], string> = {
  keep: 'Sem alteração',
  insert: 'Trecho novo',
  delete: 'Trecho removido',
  replace: 'Trecho reescrito'
}

const aiEnabled = computed(() => appStore.state?.aiEnabled ?? false)
const transcript = ref<HTMLElement | null>(null)

let unsubscribe: (() => void) | null = null

onMounted(async () => {
  try {
    patient.value = await api('patients:get', { id: props.patientId })
    consent.value = await api('ai:getConsent', { patientId: props.patientId })
    sessions.value = await api('ai:listSessions', { patientId: props.patientId })

    if (sessions.value.length > 0) await selectSession(sessions.value[0]!.id)
  } catch (error) {
    appStore.notifyError(error)
  }

  unsubscribe = onAiStream(handleStream)
})

onUnmounted(() => {
  unsubscribe?.()
  if (currentRequestId.value !== null) void api('ai:cancel', { requestId: currentRequestId.value })
})

/** Filtra por `requestId`: o canal é multiplexado entre requisições (§10.4). */
function handleStream(event: AiStreamEvent): void {
  if (event.requestId !== currentRequestId.value) return

  switch (event.kind) {
    case 'delta':
      streamText.value += event.text
      void scrollToBottom()
      break

    case 'tool_start':
      liveCalls.value = [
        ...liveCalls.value,
        {
          id: event.callId,
          toolName: event.toolName,
          argumentsJson: event.argumentsJson,
          status: 'running',
          summary: null
        }
      ]
      void scrollToBottom()
      break

    case 'tool_end':
      liveCalls.value = liveCalls.value.map((call) =>
        call.id === event.callId
          ? {
              ...call,
              status: !event.ok ? 'failed' : event.rejected ? 'rejected' : 'executed',
              summary: event.summary
            }
          : call
      )
      break

    case 'confirmation_required':
      confirmation.value = {
        confirmationId: event.confirmationId,
        toolName: event.toolName,
        preview: event.preview,
        blockDiff: event.blockDiff,
        resultPreview: event.resultPreview
      }
      // Linhas novas já vêm marcadas; sobrescrever um resultado existente, não —
      // substituir o que já estava gravado é sempre um ato deliberado.
      acceptedBlocks.value = new Set(
        (event.resultPreview ?? []).filter((row) => row.status === 'new').map((row) => row.index)
      )
      break

    case 'done':
      streaming.value = false
      currentRequestId.value = null
      void refreshMessages()
      break

    case 'error':
      streaming.value = false
      currentRequestId.value = null
      appStore.notify(event.code === 'cancelled' ? 'info' : 'error', event.message)
      void refreshMessages()
      break
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  if (transcript.value !== null) transcript.value.scrollTop = transcript.value.scrollHeight
}

async function refreshMessages(): Promise<void> {
  if (activeSessionId.value === null) return
  const sessionId = activeSessionId.value
  const [loadedMessages, loadedCalls] = await Promise.all([
    api('ai:listMessages', { sessionId }),
    api('ai:listToolCalls', { sessionId })
  ])
  messages.value = loadedMessages
  toolCalls.value = loadedCalls
  streamText.value = ''
  // O histórico gravado substitui o ao vivo — as mesmas chamadas, agora presas
  // à pergunta que as originou.
  liveCalls.value = []
  await scrollToBottom()
}

async function selectSession(sessionId: string): Promise<void> {
  activeSessionId.value = sessionId
  await refreshMessages()
}

async function createSession(): Promise<void> {
  // Consentimento por paciente na primeira sessão daquele prontuário (§10.3).
  if (consent.value !== null && (!consent.value.moduleGranted || !consent.value.patientGranted)) {
    consentOpen.value = true
    return
  }

  try {
    const session = await api('ai:createSession', {
      patientId: props.patientId,
      title: `Conversa de ${new Date().toLocaleDateString('pt-BR')}`
    })
    sessions.value = [session, ...sessions.value]
    await selectSession(session.id)
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function grantConsent(): Promise<void> {
  try {
    if (consent.value?.moduleGranted !== true) {
      await api('ai:grantConsent', { scope: 'module', patientId: null })
    }
    await api('ai:grantConsent', { scope: 'patient', patientId: props.patientId })
    consent.value = await api('ai:getConsent', { patientId: props.patientId })
    consentOpen.value = false
    await createSession()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (text === '' || activeSessionId.value === null || streaming.value) return

  const requestId = crypto.randomUUID()
  currentRequestId.value = requestId
  streaming.value = true
  streamText.value = ''
  liveCalls.value = []

  messages.value = [
    ...messages.value,
    {
      id: requestId,
      sessionId: activeSessionId.value,
      role: 'user',
      text,
      toolName: null,
      createdAt: new Date().toISOString()
    }
  ]
  draft.value = ''
  await scrollToBottom()

  try {
    await api('ai:sendMessage', { sessionId: activeSessionId.value, text, requestId })
  } catch (error) {
    streaming.value = false
    currentRequestId.value = null
    appStore.notifyError(error)
  }
}

async function cancel(): Promise<void> {
  if (currentRequestId.value === null) return
  await api('ai:cancel', { requestId: currentRequestId.value })
}

async function respondToConfirmation(approved: boolean): Promise<void> {
  if (confirmation.value === null) return

  const hasSelection =
    confirmation.value.blockDiff !== null || confirmation.value.resultPreview !== null
  try {
    await api('ai:confirmToolCall', {
      confirmationId: confirmation.value.confirmationId,
      approved,
      // Sem diff nem tabela, a proposta é aplicada inteira; com eles, só o que
      // foi marcado.
      acceptedBlocks: hasSelection && approved ? [...acceptedBlocks.value] : null
    })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    confirmation.value = null
    acceptedBlocks.value = new Set()
  }
}

async function deleteSession(sessionId: string): Promise<void> {
  try {
    await api('ai:deleteSession', { sessionId })
    sessions.value = sessions.value.filter((session) => session.id !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = null
      messages.value = []
      toolCalls.value = []
    }
  } catch (error) {
    appStore.notifyError(error)
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="border-b border-ink-200 bg-white px-6 py-3">
      <button
        class="text-xs text-ink-500 hover:underline"
        @click="router.push(`/pacientes/${patientId}`)"
      >
        ← {{ patient?.fullName ?? 'Prontuário' }}
      </button>
      <h1 class="mt-1 text-lg font-bold text-ink-800">Assistente</h1>
      <p class="text-xs text-ink-500">
        Esta conversa pertence exclusivamente a este paciente. O assistente não acessa nenhum outro
        prontuário.
      </p>
    </header>

    <div v-if="!aiEnabled" class="flex flex-1 items-center justify-center p-8">
      <div class="card max-w-md p-6 text-center">
        <h2 class="text-base font-semibold text-ink-800">Módulo de IA desligado</h2>
        <p class="mt-2 text-sm text-ink-600">
          O assistente está desativado. Todo o restante do aplicativo funciona normalmente sem ele.
        </p>
        <BaseButton class="mt-4" variant="primary" @click="router.push('/configuracoes')">
          Abrir configurações
        </BaseButton>
      </div>
    </div>

    <div v-else class="flex flex-1 overflow-hidden">
      <aside class="w-64 shrink-0 border-r border-ink-200 bg-white p-3">
        <BaseButton class="mb-3 w-full" size="sm" variant="primary" @click="createSession">
          Nova conversa
        </BaseButton>

        <p v-if="sessions.length === 0" class="text-xs text-ink-400">Nenhuma conversa ainda.</p>

        <ul class="space-y-1">
          <li v-for="session in sessions" :key="session.id" class="group flex items-center gap-1">
            <button
              class="flex-1 truncate rounded px-2 py-1.5 text-left text-xs"
              :class="
                activeSessionId === session.id
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-ink-600 hover:bg-ink-100'
              "
              @click="selectSession(session.id)"
            >
              {{ session.title }}
            </button>
            <button
              class="opacity-0 transition-opacity group-hover:opacity-100 text-xs text-danger-500"
              aria-label="Excluir conversa"
              @click="deleteSession(session.id)"
            >
              ×
            </button>
          </li>
        </ul>
      </aside>

      <div class="flex flex-1 flex-col">
        <div v-if="activeSessionId === null" class="flex flex-1 items-center justify-center">
          <p class="text-sm text-ink-400">Crie uma conversa para começar.</p>
        </div>

        <template v-else>
          <div ref="transcript" class="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <template v-for="message in messages" :key="message.id">
              <div
                class="flex"
                :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
              >
                <div
                  class="max-w-2xl whitespace-pre-wrap rounded-lg px-4 py-2.5 text-sm"
                  :class="
                    message.role === 'user'
                      ? 'bg-brand-500 text-white'
                      : 'border border-ink-200 bg-white text-ink-800'
                  "
                >
                  {{ message.text }}
                </div>
              </div>

              <!-- O que o assistente consultou para responder a esta pergunta. -->
              <ToolActivityAccordion
                v-if="callsByMessage.has(message.id)"
                :calls="callsByMessage.get(message.id) ?? []"
              />
            </template>

            <ToolActivityAccordion v-if="liveCalls.length > 0" :calls="liveCalls" open />

            <div v-if="streamText !== ''" class="flex justify-start">
              <div
                class="max-w-2xl whitespace-pre-wrap rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm text-ink-800"
              >
                {{ streamText }}
              </div>
            </div>

            <p v-else-if="streaming" class="text-xs text-ink-400">Consultando o assistente…</p>
          </div>

          <div class="border-t border-ink-200 bg-white px-6 py-3">
            <div class="flex items-end gap-2">
              <textarea
                v-model="draft"
                class="field-input min-h-20 flex-1 resize-none"
                placeholder="Pergunte sobre os resultados, peça um resumo ou um rascunho de documento."
                :disabled="streaming"
                @keydown.enter.exact.prevent="send"
              />
              <BaseButton v-if="streaming" variant="secondary" @click="cancel">Cancelar</BaseButton>
              <BaseButton
                v-else
                variant="primary"
                :disabled="draft.trim() === ''"
                @click="send"
              >
                Enviar
              </BaseButton>
            </div>
            <p class="mt-1 text-xs text-ink-400">
              Enter envia · Shift+Enter quebra linha. O assistente não emite diagnóstico e não
              substitui julgamento clínico.
            </p>
          </div>
        </template>
      </div>
    </div>

    <!-- §10.3 — consentimento antes do primeiro uso -->
    <BaseDialog
      v-model:open="consentOpen"
      title="Consentimento para uso do assistente"
      wide
    >
      <div class="space-y-3 text-sm text-ink-700">
        <p>
          Ao usar o assistente, dados deste prontuário serão enviados à API do Google Gemini,
          um serviço de terceiros fora deste computador.
        </p>
        <p>
          <strong>Com a pseudonimização ativa</strong> (padrão), o nome completo é substituído por
          iniciais, a data de nascimento por idade, e responsável, escola, endereço e contatos são
          removidos antes do envio.
        </p>
        <p>
          <strong>Arquivos grandes</strong> enviados para análise podem ficar temporariamente
          retidos nos servidores do provedor.
        </p>
        <p>
          Recomendamos usar uma chave de projeto com faturamento habilitado: chaves gratuitas
          historicamente têm política de retenção e uso para melhoria de produto distinta.
        </p>
        <p>
          A responsabilidade técnica sobre qualquer documento produzido é integralmente do
          profissional que o assina. Confirme que você obteve o consentimento do paciente ou do
          responsável para este tratamento de dados.
        </p>
      </div>

      <template #footer>
        <BaseButton variant="ghost" @click="consentOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" @click="grantConsent">Concordo e autorizo</BaseButton>
      </template>
    </BaseDialog>

    <!-- §10.1, princípio 4 — toda escrita passa por confirmação humana -->
    <BaseDialog
      :open="confirmation !== null"
      title="O assistente pede autorização para gravar"
      wide
      @update:open="(value) => !value && respondToConfirmation(false)"
    >
      <p class="text-sm text-ink-700">{{ confirmation?.preview }}</p>

      <!-- §10.6 — edição de documento existente vai para revisão bloco a bloco. -->
      <div v-if="changedBlocks.length > 0" class="mt-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Alterações propostas ({{ acceptedBlocks.size }} de {{ changedBlocks.length }} aceitas)
          </p>
          <button class="text-xs text-brand-500 hover:underline" @click="acceptAllBlocks">
            Aceitar todas
          </button>
        </div>

        <ul class="max-h-80 space-y-2 overflow-y-auto">
          <li
            v-for="entry in changedBlocks"
            :key="entry.index"
            class="rounded border p-2"
            :class="
              acceptedBlocks.has(entry.index)
                ? 'border-ok-500 bg-ok-50'
                : 'border-ink-200 bg-white'
            "
          >
            <label class="flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                class="mt-1 rounded border-ink-300"
                :checked="acceptedBlocks.has(entry.index)"
                @change="toggleBlock(entry.index)"
              />
              <span class="min-w-0 flex-1">
                <span class="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {{ DIFF_LABELS[entry.kind] }}
                </span>

                <span
                  v-if="entry.before !== null"
                  class="mt-1 block whitespace-pre-wrap text-xs text-danger-600 line-through"
                >
                  {{ entry.before }}
                </span>
                <span
                  v-if="entry.after !== null"
                  class="mt-1 block whitespace-pre-wrap text-xs text-ink-800"
                >
                  {{ entry.after }}
                </span>
              </span>
            </label>
          </li>
        </ul>

        <p class="mt-2 text-xs text-ink-500">
          O que não for aceito permanece como está hoje — rejeitar significa "nada muda aqui".
        </p>
      </div>

      <!-- Resultados propostos: aceitos linha a linha, como no lançamento manual. -->
      <div v-if="resultRows.length > 0" class="mt-4" data-testid="result-import-preview">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Resultados propostos ({{ acceptedBlocks.size }} de {{ selectableRows.length }}
            aceitos)
          </p>
          <button class="text-xs text-brand-500 hover:underline" @click="acceptAllRows">
            Aceitar todos
          </button>
        </div>

        <div class="max-h-80 overflow-y-auto rounded border border-ink-200">
          <table class="w-full text-left text-xs">
            <thead class="sticky top-0 bg-ink-50 text-ink-500">
              <tr>
                <th class="w-8 px-2 py-1.5"></th>
                <th class="px-2 py-1.5 font-semibold">Instrumento</th>
                <th class="px-2 py-1.5 font-semibold">Tipo</th>
                <th class="px-2 py-1.5 text-right font-semibold">Valor</th>
                <th class="px-2 py-1.5 font-semibold">Classificação</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in resultRows"
                :key="row.index"
                class="border-t border-ink-100 align-top"
                :class="{
                  'bg-warn-50': row.status === 'overwrite',
                  'bg-danger-50 text-ink-500': row.status === 'invalid'
                }"
              >
                <td class="px-2 py-1.5">
                  <input
                    type="checkbox"
                    class="rounded border-ink-300"
                    :aria-label="`Aceitar ${row.instrumentName}`"
                    :disabled="row.status === 'invalid'"
                    :checked="acceptedBlocks.has(row.index)"
                    @change="toggleBlock(row.index)"
                  />
                </td>
                <td class="px-2 py-1.5 text-ink-800">
                  {{ row.instrumentName }}
                  <span v-if="row.error" class="block text-danger-600">{{ row.error }}</span>
                  <span v-else-if="row.status === 'overwrite'" class="block text-warn-700">
                    Substitui o valor gravado: {{ formatScore(row.existingValue) }}
                    <template v-if="row.existingClassification">
                      ({{ row.existingClassification }})
                    </template>
                  </span>
                  <span v-if="row.warning" class="block text-warn-700">{{ row.warning }}</span>
                </td>
                <td class="px-2 py-1.5">{{ row.scoreType }}</td>
                <td class="px-2 py-1.5 text-right font-mono">{{ formatScore(row.value) }}</td>
                <td class="px-2 py-1.5">
                  <span v-if="row.classificationName" class="inline-flex items-center gap-1">
                    <span
                      class="inline-block h-2.5 w-2.5 rounded-full"
                      :style="{ backgroundColor: row.colorHex ?? undefined }"
                    ></span>
                    {{ row.classificationName }}
                  </span>
                  <span v-else class="text-ink-400">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="mt-2 text-xs text-ink-500">
          Linhas em amarelo substituem um resultado já gravado e vêm desmarcadas. A classificação é
          calculada pelas faixas cadastradas, como no lançamento manual.
        </p>
      </div>

      <p class="mt-3 text-xs text-ink-500">
        Ferramenta: <span class="font-mono">{{ confirmation?.toolName }}</span>
      </p>
      <p class="mt-1 text-xs text-ink-500">
        Nada é gravado sem esta autorização. Revise antes de aprovar — inclusive se a solicitação
        parecer ter vindo do conteúdo de um arquivo anexado.
      </p>

      <template #footer>
        <BaseButton variant="ghost" @click="respondToConfirmation(false)">Recusar</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="needsSelection && acceptedBlocks.size === 0"
          @click="respondToConfirmation(true)"
        >
          {{
            changedBlocks.length > 0
              ? `Aplicar ${acceptedBlocks.size} bloco(s)`
              : resultRows.length > 0
                ? `Gravar ${acceptedBlocks.size} resultado(s)`
                : 'Autorizar'
          }}
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
