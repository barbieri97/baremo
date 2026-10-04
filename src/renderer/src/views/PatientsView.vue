<script setup lang="ts">
/**
 * Lista de pacientes (spec §4.2, §6.2).
 */
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from '../components/BaseButton.vue'
import PatientFormDialog from '../components/PatientFormDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseCheckbox from '../components/BaseCheckbox.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import BaseBadge from '../components/BaseBadge.vue'
import { formatIsoDate, ageAt, formatAge, today } from '@shared/domain/dates'
import type { Patient } from '@shared/contracts/entities'

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Nome' },
  { key: 'age', label: 'Idade' },
  { key: 'birth', label: 'Nascimento' },
  { key: 'contact', label: 'Contato' },
  { key: 'status', label: 'Situação' }
]

const router = useRouter()
const appStore = useAppStore()

const patients = ref<Patient[]>([])
const query = ref('')
const includeArchived = ref(false)
const loading = ref(false)
const formOpen = ref(false)

async function load(): Promise<void> {
  loading.value = true
  try {
    patients.value = await api('patients:list', {
      query: query.value,
      includeArchived: includeArchived.value
    })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

// A busca refaz a consulta no banco em vez de filtrar em memória: a lista pode
// crescer bastante, e o índice do SQLite resolve isso melhor que o renderer.
let debounce: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
  clearTimeout(debounce)
  debounce = setTimeout(load, 200)
})

watch(includeArchived, load)
onMounted(load)

function currentAge(patient: Patient): string {
  if (patient.birthDate === null) return '—'
  const age = ageAt(patient.birthDate, today())
  return age !== null ? formatAge(age) : '—'
}

async function onCreated(patient: Patient): Promise<void> {
  formOpen.value = false
  appStore.notify('success', 'Paciente cadastrado.')
  await router.push(`/pacientes/${patient.id}`)
}
</script>

<template>
  <div class="p-6">
    <PageHeader title="Pacientes" subtitle="Prontuários, avaliações e documentos." class="mb-6">
      <template #actions>
        <BaseButton variant="primary" @click="formOpen = true">Novo paciente</BaseButton>
      </template>
    </PageHeader>

    <div class="mb-4 flex items-center gap-3">
      <BaseInput
        v-model="query"
        class="max-w-sm"
        type="search"
        placeholder="Buscar por nome, contato ou responsável"
        aria-label="Buscar pacientes"
      />
      <BaseCheckbox v-model="includeArchived" label="Mostrar arquivados" />
    </div>

    <BaseCard class="overflow-hidden">
      <BaseTable
        :columns="COLUMNS"
        density="comfortable"
        :empty-text="
          loading
            ? 'Carregando…'
            : patients.length === 0
              ? query.length > 0
                ? 'Nenhum paciente encontrado para esta busca.'
                : 'Nenhum paciente cadastrado ainda.'
              : null
        "
      >
        <tr
          v-for="patient in patients"
          :key="patient.id"
          class="cursor-pointer hover:bg-canvas"
          tabindex="0"
          @click="router.push(`/pacientes/${patient.id}`)"
          @keydown.enter="router.push(`/pacientes/${patient.id}`)"
        >
          <td class="font-medium text-fg">{{ patient.fullName }}</td>
          <td class="text-fg-muted">{{ currentAge(patient) }}</td>
          <td class="tabular text-fg-muted">
            {{ patient.birthDate !== null ? formatIsoDate(patient.birthDate) : '—' }}
          </td>
          <td class="text-fg-muted">{{ patient.contact ?? '—' }}</td>
          <td>
            <BaseBadge v-if="patient.archivedAt !== null">Arquivado</BaseBadge>
            <span v-else class="text-xs text-fg-faint">Ativo</span>
          </td>
        </tr>
      </BaseTable>
    </BaseCard>

    <PatientFormDialog v-model:open="formOpen" :patient="null" @saved="onCreated" />
  </div>
</template>
