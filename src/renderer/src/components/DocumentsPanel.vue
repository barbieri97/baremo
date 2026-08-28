<script setup lang="ts">
/**
 * Documentos do prontuário (spec §9).
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from './BaseButton.vue'
import BaseDialog from './BaseDialog.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { formatIsoDate } from '@shared/domain/dates'
import {
  DOCUMENT_ORIGIN_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS
} from '@shared/labels'
import type { DocumentType } from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'

const props = defineProps<{
  patientId: string
  assessmentId: string | null
}>()

const router = useRouter()
const appStore = useAppStore()

type DocumentRow = ChannelOutput<'documents:list'>[number]
type Template = ChannelOutput<'documents:listTemplates'>[number]

const documents = ref<DocumentRow[]>([])
const templates = ref<Template[]>([])
const loading = ref(false)

const createOpen = ref(false)
const creating = ref(false)
const form = ref({ title: '', type: 'psychological_report' as DocumentType, templateId: '' })

const deleting = ref<DocumentRow | null>(null)
const deleteOpen = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    documents.value = await api('documents:list', {
      patientId: props.patientId,
      assessmentId: props.assessmentId
    })
    templates.value = await api('documents:listTemplates')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** Ao escolher o tipo, sugere o modelo correspondente — é o que se quer 9 em 10 vezes. */
function onTypeChange(): void {
  const match = templates.value.find((template) => template.type === form.value.type)
  form.value.templateId = match?.id ?? ''
}

async function create(): Promise<void> {
  creating.value = true
  try {
    const created = await api('documents:create', {
      patientId: props.patientId,
      assessmentId: props.assessmentId,
      type: form.value.type,
      title: form.value.title.trim() || DOCUMENT_TYPE_LABELS[form.value.type],
      templateId: form.value.templateId === '' ? null : form.value.templateId
    })
    createOpen.value = false
    await router.push(`/documentos/${created.id}`)
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    creating.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (deleting.value === null) return
  try {
    await api('documents:delete', { id: deleting.value.id })
    appStore.notify('success', 'Documento excluído.')
    await load()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleteOpen.value = false
    deleting.value = null
  }
}
</script>

<template>
  <section>
    <div class="mb-2 flex items-center justify-between">
      <h2 class="text-base font-semibold text-ink-800">
        Documentos
        <span class="ml-1 text-sm font-normal text-ink-500">({{ documents.length }})</span>
      </h2>
      <BaseButton
        size="sm"
        @click="
          () => {
            onTypeChange()
            createOpen = true
          }
        "
      >
        Novo documento
      </BaseButton>
    </div>

    <div class="card overflow-hidden">
      <p v-if="loading" class="py-6 text-center text-sm text-ink-400">Carregando documentos…</p>

      <p v-else-if="documents.length === 0" class="py-6 text-center text-sm text-ink-400">
        Nenhum documento. Os modelos da Resolução CFP nº 06/2019 já vêm cadastrados.
      </p>

      <table v-else class="w-full text-sm">
        <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th class="px-4 py-2 text-left font-semibold">Título</th>
            <th class="px-4 py-2 text-left font-semibold">Tipo</th>
            <th class="px-4 py-2 text-left font-semibold">Situação</th>
            <th class="px-4 py-2 text-left font-semibold">Origem</th>
            <th class="px-4 py-2 text-left font-semibold">Atualizado</th>
            <th class="w-20 px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="document in documents"
            :key="document.id"
            class="cursor-pointer border-t border-ink-200 hover:bg-ink-50"
            tabindex="0"
            @click="router.push(`/documentos/${document.id}`)"
            @keydown.enter="router.push(`/documentos/${document.id}`)"
          >
            <td class="px-4 py-2.5 font-medium text-ink-800">{{ document.title }}</td>
            <td class="px-4 py-2.5 text-ink-600">{{ DOCUMENT_TYPE_LABELS[document.type] }}</td>
            <td class="px-4 py-2.5">
              <span
                class="rounded px-2 py-0.5 text-xs font-medium"
                :class="{
                  'bg-ink-100 text-ink-600': document.status === 'draft',
                  'bg-warn-50 text-warn-700': document.status === 'in_review',
                  'bg-ok-50 text-ok-500': document.status === 'finalized'
                }"
              >
                {{ DOCUMENT_STATUS_LABELS[document.status] }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-xs text-ink-500">
              {{ DOCUMENT_ORIGIN_LABELS[document.origin] }}
            </td>
            <td class="px-4 py-2.5 tabular text-ink-600">
              {{ formatIsoDate(document.updatedAt.slice(0, 10)) }}
            </td>
            <td class="px-4 py-2.5 text-right">
              <button
                class="text-xs text-danger-500 hover:underline"
                @click.stop="
                  () => {
                    deleting = document
                    deleteOpen = true
                  }
                "
              >
                Excluir
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <BaseDialog v-model:open="createOpen" title="Novo documento">
      <form class="space-y-4" @submit.prevent="create">
        <div>
          <label class="field-label" for="document-type">Tipo</label>
          <select id="document-type" v-model="form.type" class="field-input" @change="onTypeChange">
            <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">
              {{ DOCUMENT_TYPE_LABELS[type] }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="document-title">Título</label>
          <input
            id="document-title"
            v-model="form.title"
            class="field-input"
            :placeholder="DOCUMENT_TYPE_LABELS[form.type]"
          />
        </div>

        <div>
          <label class="field-label" for="document-template">Modelo</label>
          <select id="document-template" v-model="form.templateId" class="field-input">
            <option value="">Documento em branco</option>
            <option v-for="template in templates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </select>
        </div>
      </form>

      <template #footer>
        <BaseButton variant="ghost" @click="createOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" :loading="creating" @click="create">Criar</BaseButton>
      </template>
    </BaseDialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Excluir documento"
      :message="`O documento &quot;${deleting?.title ?? ''}&quot; e todo o seu histórico de versões serão removidos.`"
      confirm-label="Excluir"
      @confirm="confirmDelete"
    />
  </section>
</template>
