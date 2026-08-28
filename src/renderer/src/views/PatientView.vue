<script setup lang="ts">
/**
 * Ficha do paciente: avaliações, arquivos, documentos e ações do prontuário.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api, errorMessage } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from '../components/BaseButton.vue'
import BaseDialog from '../components/BaseDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PatientFormDialog from '../components/PatientFormDialog.vue'
import AttachmentsPanel from '../components/AttachmentsPanel.vue'
import DocumentsPanel from '../components/DocumentsPanel.vue'
import { ageAt, formatAge, formatIsoDate, today } from '@shared/domain/dates'
import { HANDEDNESS_LABELS, SEX_LABELS } from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'
import type { Patient } from '@shared/contracts/entities'

const props = defineProps<{ id: string }>()

const router = useRouter()
const appStore = useAppStore()

type AssessmentRow = ChannelOutput<'assessments:listByPatient'>[number]

const patient = ref<Patient | null>(null)
const assessments = ref<AssessmentRow[]>([])
const loading = ref(true)

const editOpen = ref(false)
const deleteOpen = ref(false)
const deleting = ref(false)
const impact = ref<ChannelOutput<'patients:impact'> | null>(null)

const assessmentOpen = ref(false)
const assessmentForm = ref({ date: today(), referralReason: '', complaint: '' })
const savingAssessment = ref(false)

const comparisonOpen = ref(false)
const comparisonA = ref('')
const comparisonB = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    patient.value = await api('patients:get', { id: props.id })
    assessments.value = await api('assessments:listByPatient', {
      patientId: props.id,
      includeArchived: true
    })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const age = computed(() => {
  if (patient.value?.birthDate == null) return '—'
  const value = ageAt(patient.value.birthDate, today())
  return value !== null ? formatAge(value) : '—'
})

async function toggleArchived(): Promise<void> {
  if (patient.value === null) return
  try {
    patient.value = await api('patients:setArchived', {
      id: props.id,
      archived: patient.value.archivedAt === null
    })
    appStore.notify('success', patient.value.archivedAt === null ? 'Paciente reativado.' : 'Paciente arquivado.')
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function openDelete(): Promise<void> {
  try {
    impact.value = await api('patients:impact', { id: props.id })
    deleteOpen.value = true
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmDelete(): Promise<void> {
  if (patient.value === null) return
  deleting.value = true
  try {
    await api('patients:delete', { id: props.id, confirmationName: patient.value.fullName })
    appStore.notify('success', 'Prontuário excluído definitivamente.')
    await router.push('/pacientes')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleting.value = false
    deleteOpen.value = false
  }
}

async function createAssessment(): Promise<void> {
  savingAssessment.value = true
  try {
    const created = await api('assessments:create', {
      input: {
        patientId: props.id,
        date: assessmentForm.value.date,
        referralReason: assessmentForm.value.referralReason.trim() || null,
        complaint: assessmentForm.value.complaint.trim() || null,
        notes: null
      }
    })
    assessmentOpen.value = false
    await router.push(`/avaliacoes/${created.id}`)
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    savingAssessment.value = false
  }
}

async function exportRecord(): Promise<void> {
  try {
    const result = await api('maintenance:exportMedicalRecord', { patientId: props.id })
    if (!result.cancelled) {
      appStore.notify('success', `Prontuário exportado para ${result.filePath}`)
    }
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function generateComparison(): Promise<void> {
  try {
    const result = await api('reports:generate', {
      kind: 'comparative',
      assessmentId: comparisonA.value,
      comparisonAssessmentId: comparisonB.value,
      documentId: null
    })
    comparisonOpen.value = false
    if (!result.cancelled) appStore.notify('success', 'Relatório comparativo gerado.')
  } catch (error) {
    appStore.notify('error', errorMessage(error))
  }
}
</script>

<template>
  <div v-if="loading" class="p-6 text-sm text-ink-500">Carregando prontuário…</div>

  <div v-else-if="patient === null" class="p-6 text-sm text-ink-500">
    Paciente não encontrado.
  </div>

  <div v-else class="p-6">
    <header class="mb-6 flex items-start justify-between gap-6">
      <div>
        <button class="text-xs text-ink-500 hover:underline" @click="router.push('/pacientes')">
          ← Pacientes
        </button>
        <h1 class="mt-1 text-xl font-bold text-ink-800">
          {{ patient.fullName }}
          <span
            v-if="patient.archivedAt !== null"
            class="ml-2 rounded bg-ink-200 px-2 py-0.5 align-middle text-xs font-medium text-ink-600"
          >
            Arquivado
          </span>
        </h1>
        <p class="mt-1 text-sm text-ink-500">
          {{ age }} ·
          {{ patient.birthDate !== null ? formatIsoDate(patient.birthDate) : 'nascimento não informado' }} ·
          {{ SEX_LABELS[patient.sex] }} · {{ HANDEDNESS_LABELS[patient.handedness] }}
        </p>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <BaseButton size="sm" @click="editOpen = true">Editar</BaseButton>
        <BaseButton size="sm" @click="exportRecord">Exportar prontuário</BaseButton>
        <BaseButton
          v-if="assessments.length >= 2"
          size="sm"
          @click="comparisonOpen = true"
        >
          Comparar avaliações
        </BaseButton>
        <BaseButton size="sm" @click="router.push(`/pacientes/${id}/assistente`)">
          Assistente
        </BaseButton>
        <BaseButton size="sm" @click="toggleArchived">
          {{ patient.archivedAt === null ? 'Arquivar' : 'Reativar' }}
        </BaseButton>
        <BaseButton size="sm" variant="danger" @click="openDelete">Excluir</BaseButton>
      </div>
    </header>

    <section class="mb-6">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-base font-semibold text-ink-800">Avaliações</h2>
        <BaseButton size="sm" variant="primary" @click="assessmentOpen = true">
          Nova avaliação
        </BaseButton>
      </div>

      <div class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th class="px-4 py-2 text-left font-semibold">Data</th>
              <th class="px-4 py-2 text-left font-semibold">Motivo do encaminhamento</th>
              <th class="px-4 py-2 text-right font-semibold">Resultados</th>
              <th class="px-4 py-2 text-left font-semibold">Situação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="assessments.length === 0">
              <td colspan="4" class="px-4 py-8 text-center text-ink-400">
                Nenhuma avaliação registrada. Um reteste é sempre uma nova avaliação — é o que
                permite a comparação longitudinal.
              </td>
            </tr>
            <tr
              v-for="assessment in assessments"
              :key="assessment.id"
              class="cursor-pointer border-t border-ink-200 hover:bg-ink-50"
              tabindex="0"
              @click="router.push(`/avaliacoes/${assessment.id}`)"
              @keydown.enter="router.push(`/avaliacoes/${assessment.id}`)"
            >
              <td class="px-4 py-2.5 tabular font-medium text-ink-800">
                {{ formatIsoDate(assessment.date) }}
              </td>
              <td class="px-4 py-2.5 text-ink-600">{{ assessment.referralReason ?? '—' }}</td>
              <td class="px-4 py-2.5 text-right tabular text-ink-600">
                {{ assessment.resultCount }}
              </td>
              <td class="px-4 py-2.5">
                <span v-if="assessment.archivedAt !== null" class="text-xs text-ink-500">
                  Arquivada
                </span>
                <span v-else class="text-xs text-ink-400">Ativa</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <DocumentsPanel :patient-id="id" :assessment-id="null" class="mb-6" />
    <AttachmentsPanel :patient-id="id" :assessment-id="null" />

    <PatientFormDialog
      v-model:open="editOpen"
      :patient="patient"
      @saved="(saved) => (patient = saved)"
    />

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Excluir prontuário definitivamente"
      :message="`Esta ação remove o prontuário de ${patient.fullName}, todas as avaliações, resultados, documentos e arquivos anexados. Arquivar mantém o registro disponível para consulta e é reversível.`"
      :impact="impact"
      :require-typing="patient.fullName"
      confirm-label="Excluir definitivamente"
      :busy="deleting"
      @confirm="confirmDelete"
    />

    <BaseDialog v-model:open="assessmentOpen" title="Nova avaliação">
      <form class="space-y-4" @submit.prevent="createAssessment">
        <div>
          <label class="field-label" for="assessment-date">Data da avaliação</label>
          <input
            id="assessment-date"
            v-model="assessmentForm.date"
            type="date"
            class="field-input"
            required
          />
        </div>
        <div>
          <label class="field-label" for="assessment-reason">Motivo do encaminhamento</label>
          <textarea
            id="assessment-reason"
            v-model="assessmentForm.referralReason"
            class="field-input min-h-20"
          />
        </div>
        <div>
          <label class="field-label" for="assessment-complaint">Queixa</label>
          <textarea
            id="assessment-complaint"
            v-model="assessmentForm.complaint"
            class="field-input min-h-20"
          />
        </div>
      </form>

      <template #footer>
        <BaseButton variant="ghost" @click="assessmentOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" :loading="savingAssessment" @click="createAssessment">
          Criar avaliação
        </BaseButton>
      </template>
    </BaseDialog>

    <BaseDialog
      v-model:open="comparisonOpen"
      title="Relatório comparativo"
      description="Compara duas avaliações deste paciente, pareando por instrumento e tipo de escore."
    >
      <div class="space-y-4">
        <div>
          <label class="field-label" for="comparison-a">Avaliação A</label>
          <select id="comparison-a" v-model="comparisonA" class="field-input">
            <option value="">Selecione…</option>
            <option v-for="item in assessments" :key="item.id" :value="item.id">
              {{ formatIsoDate(item.date) }} — {{ item.resultCount }} resultado(s)
            </option>
          </select>
        </div>
        <div>
          <label class="field-label" for="comparison-b">Avaliação B</label>
          <select id="comparison-b" v-model="comparisonB" class="field-input">
            <option value="">Selecione…</option>
            <option v-for="item in assessments" :key="item.id" :value="item.id">
              {{ formatIsoDate(item.date) }} — {{ item.resultCount }} resultado(s)
            </option>
          </select>
        </div>
      </div>

      <template #footer>
        <BaseButton variant="ghost" @click="comparisonOpen = false">Cancelar</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="comparisonA === '' || comparisonB === '' || comparisonA === comparisonB"
          @click="generateComparison"
        >
          Gerar PDF
        </BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
