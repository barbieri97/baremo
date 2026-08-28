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
import { formatIsoDate, ageAt, formatAge, today } from '@shared/domain/dates'
import type { Patient } from '@shared/contracts/entities'

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
    <header class="mb-5 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-xl font-bold text-ink-800">Pacientes</h1>
        <p class="text-sm text-ink-500">Prontuários, avaliações e documentos.</p>
      </div>
      <BaseButton variant="primary" @click="formOpen = true">Novo paciente</BaseButton>
    </header>

    <div class="mb-4 flex items-center gap-3">
      <input
        v-model="query"
        class="field-input max-w-sm"
        type="search"
        placeholder="Buscar por nome, contato ou responsável"
        aria-label="Buscar pacientes"
      />
      <label class="flex items-center gap-2 text-sm text-ink-600">
        <input v-model="includeArchived" type="checkbox" class="rounded border-ink-300" />
        Mostrar arquivados
      </label>
    </div>

    <div class="card overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th class="px-4 py-2 text-left font-semibold">Nome</th>
            <th class="px-4 py-2 text-left font-semibold">Idade</th>
            <th class="px-4 py-2 text-left font-semibold">Nascimento</th>
            <th class="px-4 py-2 text-left font-semibold">Contato</th>
            <th class="px-4 py-2 text-left font-semibold">Situação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" class="px-4 py-8 text-center text-ink-400">Carregando…</td>
          </tr>
          <tr v-else-if="patients.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-ink-400">
              {{
                query.length > 0
                  ? 'Nenhum paciente encontrado para esta busca.'
                  : 'Nenhum paciente cadastrado ainda.'
              }}
            </td>
          </tr>
          <tr
            v-for="patient in patients"
            :key="patient.id"
            class="cursor-pointer border-t border-ink-200 hover:bg-ink-50"
            tabindex="0"
            @click="router.push(`/pacientes/${patient.id}`)"
            @keydown.enter="router.push(`/pacientes/${patient.id}`)"
          >
            <td class="px-4 py-2.5 font-medium text-ink-800">{{ patient.fullName }}</td>
            <td class="px-4 py-2.5 text-ink-600">{{ currentAge(patient) }}</td>
            <td class="px-4 py-2.5 tabular text-ink-600">
              {{ patient.birthDate !== null ? formatIsoDate(patient.birthDate) : '—' }}
            </td>
            <td class="px-4 py-2.5 text-ink-600">{{ patient.contact ?? '—' }}</td>
            <td class="px-4 py-2.5">
              <span
                v-if="patient.archivedAt !== null"
                class="rounded bg-ink-200 px-2 py-0.5 text-xs font-medium text-ink-600"
              >
                Arquivado
              </span>
              <span v-else class="text-xs text-ink-400">Ativo</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PatientFormDialog v-model:open="formOpen" :patient="null" @saved="onCreated" />
  </div>
</template>
