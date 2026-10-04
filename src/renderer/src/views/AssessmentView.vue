<script setup lang="ts">
/**
 * Avaliação: metadados e grade de resultados (spec §4.7, §4.8, §16.4).
 *
 * Esta é a tela do caso de uso dominante — digitação repetitiva de escores — e
 * por isso é a que mais investe em teclado: uma linha se completa com
 * instrumento, tipo de escore e valor, e `Enter` no valor grava e já abre a
 * linha seguinte. Nada aqui exige mouse.
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import BaseDialog from '../components/BaseDialog.vue'
import ResultRowEditor from '../components/ResultRowEditor.vue'
import ResultBatchEditor from '../components/ResultBatchEditor.vue'
import ResultGroupAccordion from '../components/ResultGroupAccordion.vue'
import AttachmentsPanel from '../components/AttachmentsPanel.vue'
import DocumentsPanel from '../components/DocumentsPanel.vue'
import PageHeader from '../components/PageHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import BaseSegmented from '../components/BaseSegmented.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseEmptyState from '../components/BaseEmptyState.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import BaseField from '../components/BaseField.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseTextarea from '../components/BaseTextarea.vue'
import { formatIsoDate } from '@shared/domain/dates'
import { groupResultsByTree } from '@shared/domain/result-grouping'
import type { ChannelOutput } from '@shared/contracts'
import type { Assessment, Patient } from '@shared/contracts/entities'

const REPROCESS_COLUMNS: TableColumn[] = [
  { key: 'instrument', label: 'Instrumento' },
  { key: 'from', label: 'De' },
  { key: 'to', label: 'Para' }
]

const props = defineProps<{ id: string }>()

const router = useRouter()
const appStore = useAppStore()
const catalog = useCatalogStore()

type ResultRow = ChannelOutput<'results:listByAssessment'>[number]

const assessment = ref<Assessment | null>(null)
const patient = ref<Patient | null>(null)
const results = ref<ResultRow[]>([])
const loading = ref(true)

const editingId = ref<string | null>(null)
const addingRow = ref(false)

/**
 * Lançar um teste inteiro é o caso comum — uma bateria com dezenas de
 * subtestes — e por isso é o padrão. O item individual continua para o avulso e
 * para a sobrescrita manual de classificação.
 */
const ENTRY_MODES = [
  { value: 'battery', label: 'Teste completo' },
  { value: 'single', label: 'Item individual' }
] as const
const entryMode = ref<(typeof ENTRY_MODES)[number]['value']>('battery')

const reprocessOpen = ref(false)
const reprocessPreview = ref<ChannelOutput<'results:reprocessPreview'>>([])
const reprocessing = ref(false)

const metaOpen = ref(false)
const metaForm = ref({ date: '', referralReason: '', complaint: '', notes: '' })

async function load(): Promise<void> {
  loading.value = true
  try {
    await catalog.load()
    assessment.value = await api('assessments:get', { id: props.id })
    patient.value = await api('patients:get', { id: assessment.value.patientId })
    await reloadResults()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

async function reloadResults(): Promise<void> {
  results.value = await api('results:listByAssessment', { assessmentId: props.id })
}

onMounted(load)

/**
 * As duas leituras da grade.
 *
 * Por função é a pergunta clínica — "como está a atenção?" —, a mesma
 * organização do relatório do §7.1.1, e por isso continua sendo o padrão. Por
 * instrumento é a pergunta de conferência — "o que já lancei do IDADI?" —, que
 * antes obrigava a varrer os grupos um a um atrás dos subtestes do mesmo teste.
 */
const VIEW_MODES = [
  { value: 'function', label: 'Por função' },
  { value: 'instrument', label: 'Por instrumento' }
] as const
const viewMode = ref<(typeof VIEW_MODES)[number]['value']>('function')

/**
 * Na árvore de funções, com os pais preservados.
 *
 * O vínculo instrumento → função não é herdado do pai: um subteste sem função
 * cai no balde final mesmo que o teste tenha uma. O balde fica visível de
 * propósito — é uma pendência de cadastro, e distribuí-la seria escondê-la.
 */
const byFunction = computed(() =>
  groupResultsByTree(
    catalog.cognitiveFunctions,
    results.value,
    (result) => result.cognitiveFunctionId,
    { orphanName: 'Sem função cognitiva associada' }
  )
)

/** Os mesmos resultados na árvore de instrumentos: teste › índice › subteste. */
const byInstrument = computed(() =>
  groupResultsByTree(catalog.instruments, results.value, (result) => result.instrumentId, {
    orphanName: 'Instrumento removido do catálogo',
    labelOf: (node) =>
      node.acronym !== null && node.acronym.length > 0
        ? `${node.name} (${node.acronym})`
        : node.name
  })
)

const activeGroups = computed(() =>
  viewMode.value === 'function' ? byFunction.value : byInstrument.value
)

async function onSaved(): Promise<void> {
  editingId.value = null
  addingRow.value = true // mantém a linha de entrada aberta para o próximo escore
  await reloadResults()
}

async function removeResult(result: ResultRow): Promise<void> {
  try {
    await api('results:delete', { id: result.id })
    await reloadResults()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function openReprocess(): Promise<void> {
  try {
    reprocessPreview.value = await api('results:reprocessPreview', { assessmentId: props.id })
    reprocessOpen.value = true
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmReprocess(): Promise<void> {
  reprocessing.value = true
  try {
    const outcome = await api('results:reprocess', { assessmentId: props.id })
    await reloadResults()
    reprocessOpen.value = false
    appStore.notify(
      'success',
      `${outcome.updated} resultado(s) atualizado(s), ${outcome.unchanged} inalterado(s), ${outcome.unresolved} sem faixa correspondente.`
    )
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    reprocessing.value = false
  }
}

function openMeta(): void {
  if (assessment.value === null) return
  metaForm.value = {
    date: assessment.value.date,
    referralReason: assessment.value.referralReason ?? '',
    complaint: assessment.value.complaint ?? '',
    notes: assessment.value.notes ?? ''
  }
  metaOpen.value = true
}

async function saveMeta(): Promise<void> {
  if (assessment.value === null) return
  try {
    assessment.value = await api('assessments:update', {
      id: props.id,
      input: {
        patientId: assessment.value.patientId,
        date: metaForm.value.date,
        referralReason: metaForm.value.referralReason.trim() || null,
        complaint: metaForm.value.complaint.trim() || null,
        notes: metaForm.value.notes.trim() || null
      }
    })
    metaOpen.value = false
  } catch (error) {
    appStore.notifyError(error)
  }
}
</script>

<template>
  <div v-if="loading" class="p-6 text-sm text-fg-subtle">Carregando avaliação…</div>

  <div v-else-if="assessment === null" class="p-6 text-sm text-fg-subtle">
    Avaliação não encontrada.
  </div>

  <div v-else class="p-6">
    <PageHeader
      :title="`Avaliação de ${formatIsoDate(assessment.date)}`"
      :subtitle="assessment.referralReason"
      :back="{ label: patient?.fullName ?? 'Paciente', to: `/pacientes/${assessment.patientId}` }"
      class="mb-6"
    >
      <template #actions>
        <BaseButton size="sm" @click="openMeta">Editar dados</BaseButton>
        <BaseButton size="sm" @click="openReprocess">Reprocessar classificações</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          @click="router.push(`/avaliacoes/${id}/resultados`)"
        >
          Visualizar resultados
        </BaseButton>
      </template>
    </PageHeader>

    <section class="mb-6">
      <SectionHeader title="Resultados" :count="results.length" class="mb-3">
        <template #description>
          A classificação e a cor são gravadas no momento do lançamento. Alterar as faixas depois
          não altera resultados já registrados — use "Reprocessar classificações" para isso.
        </template>
        <template #actions>
          <BaseSegmented
            v-if="results.length > 0"
            v-model="viewMode"
            :options="VIEW_MODES"
            label="Agrupamento dos resultados"
          />

          <BaseButton v-if="!addingRow" size="sm" variant="primary" @click="addingRow = true">
            Lançar resultado
          </BaseButton>
        </template>
      </SectionHeader>

      <BaseEmptyState
        v-if="results.length === 0 && !addingRow"
        framed
        message="Nenhum resultado lançado ainda."
      />

      <ResultGroupAccordion
        v-for="group in activeGroups"
        :key="group.id ?? '__none__'"
        :group="group"
        :assessment-id="id"
        :editing-id="editingId"
        :instrument-label="viewMode === 'function' ? 'path' : 'name'"
        @edit="editingId = $event"
        @remove="removeResult"
        @saved="onSaved"
        @cancel="editingId = null"
      />

      <BaseCard v-if="addingRow" variant="accent" padding="sm">
        <BaseSegmented
          v-model="entryMode"
          :options="ENTRY_MODES"
          label="Modo de lançamento"
          class="mb-3"
        />

        <ResultBatchEditor
          v-if="entryMode === 'battery'"
          :assessment-id="id"
          :results="results"
          @saved="onSaved"
          @cancel="addingRow = false"
        />
        <ResultRowEditor
          v-else
          :assessment-id="id"
          :result="null"
          @saved="onSaved"
          @cancel="addingRow = false"
        />
      </BaseCard>
    </section>

    <DocumentsPanel :patient-id="assessment.patientId" :assessment-id="id" class="mb-6" />
    <AttachmentsPanel :patient-id="assessment.patientId" :assessment-id="id" />

    <BaseDialog
      v-model:open="reprocessOpen"
      title="Reprocessar classificações"
      description="Recalcula a classificação dos resultados desta avaliação com as faixas cadastradas hoje. Resultados sobrescritos manualmente são preservados."
      wide
    >
      <p v-if="reprocessPreview.length === 0" class="text-sm text-fg-muted">
        Nenhuma classificação mudaria. As faixas atuais produzem exatamente o que já está gravado.
      </p>

      <div v-else>
        <p class="mb-3 text-sm text-fg-muted">
          {{ reprocessPreview.length }} resultado(s) mudariam de classificação:
        </p>
        <BaseCard class="max-h-80 overflow-y-auto">
          <BaseTable :columns="REPROCESS_COLUMNS" sticky>
            <tr v-for="change in reprocessPreview" :key="change.resultId">
              <td>{{ change.instrumentName }}</td>
              <td class="text-fg-subtle">{{ change.from ?? 'sem classificação' }}</td>
              <td class="font-medium text-fg">
                {{ change.to ?? 'sem classificação' }}
              </td>
            </tr>
          </BaseTable>
        </BaseCard>
      </div>

      <template #footer>
        <BaseButton variant="ghost" @click="reprocessOpen = false">Cancelar</BaseButton>
        <BaseButton
          variant="primary"
          :disabled="reprocessPreview.length === 0"
          :loading="reprocessing"
          @click="confirmReprocess"
        >
          Reprocessar
        </BaseButton>
      </template>
    </BaseDialog>

    <BaseDialog v-model:open="metaOpen" title="Dados da avaliação">
      <form class="space-y-4" @submit.prevent="saveMeta">
        <BaseField id="meta-date" label="Data">
          <BaseInput v-model="metaForm.date" type="date" required />
        </BaseField>
        <BaseField id="meta-reason" label="Motivo do encaminhamento">
          <BaseTextarea v-model="metaForm.referralReason" />
        </BaseField>
        <BaseField id="meta-complaint" label="Queixa">
          <BaseTextarea v-model="metaForm.complaint" />
        </BaseField>
        <BaseField id="meta-notes" label="Observações">
          <BaseTextarea v-model="metaForm.notes" />
        </BaseField>
      </form>

      <template #footer>
        <BaseButton variant="ghost" @click="metaOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" @click="saveMeta">Salvar</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
