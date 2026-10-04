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
import PageHeader from '../components/PageHeader.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseCheckbox from '../components/BaseCheckbox.vue'
import BaseEmptyState from '../components/BaseEmptyState.vue'
import BaseIconButton from '../components/BaseIconButton.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import BaseTextarea from '../components/BaseTextarea.vue'
import { Plus, X } from 'lucide-vue-next'
import type { ToolActivityItem } from '../components/ToolActivityAccordion.vue'
import { groupToolCallsByMessage } from '@shared/ai/tool-activity'
import type { AiResultImportRow, AiStreamEvent, AiToolCall } from '@shared/contracts/entities-ai'
import type { ChannelOutput } from '@shared/contracts'
import type { Patient } from '@shared/contracts/entities'

const RESULT_COLUMNS: TableColumn[] = [
  { key: 'accept', class: 'w-8' },
  { key: 'instrument', label: 'Instrumento' },
  { key: 'scoreType', label: 'Tipo' },
  { key: 'value', label: 'Valor', align: 'right' },
  { key: 'classification', label: 'Classificação' }
]

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

const consent = ref<{
  moduleGranted: boolean
  patientGranted: boolean
  textVersion: string
} | null>(null)
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
const needsSelection = computed(() => changedBlocks.value.length > 0 || resultRows.value.length > 0)

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
    <PageHeader
      title="Assistente"
      subtitle="Esta conversa pertence exclusivamente a este paciente. O assistente não acessa nenhum outro prontuário."
      :back="{ label: patient?.fullName ?? 'Prontuário', to: `/pacientes/${patientId}` }"
      size="md"
      class="border-b border-line bg-surface px-6 py-3"
    />

    <div v-if="!aiEnabled" class="flex flex-1 items-center justify-center p-8">
      <BaseEmptyState
        framed
        title="Módulo de IA desligado"
        message="O assistente está desativado. Todo o restante do aplicativo funciona normalmente sem ele."
        class="max-w-md"
      >
        <template #actions>
          <BaseButton variant="primary" @click="router.push('/configuracoes')">
            Abrir configurações
          </BaseButton>
        </template>
      </BaseEmptyState>
    </div>

    <div v-else class="flex flex-1 overflow-hidden">
      <aside class="w-64 shrink-0 border-r border-line bg-surface p-3">
        <BaseButton
          class="mb-3 w-full"
          size="sm"
          variant="primary"
          :icon="Plus"
          @click="createSession"
        >
          Nova conversa
        </BaseButton>

        <p v-if="sessions.length === 0" class="text-xs text-fg-faint">Nenhuma conversa ainda.</p>

        <ul class="space-y-1">
          <li v-for="session in sessions" :key="session.id" class="group flex items-center gap-1">
            <button
              type="button"
              class="flex-1 truncate rounded-chip px-2 py-1.5 text-left text-xs"
              :class="
                activeSessionId === session.id
                  ? 'bg-accent-soft font-semibold text-accent-strong'
                  : 'text-fg-muted hover:bg-surface-muted'
              "
              @click="selectSession(session.id)"
            >
              {{ session.title }}
            </button>
            <BaseIconButton
              :icon="X"
              label="Excluir conversa"
              variant="danger"
              size="sm"
              class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              @click="deleteSession(session.id)"
            />
          </li>
        </ul>
      </aside>

      <div class="flex flex-1 flex-col">
        <div v-if="activeSessionId === null" class="flex flex-1 items-center justify-center">
          <BaseEmptyState message="Crie uma conversa para começar." />
        </div>

        <template v-else>
          <div ref="transcript" class="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <template v-for="message in messages" :key="message.id">
              <div class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
                <div
                  class="max-w-2xl whitespace-pre-wrap rounded-surface px-4 py-2.5 text-sm"
                  :class="
                    message.role === 'user'
                      ? 'bg-accent text-fg-inverse'
                      : 'border border-line bg-surface text-fg'
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
                class="max-w-2xl whitespace-pre-wrap rounded-surface border border-line bg-surface px-4 py-2.5 text-sm text-fg"
              >
                {{ streamText }}
              </div>
            </div>

            <p v-else-if="streaming" class="text-xs text-fg-faint">Consultando o assistente…</p>
          </div>

          <div class="border-t border-line bg-surface px-6 py-3">
            <div class="flex items-end gap-2">
              <BaseTextarea
                v-model="draft"
                class="flex-1 resize-none"
                aria-label="Mensagem ao assistente"
                placeholder="Pergunte sobre os resultados, peça um resumo ou um rascunho de documento."
                :disabled="streaming"
                @keydown.enter.exact.prevent="send"
              />
              <BaseButton v-if="streaming" variant="secondary" @click="cancel">Cancelar</BaseButton>
              <BaseButton v-else variant="primary" :disabled="draft.trim() === ''" @click="send">
                Enviar
              </BaseButton>
            </div>
            <p class="mt-1 text-xs text-fg-faint">
              Enter envia · Shift+Enter quebra linha. O assistente não emite diagnóstico e não
              substitui julgamento clínico.
            </p>
          </div>
        </template>
      </div>
    </div>

    <!-- §10.3 — consentimento antes do primeiro uso -->
    <BaseDialog v-model:open="consentOpen" title="Consentimento para uso do assistente" wide>
      <div class="space-y-3 text-sm text-fg-secondary">
        <p>
          Ao usar o assistente, dados deste prontuário serão enviados à API do Google Gemini, um
          serviço de terceiros fora deste computador.
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
      <p class="text-sm text-fg-secondary">{{ confirmation?.preview }}</p>

      <!-- §10.6 — edição de documento existente vai para revisão bloco a bloco. -->
      <div v-if="changedBlocks.length > 0" class="mt-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Alterações propostas ({{ acceptedBlocks.size }} de {{ changedBlocks.length }} aceitas)
          </p>
          <BaseButton variant="link" size="sm" @click="acceptAllBlocks">Aceitar todas</BaseButton>
        </div>

        <ul class="max-h-80 space-y-2 overflow-y-auto">
          <li
            v-for="entry in changedBlocks"
            :key="entry.index"
            class="rounded-chip border p-2"
            :class="
              acceptedBlocks.has(entry.index) ? 'border-ok bg-ok-soft' : 'border-line bg-surface'
            "
          >
            <BaseCheckbox
              :model-value="acceptedBlocks.has(entry.index)"
              class="w-full cursor-pointer"
              @update:model-value="toggleBlock(entry.index)"
            >
              <span class="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                {{ DIFF_LABELS[entry.kind] }}
              </span>
              <template #description>
                <span
                  v-if="entry.before !== null"
                  class="mt-1 block whitespace-pre-wrap text-danger-strong line-through"
                >
                  {{ entry.before }}
                </span>
                <span v-if="entry.after !== null" class="mt-1 block whitespace-pre-wrap text-fg">
                  {{ entry.after }}
                </span>
              </template>
            </BaseCheckbox>
          </li>
        </ul>

        <p class="mt-2 text-xs text-fg-subtle">
          O que não for aceito permanece como está hoje — rejeitar significa "nada muda aqui".
        </p>
      </div>

      <!-- Resultados propostos: aceitos linha a linha, como no lançamento manual. -->
      <div v-if="resultRows.length > 0" class="mt-4" data-testid="result-import-preview">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
            Resultados propostos ({{ acceptedBlocks.size }} de {{ selectableRows.length }}
            aceitos)
          </p>
          <BaseButton variant="link" size="sm" @click="acceptAllRows">Aceitar todos</BaseButton>
        </div>

        <BaseCard class="max-h-80 overflow-y-auto">
          <BaseTable :columns="RESULT_COLUMNS" density="compact" size="sm" sticky>
            <tr
              v-for="row in resultRows"
              :key="row.index"
              class="align-top"
              :class="{
                'bg-warn-soft': row.status === 'overwrite',
                'bg-danger-soft text-fg-subtle': row.status === 'invalid'
              }"
            >
              <td>
                <BaseCheckbox
                  :model-value="acceptedBlocks.has(row.index)"
                  :aria-label="`Aceitar ${row.instrumentName}`"
                  :disabled="row.status === 'invalid'"
                  @update:model-value="toggleBlock(row.index)"
                />
              </td>
              <td class="text-fg">
                {{ row.instrumentName }}
                <span v-if="row.error" class="block text-danger-strong">{{ row.error }}</span>
                <span v-else-if="row.status === 'overwrite'" class="block text-warn-strong">
                  Substitui o valor gravado: {{ formatScore(row.existingValue) }}
                  <template v-if="row.existingClassification">
                    ({{ row.existingClassification }})
                  </template>
                </span>
                <span v-if="row.warning" class="block text-warn-strong">{{ row.warning }}</span>
              </td>
              <td>{{ row.scoreType }}</td>
              <td class="text-right font-mono">{{ formatScore(row.value) }}</td>
              <td>
                <span v-if="row.classificationName" class="inline-flex items-center gap-1">
                  <span
                    class="inline-block size-2.5 rounded-full"
                    :style="{ backgroundColor: row.colorHex ?? undefined }"
                  ></span>
                  {{ row.classificationName }}
                </span>
                <span v-else class="text-fg-faint">—</span>
              </td>
            </tr>
          </BaseTable>
        </BaseCard>

        <p class="mt-2 text-xs text-fg-subtle">
          Linhas em amarelo substituem um resultado já gravado e vêm desmarcadas. A classificação é
          calculada pelas faixas cadastradas, como no lançamento manual.
        </p>
      </div>

      <p class="mt-3 text-xs text-fg-subtle">
        Ferramenta: <span class="font-mono">{{ confirmation?.toolName }}</span>
      </p>
      <p class="mt-1 text-xs text-fg-subtle">
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
