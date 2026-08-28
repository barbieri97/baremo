<script setup lang="ts">
/**
 * Anexos do prontuário (spec §8).
 *
 * O drag-and-drop usa `webUtils.getPathForFile` exposto pelo preload — `File.path`
 * não existe mais no Electron (§8.4). O caminho obtido segue direto para o
 * processo principal, que valida tipo real por magic number e copia por stream.
 * Depois disso o renderer só trafega IDs.
 */
import { computed, onMounted, ref } from 'vue'
import { api, pathForFile } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import AttachmentPreview from './AttachmentPreview.vue'
import { formatIsoDate } from '@shared/domain/dates'
import type { Attachment } from '@shared/contracts/entities'

const props = defineProps<{
  patientId: string
  assessmentId: string | null
}>()

const appStore = useAppStore()

const attachments = ref<Attachment[]>([])
const loading = ref(false)
const dragging = ref(false)
const quota = ref<{ totalBytes: number; warnAboveBytes: number } | null>(null)

const previewing = ref<Attachment | null>(null)
const editing = ref<Attachment | null>(null)
const editForm = ref({ description: '', tags: '' })
const deleting = ref<Attachment | null>(null)
const deleteOpen = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    attachments.value = await api('attachments:list', {
      patientId: props.patientId,
      assessmentId: props.assessmentId,
      includeArchived: false
    })
    quota.value = await api('attachments:quota')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function reportIngest(result: { added: unknown[]; rejected: { name: string; reason: string }[] }): void {
  if (result.added.length > 0) {
    appStore.notify('success', `${result.added.length} arquivo(s) anexado(s).`)
  }
  for (const rejected of result.rejected) {
    appStore.notify('warning', `${rejected.name}: ${rejected.reason}`)
  }
}

async function pickFiles(): Promise<void> {
  try {
    const result = await api('attachments:pickAndAdd', {
      patientId: props.patientId,
      assessmentId: props.assessmentId
    })
    reportIngest(result)
    await load()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false

  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length === 0) return

  try {
    const paths = files.map(pathForFile).filter((path) => path.length > 0)
    if (paths.length === 0) {
      appStore.notify('warning', 'Não foi possível ler os arquivos arrastados.')
      return
    }

    const result = await api('attachments:addFromPaths', {
      patientId: props.patientId,
      assessmentId: props.assessmentId,
      paths
    })
    reportIngest(result)
    await load()
  } catch (error) {
    appStore.notifyError(error)
  }
}

function openEdit(attachment: Attachment): void {
  editing.value = attachment
  editForm.value = {
    description: attachment.description ?? '',
    tags: attachment.tags.join(', ')
  }
}

async function saveEdit(): Promise<void> {
  if (editing.value === null) return
  try {
    await api('attachments:update', {
      id: editing.value.id,
      description: editForm.value.description.trim() || null,
      tags: editForm.value.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
      assessmentId: editing.value.assessmentId
    })
    editing.value = null
    await load()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmDelete(): Promise<void> {
  if (deleting.value === null) return
  try {
    await api('attachments:delete', { id: deleting.value.id })
    appStore.notify('success', 'Arquivo excluído.')
    await load()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleteOpen.value = false
    deleting.value = null
  }
}

async function openExternal(attachment: Attachment): Promise<void> {
  try {
    await api('attachments:openExternal', { id: attachment.id })
  } catch (error) {
    appStore.notifyError(error)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Tipos com visualização interna; o resto abre no app do sistema (§8.5). */
function hasInternalPreview(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('audio/') || mime === 'application/pdf'
}

const overQuota = computed(
  () => quota.value !== null && quota.value.totalBytes > quota.value.warnAboveBytes
)
</script>

<template>
  <section>
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-base font-semibold text-ink-800">
        Arquivos
        <span class="ml-1 text-sm font-normal text-ink-500">({{ attachments.length }})</span>
      </h2>
      <BaseButton size="sm" @click="pickFiles">Anexar arquivo</BaseButton>
    </div>

    <p v-if="overQuota" class="mb-2 text-xs text-warn-700">
      O armazenamento de anexos já ocupa {{ formatSize(quota!.totalBytes) }}. Considere revisar os
      arquivos antigos na tela de manutenção.
    </p>

    <div
      class="card p-3"
      :class="dragging ? 'border-brand-500 bg-brand-50' : ''"
      @dragover.prevent="dragging = true"
      @dragleave="dragging = false"
      @drop.prevent="onDrop"
    >
      <p v-if="loading" class="py-6 text-center text-sm text-ink-400">Carregando arquivos…</p>

      <p v-else-if="attachments.length === 0" class="py-6 text-center text-sm text-ink-400">
        Arraste arquivos aqui ou use "Anexar arquivo". Aceitos: PDF, PNG, JPEG, WebP, DOCX, XLSX,
        CSV, TXT, MP3, M4A, WAV e MP4, até 100 MB cada.
      </p>

      <ul v-else class="divide-y divide-ink-200">
        <li
          v-for="attachment in attachments"
          :key="attachment.id"
          class="flex items-center gap-3 py-2"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-ink-800">{{ attachment.originalName }}</p>
            <p class="text-xs text-ink-500">
              {{ attachment.detectedMime }} · {{ formatSize(attachment.sizeBytes) }} ·
              {{ formatIsoDate(attachment.createdAt.slice(0, 10)) }}
              <span v-if="attachment.description"> · {{ attachment.description }}</span>
            </p>
            <div v-if="attachment.tags.length > 0" class="mt-1 flex flex-wrap gap-1">
              <span
                v-for="tag in attachment.tags"
                :key="tag"
                class="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600"
              >
                {{ tag }}
              </span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <button
              v-if="hasInternalPreview(attachment.detectedMime)"
              class="text-xs text-brand-500 hover:underline"
              @click="previewing = attachment"
            >
              Visualizar
            </button>
            <button
              v-else
              class="text-xs text-brand-500 hover:underline"
              title="Abre no aplicativo padrão do sistema"
              @click="openExternal(attachment)"
            >
              Abrir externamente
            </button>
            <button class="text-xs text-ink-500 hover:underline" @click="openEdit(attachment)">
              Editar
            </button>
            <button
              class="text-xs text-danger-500 hover:underline"
              @click="
                () => {
                  deleting = attachment
                  deleteOpen = true
                }
              "
            >
              Excluir
            </button>
          </div>
        </li>
      </ul>
    </div>

    <AttachmentPreview
      v-if="previewing !== null"
      :attachment="previewing"
      @close="previewing = null"
    />

    <BaseDialog
      :open="editing !== null"
      title="Editar arquivo"
      @update:open="(value) => !value && (editing = null)"
    >
      <div class="space-y-4">
        <div>
          <label class="field-label" for="attachment-description">Descrição</label>
          <textarea
            id="attachment-description"
            v-model="editForm.description"
            class="field-input min-h-20"
          />
        </div>
        <div>
          <label class="field-label" for="attachment-tags">Tags</label>
          <input
            id="attachment-tags"
            v-model="editForm.tags"
            class="field-input"
            placeholder="Separadas por vírgula"
          />
        </div>
      </div>

      <template #footer>
        <BaseButton variant="ghost" @click="editing = null">Cancelar</BaseButton>
        <BaseButton variant="primary" @click="saveEdit">Salvar</BaseButton>
      </template>
    </BaseDialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Excluir arquivo"
      :message="`O arquivo &quot;${deleting?.originalName ?? ''}&quot; será removido do prontuário. O conteúdo é apagado do disco se nenhum outro registro o utilizar.`"
      confirm-label="Excluir"
      @confirm="confirmDelete"
    />
  </section>
</template>
