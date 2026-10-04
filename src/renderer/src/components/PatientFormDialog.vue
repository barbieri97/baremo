<script setup lang="ts">
/**
 * Cadastro e edição de paciente (spec §4.2).
 */
import { computed, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'
import { api, fieldIssues } from '../api'
import { useAppStore } from '../stores/app'
import { HANDEDNESS, HANDEDNESS_LABELS, SEX_LABELS, SEXES } from '@shared/labels'
import type { Patient, PatientInput } from '@shared/contracts/entities'
import BaseField from './BaseField.vue'
import BaseInput from './BaseInput.vue'
import BaseSelect from './BaseSelect.vue'
import BaseTextarea from './BaseTextarea.vue'

const props = defineProps<{ patient: Patient | null }>()
const emit = defineEmits<{ saved: [patient: Patient] }>()

const open = defineModel<boolean>('open', { required: true })
const appStore = useAppStore()

const saving = ref(false)
const issues = ref<{ path: string; message: string }[]>([])

function blank(): PatientInput {
  return {
    fullName: '',
    birthDate: null,
    sex: 'unspecified',
    education: null,
    handedness: 'unspecified',
    guardian: null,
    contact: null,
    notes: null
  }
}

const form = ref<PatientInput>(blank())

watch(
  () => [open.value, props.patient] as const,
  ([isOpen, patient]) => {
    if (!isOpen) return
    issues.value = []
    form.value =
      patient === null
        ? blank()
        : {
            fullName: patient.fullName,
            birthDate: patient.birthDate,
            sex: patient.sex,
            education: patient.education,
            handedness: patient.handedness,
            guardian: patient.guardian,
            contact: patient.contact,
            notes: patient.notes
          }
  },
  { immediate: true }
)

const title = computed(() => (props.patient === null ? 'Novo paciente' : 'Editar paciente'))

function issueFor(field: string): string | null {
  return issues.value.find((issue) => issue.path.endsWith(field))?.message ?? null
}

/**
 * Campos de texto vazios viram `null`, não string vazia.
 *
 * Sem isso, "não informado" e "informado como vazio" ficariam indistinguíveis no
 * banco — e o relatório imprimiria um campo em branco em vez de "não informada".
 */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

async function save(): Promise<void> {
  saving.value = true
  issues.value = []

  const payload: PatientInput = {
    ...form.value,
    fullName: form.value.fullName.trim(),
    education: form.value.education === null ? null : emptyToNull(form.value.education),
    guardian: form.value.guardian === null ? null : emptyToNull(form.value.guardian),
    contact: form.value.contact === null ? null : emptyToNull(form.value.contact),
    notes: form.value.notes === null ? null : emptyToNull(form.value.notes),
    birthDate:
      form.value.birthDate === null || form.value.birthDate === '' ? null : form.value.birthDate
  }

  try {
    const saved =
      props.patient === null
        ? await api('patients:create', { input: payload })
        : await api('patients:update', { id: props.patient.id, input: payload })

    open.value = false
    emit('saved', saved)
  } catch (error) {
    const found = fieldIssues(error)
    if (found.length > 0) issues.value = found
    else appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="title" wide>
    <form class="grid grid-cols-2 gap-4" @submit.prevent="save">
      <BaseField
        id="patient-name"
        label="Nome completo"
        class="col-span-2"
        :error="issueFor('fullName')"
      >
        <BaseInput v-model="form.fullName" required autocomplete="off" />
      </BaseField>

      <BaseField id="patient-birth" label="Data de nascimento" :error="issueFor('birthDate')">
        <BaseInput v-model="form.birthDate" type="date" />
      </BaseField>

      <BaseField id="patient-sex" label="Sexo">
        <BaseSelect v-model="form.sex">
          <option v-for="value in SEXES" :key="value" :value="value">
            {{ SEX_LABELS[value] }}
          </option>
        </BaseSelect>
      </BaseField>

      <BaseField id="patient-education" label="Escolaridade">
        <BaseInput
          :model-value="form.education ?? ''"
          placeholder="Ex.: Ensino médio completo"
          @update:model-value="form.education = String($event ?? '')"
        />
      </BaseField>

      <BaseField id="patient-handedness" label="Lateralidade">
        <BaseSelect v-model="form.handedness">
          <option v-for="value in HANDEDNESS" :key="value" :value="value">
            {{ HANDEDNESS_LABELS[value] }}
          </option>
        </BaseSelect>
      </BaseField>

      <BaseField id="patient-guardian" label="Responsável">
        <BaseInput
          :model-value="form.guardian ?? ''"
          @update:model-value="form.guardian = String($event ?? '')"
        />
      </BaseField>

      <BaseField id="patient-contact" label="Contato">
        <BaseInput
          :model-value="form.contact ?? ''"
          @update:model-value="form.contact = String($event ?? '')"
        />
      </BaseField>

      <BaseField id="patient-notes" label="Observações" class="col-span-2">
        <BaseTextarea
          :model-value="form.notes ?? ''"
          class="min-h-24"
          @update:model-value="form.notes = $event ?? ''"
        />
      </BaseField>
    </form>

    <template #footer>
      <BaseButton variant="ghost" @click="open = false">Cancelar</BaseButton>
      <BaseButton variant="primary" :loading="saving" @click="save">Salvar</BaseButton>
    </template>
  </BaseDialog>
</template>
