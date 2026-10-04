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
import PageHeader from '../components/PageHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import BaseBadge from '../components/BaseBadge.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import BaseField from '../components/BaseField.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import BaseTextarea from '../components/BaseTextarea.vue'
import { ageAt, formatAge, formatIsoDate, today } from '@shared/domain/dates'
import { HANDEDNESS_LABELS, SEX_LABELS } from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'
import type { Patient } from '@shared/contracts/entities'

const ASSESSMENT_COLUMNS: TableColumn[] = [
  { key: 'date', label: 'Data' },
  { key: 'reason', label: 'Motivo do encaminhamento' },
  { key: 'results', label: 'Resultados', align: 'right' },
  { key: 'status', label: 'Situação' }
]

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
    appStore.notify(
      'success',
      patient.value.archivedAt === null ? 'Paciente reativado.' : 'Paciente arquivado.'
    )
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
  <div v-if="loading" class="p-6 text-sm text-fg-subtle">Carregando prontuário…</div>

  <div v-else-if="patient === null" class="p-6 text-sm text-fg-subtle">
    Paciente não encontrado.
  </div>

  <div v-else class="p-6">
    <PageHeader :back="{ label: 'Pacientes', to: '/pacientes' }" class="mb-6">
      <template #title>
        {{ patient.fullName }}
        <BaseBadge v-if="patient.archivedAt !== null" class="ml-2">Arquivado</BaseBadge>
      </template>
      <template #subtitle>
        {{ age }} ·
        {{
          patient.birthDate !== null ? formatIsoDate(patient.birthDate) : 'nascimento não informado'
        }}
        · {{ SEX_LABELS[patient.sex] }} · {{ HANDEDNESS_LABELS[patient.handedness] }}
      </template>
      <template #actions>
        <BaseButton size="sm" @click="editOpen = true">Editar</BaseButton>
        <BaseButton size="sm" @click="exportRecord">Exportar prontuário</BaseButton>
        <BaseButton v-if="assessments.length >= 2" size="sm" @click="comparisonOpen = true">
          Comparar avaliações
        </BaseButton>
        <BaseButton size="sm" @click="router.push(`/pacientes/${id}/assistente`)">
          Assistente
        </BaseButton>
        <BaseButton size="sm" @click="toggleArchived">
          {{ patient.archivedAt === null ? 'Arquivar' : 'Reativar' }}
        </BaseButton>
        <BaseButton size="sm" variant="danger" @click="openDelete">Excluir</BaseButton>
      </template>
    </PageHeader>

    <section class="mb-6">
      <SectionHeader title="Avaliações" class="mb-2">
        <template #actions>
          <BaseButton size="sm" variant="primary" @click="assessmentOpen = true">
            Nova avaliação
          </BaseButton>
        </template>
      </SectionHeader>

      <BaseCard class="overflow-hidden">
        <BaseTable
          :columns="ASSESSMENT_COLUMNS"
          density="comfortable"
          :empty-text="
            assessments.length === 0
              ? 'Nenhuma avaliação registrada. Um reteste é sempre uma nova avaliação — é o que permite a comparação longitudinal.'
              : null
          "
        >
          <tr
            v-for="assessment in assessments"
            :key="assessment.id"
            class="cursor-pointer hover:bg-canvas"
            tabindex="0"
            @click="router.push(`/avaliacoes/${assessment.id}`)"
            @keydown.enter="router.push(`/avaliacoes/${assessment.id}`)"
          >
            <td class="tabular font-medium text-fg">
              {{ formatIsoDate(assessment.date) }}
            </td>
            <td class="text-fg-muted">{{ assessment.referralReason ?? '—' }}</td>
            <td class="text-right tabular text-fg-muted">
              {{ assessment.resultCount }}
            </td>
            <td>
              <span v-if="assessment.archivedAt !== null" class="text-xs text-fg-subtle">
                Arquivada
              </span>
              <span v-else class="text-xs text-fg-faint">Ativa</span>
            </td>
          </tr>
        </BaseTable>
      </BaseCard>
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
        <BaseField id="assessment-date" label="Data da avaliação">
          <BaseInput v-model="assessmentForm.date" type="date" required />
        </BaseField>
        <BaseField id="assessment-reason" label="Motivo do encaminhamento">
          <BaseTextarea v-model="assessmentForm.referralReason" />
        </BaseField>
        <BaseField id="assessment-complaint" label="Queixa">
          <BaseTextarea v-model="assessmentForm.complaint" />
        </BaseField>
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
        <BaseField id="comparison-a" label="Avaliação A">
          <BaseSelect v-model="comparisonA">
            <option value="">Selecione…</option>
            <option v-for="item in assessments" :key="item.id" :value="item.id">
              {{ formatIsoDate(item.date) }} — {{ item.resultCount }} resultado(s)
            </option>
          </BaseSelect>
        </BaseField>
        <BaseField id="comparison-b" label="Avaliação B">
          <BaseSelect v-model="comparisonB">
            <option value="">Selecione…</option>
            <option v-for="item in assessments" :key="item.id" :value="item.id">
              {{ formatIsoDate(item.date) }} — {{ item.resultCount }} resultado(s)
            </option>
          </BaseSelect>
        </BaseField>
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
