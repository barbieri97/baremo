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
import SectionHeader from './SectionHeader.vue'
import BaseCard from './BaseCard.vue'
import BaseBadge from './BaseBadge.vue'
import BaseEmptyState from './BaseEmptyState.vue'
import BaseTable, { type TableColumn } from './BaseTable.vue'
import BaseField from './BaseField.vue'
import BaseInput from './BaseInput.vue'
import BaseSelect from './BaseSelect.vue'
import { formatIsoDate } from '@shared/domain/dates'
import {
  DOCUMENT_ORIGIN_LABELS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS
} from '@shared/labels'
import type { DocumentType } from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'

const COLUMNS: TableColumn[] = [
  { key: 'title', label: 'Título' },
  { key: 'type', label: 'Tipo' },
  { key: 'status', label: 'Situação' },
  { key: 'origin', label: 'Origem' },
  { key: 'updated', label: 'Atualizado' },
  { key: 'actions', class: 'w-20' }
]

const STATUS_TONES = {
  draft: 'neutral',
  in_review: 'warn',
  finalized: 'ok'
} as const

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
    <SectionHeader title="Documentos" :count="documents.length" class="mb-2">
      <template #actions>
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
      </template>
    </SectionHeader>

    <BaseCard class="overflow-hidden">
      <BaseEmptyState v-if="loading" message="Carregando documentos…" />

      <BaseEmptyState
        v-else-if="documents.length === 0"
        message="Nenhum documento. Os modelos da Resolução CFP nº 06/2019 já vêm cadastrados."
      />

      <BaseTable v-else :columns="COLUMNS" density="comfortable">
        <tr
          v-for="document in documents"
          :key="document.id"
          class="cursor-pointer hover:bg-canvas"
          tabindex="0"
          @click="router.push(`/documentos/${document.id}`)"
          @keydown.enter="router.push(`/documentos/${document.id}`)"
        >
          <td class="font-medium text-fg">{{ document.title }}</td>
          <td class="text-fg-muted">{{ DOCUMENT_TYPE_LABELS[document.type] }}</td>
          <td>
            <BaseBadge :tone="STATUS_TONES[document.status]">
              {{ DOCUMENT_STATUS_LABELS[document.status] }}
            </BaseBadge>
          </td>
          <td class="text-xs text-fg-subtle">
            {{ DOCUMENT_ORIGIN_LABELS[document.origin] }}
          </td>
          <td class="tabular text-fg-muted">
            {{ formatIsoDate(document.updatedAt.slice(0, 10)) }}
          </td>
          <td class="text-right">
            <BaseButton
              variant="link-danger"
              size="sm"
              @click.stop="
                () => {
                  deleting = document
                  deleteOpen = true
                }
              "
            >
              Excluir
            </BaseButton>
          </td>
        </tr>
      </BaseTable>
    </BaseCard>

    <BaseDialog v-model:open="createOpen" title="Novo documento">
      <form class="space-y-4" @submit.prevent="create">
        <BaseField id="document-type" label="Tipo">
          <BaseSelect v-model="form.type" @change="onTypeChange">
            <option v-for="type in DOCUMENT_TYPES" :key="type" :value="type">
              {{ DOCUMENT_TYPE_LABELS[type] }}
            </option>
          </BaseSelect>
        </BaseField>

        <BaseField id="document-title" label="Título">
          <BaseInput v-model="form.title" :placeholder="DOCUMENT_TYPE_LABELS[form.type]" />
        </BaseField>

        <BaseField id="document-template" label="Modelo">
          <BaseSelect v-model="form.templateId">
            <option value="">Documento em branco</option>
            <option v-for="template in templates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </BaseSelect>
        </BaseField>
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
