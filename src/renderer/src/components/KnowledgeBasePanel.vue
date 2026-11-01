<script setup lang="ts">
/**
 * Base de referências do assistente (RAG local).
 *
 * O profissional importa normas, manuais e artigos; o app indexa no próprio
 * computador e o assistente passa a consultá-los para confirmar informações.
 * Enquanto houver documento na fila, a lista é recarregada a cada segundo:
 * o progresso vive no processo principal e não tem canal de evento próprio.
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseAlert from './BaseAlert.vue'
import BaseBadge from './BaseBadge.vue'
import BaseButton from './BaseButton.vue'
import BaseCard from './BaseCard.vue'
import BaseDialog from './BaseDialog.vue'
import BaseEmptyState from './BaseEmptyState.vue'
import BaseField from './BaseField.vue'
import BaseInput from './BaseInput.vue'
import BaseProgress from './BaseProgress.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SectionHeader from './SectionHeader.vue'
import { KNOWLEDGE_STATUS_LABELS } from '@shared/contracts/entities-knowledge'
import type { KnowledgeOverview, KnowledgeStatus } from '@shared/contracts/entities-knowledge'

type Row = KnowledgeOverview['documents'][number]

const POLL_MS = 1000

const STATUS_TONES: Readonly<Record<KnowledgeStatus, 'neutral' | 'accent' | 'warn' | 'danger' | 'ok'>> = {
  pending: 'neutral',
  indexing: 'accent',
  ready: 'ok',
  failed: 'danger',
  no_text: 'warn'
}

const STAGE_LABELS = {
  model: 'Preparando o modelo',
  extracting: 'Extraindo o texto',
  embedding: 'Gerando os vetores',
  saving: 'Gravando'
} as const

const appStore = useAppStore()

const overview = ref<KnowledgeOverview | null>(null)
const importing = ref(false)
const renaming = ref<Row | null>(null)
const renameOpen = ref(false)
const renameTitle = ref('')
const deleting = ref<Row | null>(null)
const deleteOpen = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null

const documents = computed(() => overview.value?.documents ?? [])
const unavailable = computed(() => overview.value?.unavailable ?? null)
const busy = computed(() =>
  documents.value.some((document) => document.status === 'pending' || document.status === 'indexing')
)

async function refresh(): Promise<void> {
  try {
    overview.value = await api('knowledge:overview')
  } catch (error) {
    appStore.notifyError(error)
  }
  schedule()
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer)
  timer = busy.value ? setTimeout(() => void refresh(), POLL_MS) : null
}

onMounted(refresh)
onBeforeUnmount(() => {
  if (timer !== null) clearTimeout(timer)
})

async function importFiles(): Promise<void> {
  importing.value = true
  try {
    const result = await api('knowledge:pickAndImport')
    for (const rejected of result.rejected) {
      appStore.notify('warning', `${rejected.name}: ${rejected.reason}`)
    }
    if (result.added.length > 0) {
      appStore.notify(
        'info',
        `${result.added.length} documento(s) na fila. A indexação roda em segundo plano.`
      )
    }
    await refresh()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    importing.value = false
  }
}

function progressFor(document: Row): { label: string; percent: number | null } | null {
  if (document.status !== 'indexing') return null
  const current = overview.value
  if (current?.modelDownload) {
    return {
      label: 'Baixando o modelo de busca (só na primeira vez, cerca de 130 MB)',
      percent: current.modelDownload.percent
    }
  }
  const progress = current?.progress
  if (!progress || progress.documentId !== document.id) return { label: 'Indexando', percent: null }
  return {
    label: STAGE_LABELS[progress.stage],
    percent: progress.total > 0 ? (progress.done / progress.total) * 100 : null
  }
}

function details(document: Row): string {
  const parts = [document.originalName]
  if (document.pageCount !== null) parts.push(`${document.pageCount} página(s)`)
  if (document.status === 'ready') parts.push(`${document.chunkCount} trecho(s)`)
  return parts.join(' · ')
}

function askRename(document: Row): void {
  renaming.value = document
  renameTitle.value = document.title
  renameOpen.value = true
}

async function confirmRename(): Promise<void> {
  const target = renaming.value
  const title = renameTitle.value.trim()
  if (target === null || title.length === 0) return
  try {
    await api('knowledge:rename', { id: target.id, title })
    renameOpen.value = false
    await refresh()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function reindex(document: Row): Promise<void> {
  try {
    await api('knowledge:reindex', { id: document.id })
    await refresh()
  } catch (error) {
    appStore.notifyError(error)
  }
}

function askDelete(document: Row): void {
  deleting.value = document
  deleteOpen.value = true
}

async function confirmDelete(): Promise<void> {
  const target = deleting.value
  if (target === null) return
  try {
    await api('knowledge:delete', { id: target.id })
    appStore.notify('success', 'Documento removido da base de referências.')
    await refresh()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleteOpen.value = false
    deleting.value = null
  }
}
</script>

<template>
  <BaseCard padding="lg" data-testid="knowledge-card">
    <div class="mb-3 flex items-start justify-between gap-3">
      <SectionHeader
        title="Base de referências"
        :count="documents.length"
        size="sm"
        description="Normas, manuais de testes, artigos e resoluções que o assistente consulta para confirmar informações técnicas, citando o documento e a página."
      />
      <BaseButton
        variant="primary"
        size="sm"
        :loading="importing"
        :disabled="unavailable !== null"
        @click="importFiles"
      >
        Importar documentos
      </BaseButton>
    </div>

    <p class="mb-3 text-sm text-fg-muted">
      Aceita PDF (com texto selecionável), DOCX, TXT e Markdown. A indexação roda neste
      computador; na primeira vez, o app baixa o modelo de busca (cerca de 130 MB) e depois
      funciona sem internet.
    </p>

    <BaseAlert tone="warn" size="sm" class="mb-3">
      <strong>Não importe documentos com dados de pacientes.</strong> Os trechos que o
      assistente consulta são enviados ao provedor de IA junto com a conversa.
    </BaseAlert>

    <BaseAlert v-if="unavailable !== null" tone="danger" size="sm" class="mb-3">
      {{ unavailable }}
    </BaseAlert>

    <BaseEmptyState
      v-else-if="documents.length === 0"
      title="Nenhum documento de referência"
      message="Importe as normas e os manuais que você usa: o assistente passa a conferir as respostas neles."
    />

    <ul v-else class="divide-y divide-line">
      <li
        v-for="document in documents"
        :key="document.id"
        class="flex items-start gap-3 py-3"
        :data-testid="`knowledge-row-${document.id}`"
      >
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2">
            <span class="truncate text-sm font-semibold text-fg">{{ document.title }}</span>
            <BaseBadge :tone="STATUS_TONES[document.status]">
              {{ KNOWLEDGE_STATUS_LABELS[document.status] }}
            </BaseBadge>
            <BaseBadge v-if="document.needsReindex" tone="warn">precisa reindexar</BaseBadge>
          </p>
          <p class="mt-0.5 truncate text-sm text-fg-muted">{{ details(document) }}</p>
          <p v-if="document.error" class="mt-0.5 text-sm text-danger-strong">
            {{ document.error }}
          </p>
          <div v-if="progressFor(document)" class="mt-2 space-y-1">
            <p class="text-xs text-fg-muted">{{ progressFor(document)!.label }}</p>
            <BaseProgress
              :value="progressFor(document)!.percent ?? 0"
              :label="progressFor(document)!.label"
            />
          </div>
        </div>
        <BaseButton variant="link" size="sm" @click="askRename(document)">Renomear</BaseButton>
        <BaseButton
          v-if="document.status === 'failed' || document.needsReindex"
          variant="link"
          size="sm"
          @click="reindex(document)"
        >
          Reindexar
        </BaseButton>
        <BaseButton variant="link-danger" size="sm" @click="askDelete(document)">Excluir</BaseButton>
      </li>
    </ul>

    <BaseDialog v-model:open="renameOpen" title="Renomear documento">
      <form @submit.prevent="confirmRename">
        <BaseField
          id="knowledge-title"
          label="Título"
          hint="É o nome que o assistente usa ao citar o documento."
        >
          <BaseInput v-model="renameTitle" :maxlength="200" autocomplete="off" />
        </BaseField>
      </form>
      <template #footer>
        <BaseButton variant="secondary" @click="renameOpen = false">Cancelar</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="renameTitle.trim().length === 0"
          @click="confirmRename"
        >
          Salvar
        </BaseButton>
      </template>
    </BaseDialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Excluir documento de referência"
      :message="`“${deleting?.title ?? ''}” sai da base de referências e o assistente deixa de consultá-lo.`"
      confirm-label="Excluir"
      @confirm="confirmDelete"
    />
  </BaseCard>
</template>
