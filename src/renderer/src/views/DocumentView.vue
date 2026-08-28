<script setup lang="ts">
/**
 * Editor de documentos (spec §9).
 *
 * Três comportamentos que a spec trata como requisito, não conveniência:
 *
 *  - autosave com debounce de 1,5 s, e recuperação a partir do último snapshot;
 *  - documento `finalizado` é somente leitura;
 *  - reabrir para edição cria uma versão nova e preserva a anterior — implicação
 *    jurídica: quem assinou precisa poder demonstrar o que assinou.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Editor, EditorContent } from '@tiptap/vue-3'
// TipTap 3 moveu os menus flutuantes para o subcaminho `/menus`.
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import BaseDialog from '../components/BaseDialog.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import SlashMenu from '../components/SlashMenu.vue'
import { buildExtensions } from '../editor/extensions'
import { createSlashMenu } from '../editor/slash-menu'
import type { SlashItem } from '../editor/slash-menu'
import { formatIsoDate } from '@shared/domain/dates'
import {
  DOCUMENT_ORIGIN_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  SIGNATURE_NOTICE_TYPES
} from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'
import type { BaremoDocument } from '@shared/contracts/entities'

const props = defineProps<{ id: string }>()

const router = useRouter()
const appStore = useAppStore()
const catalog = useCatalogStore()

const AUTOSAVE_DEBOUNCE_MS = 1500

const document = ref<BaremoDocument | null>(null)
const editor = shallowRef<Editor | null>(null)
const loading = ref(true)
const saveState = ref<'idle' | 'pending' | 'saving' | 'saved'>('idle')

const versionsOpen = ref(false)
const versions = ref<ChannelOutput<'documents:listVersions'>>([])
const signatureNoticeOpen = ref(false)

let autosaveTimer: ReturnType<typeof setTimeout> | undefined

// ─── Slash menu (§9.2) ──────────────────────────────────────────────────────

const slashItems = ref<SlashItem[]>([])
const slashPosition = ref<{ top: number; left: number } | null>(null)
const slashMenu = ref<InstanceType<typeof SlashMenu> | null>(null)
let pickSlashItem: ((item: SlashItem) => void) | null = null

function positionFrom(clientRect?: (() => DOMRect | null) | null): void {
  const rect = clientRect?.()
  slashPosition.value = rect ? { top: rect.bottom + 6, left: rect.left } : null
}

function closeSlashMenu(): void {
  slashPosition.value = null
  slashItems.value = []
  pickSlashItem = null
}

function onSlashPick(item: SlashItem): void {
  pickSlashItem?.(item)
}

const readOnly = computed(() => document.value?.status === 'finalized')

const needsReview = computed(
  () =>
    document.value !== null &&
    document.value.origin === 'assisted_by_ai' &&
    document.value.reviewedAt === null
)

async function load(): Promise<void> {
  loading.value = true
  try {
    await catalog.load()
    document.value = await api('documents:get', { id: props.id })

    editor.value = new Editor({
      content: (document.value.contentJson as object) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      editable: !readOnly.value,
      extensions: [
        ...buildExtensions({
          placeholder: 'Escreva o documento. Use / para inserir blocos e tokens.'
        }),
        createSlashMenu({ assessmentId: document.value.assessmentId }, () => ({
          onStart: ({ items, command, clientRect }) => {
            slashItems.value = items
            pickSlashItem = command
            positionFrom(clientRect)
          },
          onUpdate: ({ items, clientRect }) => {
            slashItems.value = items
            positionFrom(clientRect)
          },
          onKeyDown: ({ event }) => {
            if (event.key === 'Escape') {
              closeSlashMenu()
              return true
            }
            return slashMenu.value?.handleKey(event) ?? false
          },
          onExit: closeSlashMenu
        }))
      ],
      editorProps: { attributes: { class: 'tiptap' } },
      onUpdate: scheduleAutosave
    })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)

onBeforeUnmount(() => {
  clearTimeout(autosaveTimer)
  // Grava o que estiver pendente antes de sair: sair da tela não pode custar o
  // último trecho digitado.
  if (saveState.value === 'pending') void persist()
  editor.value?.destroy()
})

function scheduleAutosave(): void {
  if (readOnly.value) return
  saveState.value = 'pending'
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(persist, AUTOSAVE_DEBOUNCE_MS)
}

async function persist(): Promise<void> {
  if (editor.value === null || document.value === null || readOnly.value) return

  saveState.value = 'saving'
  try {
    await api('documents:saveContent', {
      id: props.id,
      contentJson: editor.value.getJSON()
    })
    saveState.value = 'saved'
  } catch (error) {
    saveState.value = 'pending'
    appStore.notifyError(error)
  }
}

watch(readOnly, (value) => editor.value?.setEditable(!value))

async function setStatus(status: 'draft' | 'in_review' | 'finalized'): Promise<void> {
  if (document.value === null) return

  // Finalizar grava o conteúdo pendente antes: sem isso, a versão finalizada
  // seria o penúltimo estado do texto.
  if (saveState.value === 'pending') await persist()

  try {
    document.value = await api('documents:setStatus', { id: props.id, status })

    if (status === 'finalized') {
      appStore.notify('success', 'Documento finalizado. Ele agora é somente leitura.')
    } else {
      appStore.notify('info', 'Documento reaberto para edição. A versão anterior foi preservada.')
    }
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function markReviewed(): Promise<void> {
  try {
    document.value = await api('documents:markReviewed', { id: props.id })
    appStore.notify('success', 'Revisão registrada.')
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function openVersions(): Promise<void> {
  try {
    versions.value = await api('documents:listVersions', { documentId: props.id })
    versionsOpen.value = true
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function restore(versionId: string): Promise<void> {
  try {
    document.value = await api('documents:restoreVersion', { documentId: props.id, versionId })
    editor.value?.commands.setContent((document.value.contentJson as object) ?? {})
    versionsOpen.value = false
    appStore.notify('success', 'Versão restaurada. O conteúdo anterior foi preservado no histórico.')
  } catch (error) {
    appStore.notifyError(error)
  }
}

function requestExport(): void {
  if (document.value === null) return

  if (SIGNATURE_NOTICE_TYPES.includes(document.value.type)) {
    signatureNoticeOpen.value = true
    return
  }
  void exportPdf()
}

async function exportPdf(): Promise<void> {
  signatureNoticeOpen.value = false
  if (saveState.value === 'pending') await persist()

  try {
    const result = await api('reports:generate', {
      kind: 'document',
      assessmentId: null,
      comparisonAssessmentId: null,
      documentId: props.id
    })
    if (!result.cancelled) appStore.notify('success', 'PDF gerado.')
  } catch (error) {
    appStore.notifyError(error)
  }
}

const VERSION_REASON_LABELS: Record<string, string> = {
  autosave: 'Salvamento automático',
  finalized: 'Finalização',
  reopened: 'Reabertura para edição'
}

const saveLabel = computed(() => {
  switch (saveState.value) {
    case 'pending':
      return 'Alterações não salvas'
    case 'saving':
      return 'Salvando…'
    case 'saved':
      return 'Salvo'
    default:
      return ''
  }
})
</script>

<template>
  <div v-if="loading" class="p-6 text-sm text-ink-500">Carregando documento…</div>

  <div v-else-if="document === null" class="p-6 text-sm text-ink-500">
    Documento não encontrado.
  </div>

  <div v-else class="flex h-full flex-col">
    <header class="border-b border-ink-200 bg-white px-6 py-3">
      <div class="flex items-start justify-between gap-6">
        <div>
          <button
            class="text-xs text-ink-500 hover:underline"
            @click="router.push(`/pacientes/${document.patientId}`)"
          >
            ← Prontuário
          </button>
          <h1 class="mt-1 text-lg font-bold text-ink-800">{{ document.title }}</h1>
          <p class="mt-0.5 text-xs text-ink-500">
            {{ DOCUMENT_TYPE_LABELS[document.type] }} ·
            {{ DOCUMENT_STATUS_LABELS[document.status] }} ·
            {{ DOCUMENT_ORIGIN_LABELS[document.origin] }}
            <span v-if="saveLabel" class="ml-2">· {{ saveLabel }}</span>
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-end gap-2">
          <BaseButton size="sm" @click="openVersions">Histórico</BaseButton>
          <BaseButton size="sm" @click="requestExport">Exportar PDF</BaseButton>

          <BaseButton
            v-if="needsReview"
            size="sm"
            variant="secondary"
            @click="markReviewed"
          >
            Registrar revisão
          </BaseButton>

          <BaseButton
            v-if="!readOnly"
            size="sm"
            variant="primary"
            :disabled="needsReview"
            :title="
              needsReview
                ? 'Documento assistido por IA precisa de revisão explícita antes de ser finalizado.'
                : undefined
            "
            @click="setStatus('finalized')"
          >
            Finalizar
          </BaseButton>
          <BaseButton v-else size="sm" @click="setStatus('draft')">Reabrir para edição</BaseButton>
        </div>
      </div>

      <div
        v-if="needsReview"
        class="mt-3 rounded border border-warn-200 bg-warn-50 px-3 py-2 text-xs text-warn-700"
      >
        Este documento foi redigido com auxílio de IA. A responsabilidade técnica é integralmente
        do profissional que assina — registre a revisão antes de finalizá-lo. A marcação é interna:
        o PDF exportado não estampa nada sobre uso de IA.
      </div>

      <div
        v-if="readOnly"
        class="mt-3 rounded border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600"
      >
        Documento finalizado em
        {{ document.finalizedAt !== null ? formatIsoDate(document.finalizedAt.slice(0, 10)) : '' }}
        e somente leitura. Reabrir cria uma nova versão e preserva a atual no histórico.
      </div>
    </header>

    <EditorToolbar
      v-if="editor !== null && !readOnly"
      :editor="editor"
      :assessment-id="document.assessmentId"
    />

    <div class="flex-1 overflow-y-auto bg-ink-100 px-6 py-6">
      <div class="mx-auto max-w-3xl rounded-lg bg-white p-10 shadow-sm">
        <BubbleMenu
          v-if="editor !== null && !readOnly"
          :editor="editor"
          class="flex gap-1 rounded-md border border-ink-300 bg-white p-1 shadow-lg"
        >
          <button
            class="rounded px-2 py-1 text-xs font-semibold hover:bg-ink-100"
            :class="{ 'bg-ink-200': editor.isActive('bold') }"
            @click="editor.chain().focus().toggleBold().run()"
          >
            N
          </button>
          <button
            class="rounded px-2 py-1 text-xs italic hover:bg-ink-100"
            :class="{ 'bg-ink-200': editor.isActive('italic') }"
            @click="editor.chain().focus().toggleItalic().run()"
          >
            I
          </button>
          <button
            class="rounded px-2 py-1 text-xs underline hover:bg-ink-100"
            :class="{ 'bg-ink-200': editor.isActive('underline') }"
            @click="editor.chain().focus().toggleUnderline().run()"
          >
            S
          </button>
          <button
            class="rounded px-2 py-1 text-xs hover:bg-ink-100"
            :class="{ 'bg-ink-200': editor.isActive('highlight') }"
            @click="editor.chain().focus().toggleHighlight().run()"
          >
            Marcar
          </button>
        </BubbleMenu>

        <EditorContent v-if="editor !== null" :editor="editor" />

        <SlashMenu
          ref="slashMenu"
          :items="slashItems"
          :position="slashPosition"
          @pick="onSlashPick"
        />
      </div>
    </div>

    <BaseDialog v-model:open="versionsOpen" title="Histórico de versões" wide>
      <p v-if="versions.length === 0" class="text-sm text-ink-500">
        Nenhuma versão registrada ainda. Snapshots são criados a cada finalização e a cada dez
        minutos de edição ativa.
      </p>

      <ul v-else class="divide-y divide-ink-200">
        <li v-for="version in versions" :key="version.id" class="flex items-center gap-4 py-2">
          <div class="flex-1">
            <p class="text-sm text-ink-800">
              {{ VERSION_REASON_LABELS[version.reason] ?? version.reason }}
            </p>
            <p class="text-xs text-ink-500">
              {{ new Date(version.createdAt).toLocaleString('pt-BR') }}
            </p>
          </div>
          <BaseButton size="sm" :disabled="readOnly" @click="restore(version.id)">
            Restaurar
          </BaseButton>
        </li>
      </ul>
    </BaseDialog>

    <BaseDialog
      v-model:open="signatureNoticeOpen"
      title="Assinatura digital não incluída"
      description="Res. CFP nº 11/2018"
    >
      <p class="text-sm text-ink-700">
        O Baremo não implementa assinatura digital ICP-Brasil. Documentos psicológicos em meio
        eletrônico exigem essa assinatura para ter validade.
      </p>
      <p class="mt-3 text-sm text-ink-700">
        Exporte o PDF e assine externamente — no
        <strong>gov.br</strong> ou no <strong>Assinador ITI</strong> — antes de entregá-lo.
      </p>

      <template #footer>
        <BaseButton variant="ghost" @click="signatureNoticeOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" @click="exportPdf">Entendi, exportar PDF</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
