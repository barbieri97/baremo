<script setup lang="ts">
/**
 * Linha de entrada de resultado (spec §4.5, §4.8, §16.4).
 *
 * O caso de uso dominante do app é digitar dezenas de escores em sequência, e a
 * ergonomia disso é o requisito de acessibilidade da §16.4. Três decisões daí:
 *
 *  - o tipo de escore é MEMORIZADO por instrumento entre lançamentos, porque na
 *    prática o profissional usa a mesma métrica ao longo de uma bateria;
 *  - `Enter` no campo de valor grava e mantém o foco pronto para o próximo;
 *  - a classificação aparece em prévia ANTES de gravar, para o erro de digitação
 *    ser percebido no momento em que acontece.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from './BaseButton.vue'
import ClassificationBadge from './ClassificationBadge.vue'
import { RESULT_STATUSES, RESULT_STATUS_LABELS, SCORE_TYPE_LABELS, requiresValue } from '@shared/labels'
import type { ResultStatus } from '@shared/labels'
import { SCORE_TYPES, SCORE_TYPE_DOMAINS, validateScoreValue } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import { resolveRange } from '@shared/domain/ranges'
import type { ChannelOutput } from '@shared/contracts'
import type { ClassificationRangeWithColor } from '@shared/contracts/entities'

type ResultRow = ChannelOutput<'results:listByAssessment'>[number]

const props = defineProps<{
  assessmentId: string
  result: ResultRow | null
}>()

const emit = defineEmits<{ saved: []; cancel: [] }>()

const appStore = useAppStore()
const catalog = useCatalogStore()

/** Última métrica usada por instrumento, dentro desta sessão da tela. */
const lastScoreTypeByInstrument = new Map<string, ScoreType>()

const instrumentId = ref(props.result?.instrumentId ?? '')
const scoreType = ref<ScoreType>(props.result?.scoreType ?? 'percentile')
const rawValue = ref(props.result?.value !== null && props.result !== null ? String(props.result.value).replace('.', ',') : '')
const status = ref<ResultStatus>(props.result?.status ?? 'applied')
const notes = ref(props.result?.notes ?? '')

const overriding = ref(props.result?.manuallyOverridden ?? false)
const overrideName = ref(props.result?.manuallyOverridden ? (props.result.classificationName ?? '') : '')
const overrideColor = ref(props.result?.colorHex ?? '#2B6CB0')

const ranges = ref<ClassificationRangeWithColor[]>([])
const configuredTypes = ref<ScoreType[]>([])
const saving = ref(false)
const valueInput = ref<HTMLInputElement | null>(null)
const instrumentSelect = ref<HTMLSelectElement | null>(null)

onMounted(() => {
  // Novo lançamento começa no instrumento; edição começa no valor, que é o que
  // normalmente se quer corrigir.
  if (props.result === null) instrumentSelect.value?.focus()
  else valueInput.value?.focus()
})

/**
 * Ao trocar de instrumento, adota o tipo de escore mais provável: o último usado
 * para ele, ou o único que tem faixas cadastradas.
 */
watch(instrumentId, async (id) => {
  if (id === '') {
    ranges.value = []
    configuredTypes.value = []
    return
  }

  try {
    configuredTypes.value = await api('classifications:listConfigured', { instrumentId: id })
  } catch {
    configuredTypes.value = []
  }

  const remembered = lastScoreTypeByInstrument.get(id)
  if (remembered !== undefined) scoreType.value = remembered
  else if (configuredTypes.value.length === 1) scoreType.value = configuredTypes.value[0]!

  await loadRanges()
})

watch(scoreType, loadRanges)

async function loadRanges(): Promise<void> {
  if (instrumentId.value === '' || !SCORE_TYPE_DOMAINS[scoreType.value].autoClassify) {
    ranges.value = []
    return
  }

  try {
    ranges.value = await api('classifications:list', {
      instrumentId: instrumentId.value,
      scoreType: scoreType.value
    })
  } catch {
    ranges.value = []
  }
}

onMounted(() => {
  if (instrumentId.value !== '') void loadRanges()
})

/** Aceita vírgula decimal — é como se digita número em português. */
const parsedValue = computed<number | null>(() => {
  const text = rawValue.value.trim().replace(',', '.')
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
})

const valueError = computed(() => {
  if (!requiresValue(status.value)) return null
  if (rawValue.value.trim() === '') return null
  if (parsedValue.value === null) return 'Valor numérico inválido.'
  return validateScoreValue(parsedValue.value, scoreType.value)?.message ?? null
})

/** Prévia da classificação, com a mesma função que o processo principal usa. */
const preview = computed(() => {
  if (overriding.value) {
    return { name: overrideName.value || null, colorHex: overrideColor.value }
  }
  if (parsedValue.value === null || valueError.value !== null) return { name: null, colorHex: null }

  const match = resolveRange(parsedValue.value, ranges.value, scoreType.value)
  return match === null
    ? { name: null, colorHex: null }
    : { name: match.classificationName, colorHex: match.colorHex }
})

const noRangesWarning = computed(
  () =>
    instrumentId.value !== '' &&
    SCORE_TYPE_DOMAINS[scoreType.value].autoClassify &&
    ranges.value.length === 0
)

const domainHint = computed(() => {
  const domain = SCORE_TYPE_DOMAINS[scoreType.value]
  if (domain.min === null || domain.max === null) return 'Valor livre'
  return `${String(domain.min).replace('.', ',')} a ${String(domain.max).replace('.', ',')}`
})

const canSave = computed(() => {
  if (instrumentId.value === '') return false
  if (valueError.value !== null) return false
  if (requiresValue(status.value) && parsedValue.value === null) return false
  if (overriding.value && overrideName.value.trim() === '') return false
  return true
})

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true

  try {
    await api('results:save', {
      id: props.result?.id ?? null,
      input: {
        assessmentId: props.assessmentId,
        instrumentId: instrumentId.value,
        scoreType: scoreType.value,
        value: requiresValue(status.value) ? parsedValue.value : null,
        status: status.value,
        notes: notes.value.trim() || null,
        override: overriding.value
          ? { classificationName: overrideName.value.trim(), colorHex: overrideColor.value }
          : null
      }
    })

    lastScoreTypeByInstrument.set(instrumentId.value, scoreType.value)

    if (props.result === null) {
      // Lançamento em série: limpa o valor, mantém o instrumento e devolve o foco.
      rawValue.value = ''
      notes.value = ''
      overriding.value = false
      overrideName.value = ''
      await nextTick()
      valueInput.value?.focus()
    }

    emit('saved')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="grid grid-cols-12 items-start gap-3">
    <div class="col-span-4">
      <label class="field-label" :for="`instrument-${assessmentId}`">Instrumento</label>
      <select
        :id="`instrument-${assessmentId}`"
        ref="instrumentSelect"
        v-model="instrumentId"
        class="field-input"
      >
        <option value="">Selecione…</option>
        <option v-for="entry in catalog.flatInstruments" :key="entry.node.id" :value="entry.node.id">
          {{ '— '.repeat(entry.depth) }}{{ entry.node.name
          }}{{ entry.node.acronym ? ` (${entry.node.acronym})` : '' }}
        </option>
      </select>
    </div>

    <div class="col-span-2">
      <label class="field-label" :for="`score-type-${assessmentId}`">Tipo de escore</label>
      <select :id="`score-type-${assessmentId}`" v-model="scoreType" class="field-input">
        <optgroup v-if="configuredTypes.length > 0" label="Com faixas cadastradas">
          <option v-for="type in configuredTypes" :key="type" :value="type">
            {{ SCORE_TYPE_LABELS[type] }}
          </option>
        </optgroup>
        <optgroup label="Todos">
          <option v-for="type in SCORE_TYPES" :key="type" :value="type">
            {{ SCORE_TYPE_LABELS[type] }}
          </option>
        </optgroup>
      </select>
    </div>

    <div class="col-span-1">
      <label class="field-label" :for="`value-${assessmentId}`">Valor</label>
      <input
        :id="`value-${assessmentId}`"
        ref="valueInput"
        v-model="rawValue"
        class="field-input tabular text-right"
        :class="{ 'field-input-invalid': valueError !== null }"
        :disabled="!requiresValue(status)"
        inputmode="decimal"
        autocomplete="off"
        :title="domainHint"
        @keydown.enter.prevent="save"
      />
    </div>

    <div class="col-span-2">
      <label class="field-label" :for="`status-${assessmentId}`">Situação</label>
      <select :id="`status-${assessmentId}`" v-model="status" class="field-input">
        <option v-for="value in RESULT_STATUSES" :key="value" :value="value">
          {{ RESULT_STATUS_LABELS[value] }}
        </option>
      </select>
    </div>

    <div class="col-span-3">
      <label class="field-label" :for="`notes-${assessmentId}`">Observação</label>
      <input
        :id="`notes-${assessmentId}`"
        v-model="notes"
        class="field-input"
        @keydown.enter.prevent="save"
      />
    </div>

    <div class="col-span-12 flex flex-wrap items-center gap-4">
      <div class="flex items-center gap-2">
        <span class="text-xs text-ink-500">Classificação:</span>
        <ClassificationBadge
          :name="preview.name"
          :color-hex="preview.colorHex"
          :overridden="overriding"
        />
        <span class="text-xs text-ink-400">({{ domainHint }})</span>
      </div>

      <label class="flex items-center gap-2 text-xs text-ink-600">
        <input v-model="overriding" type="checkbox" class="rounded border-ink-300" />
        Definir classificação manualmente
      </label>

      <template v-if="overriding">
        <input
          v-model="overrideName"
          class="field-input max-w-48 py-1 text-sm"
          placeholder="Nome da classificação"
        />
        <input v-model="overrideColor" type="color" class="h-8 w-12 rounded border border-ink-300" />
      </template>

      <div class="ml-auto flex items-center gap-2">
        <BaseButton size="sm" variant="ghost" @click="emit('cancel')">Fechar</BaseButton>
        <BaseButton size="sm" variant="primary" :disabled="!canSave" :loading="saving" @click="save">
          {{ props.result === null ? 'Lançar' : 'Salvar' }}
        </BaseButton>
      </div>
    </div>

    <p v-if="valueError !== null" class="col-span-12 text-xs text-danger-500">
      {{ valueError }}
    </p>

    <p v-else-if="noRangesWarning" class="col-span-12 text-xs text-warn-700">
      Este instrumento não tem faixas cadastradas para
      {{ SCORE_TYPE_LABELS[scoreType] }}. O resultado será gravado sem classificação — cadastre as
      faixas em Instrumentos para que ela seja atribuída automaticamente.
    </p>

    <p
      v-else-if="preview.name === null && parsedValue !== null && !overriding && ranges.length > 0"
      class="col-span-12 text-xs text-warn-700"
    >
      Nenhuma faixa cadastrada cobre este valor. Verifique a cobertura das faixas deste instrumento.
    </p>
  </div>
</template>
