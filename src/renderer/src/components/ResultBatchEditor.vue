<script setup lang="ts">
/**
 * Lançamento de um teste completo (spec §4.8, §16.4).
 *
 * Escolhe-se só o teste pai e a grade traz ele e todos os subtestes, na ordem da
 * árvore, cada um já no tipo de escore que tem faixas. O que sobra para o
 * profissional é digitar os valores: `Enter` pula para o próximo e, no último,
 * lança a bateria inteira numa gravação só.
 *
 * Linhas deixadas em branco são ignoradas — nem todo subteste é aplicado. Uma
 * linha que já tem resultado nesta avaliação vem preenchida e, se alterada,
 * grava como edição.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from './BaseButton.vue'
import ClassificationBadge from './ClassificationBadge.vue'
import BaseCard from './BaseCard.vue'
import BaseField from './BaseField.vue'
import BaseInput from './BaseInput.vue'
import BaseSelect from './BaseSelect.vue'
import BaseTable, { type TableColumn } from './BaseTable.vue'
import {
  RESULT_STATUSES,
  RESULT_STATUS_LABELS,
  SCORE_TYPE_LABELS,
  requiresValue
} from '@shared/labels'
import type { ResultStatus } from '@shared/labels'
import { SCORE_TYPES, SCORE_TYPE_DOMAINS, validateScoreValue } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import {
  availableScoreTypes,
  defaultScoreType,
  formatDecimalInput,
  parseDecimalInput
} from '@shared/domain/result-entry'
import { resolveRange } from '@shared/domain/ranges'
import type { ChannelOutput } from '@shared/contracts'
import type { ClassificationRangeWithColor } from '@shared/contracts/entities'

const COLUMNS: TableColumn[] = [
  { key: 'instrument', label: 'Instrumento' },
  { key: 'scoreType', label: 'Tipo de escore', class: 'w-52' },
  { key: 'value', label: 'Valor', class: 'w-24' },
  { key: 'status', label: 'Situação', class: 'w-36' },
  { key: 'notes', label: 'Observação', class: 'w-48' },
  { key: 'classification', label: 'Classificação', class: 'w-44' }
]

/** O que a tela usa de um `BaseInput`: foco e seleção ao avançar com Enter. */
type ValueInput = { focus(): void; select(): void }

type ResultRow = ChannelOutput<'results:listByAssessment'>[number]

interface Snapshot {
  scoreType: ScoreType
  rawValue: string
  status: ResultStatus
  notes: string
}

interface BatchRow extends Snapshot {
  instrumentId: string
  label: string
  depth: number
  configured: ScoreType[]
  /** Resultado já gravado que esta linha edita; `null` = lançamento novo. */
  resultId: string | null
  original: Snapshot | null
}

const props = defineProps<{
  assessmentId: string
  results: readonly ResultRow[]
}>()

const emit = defineEmits<{ saved: []; cancel: [] }>()

const appStore = useAppStore()
const catalog = useCatalogStore()

const rootId = ref('')
const rows = ref<BatchRow[]>([])
const rangesByKey = ref(new Map<string, ClassificationRangeWithColor[]>())
const loading = ref(false)
const saving = ref(false)
const rootSelect = ref<{ focus(): void } | null>(null)
const valueInputs = ref<(ValueInput | null)[]>([])

onMounted(() => rootSelect.value?.focus())

/** Só quem tem filhos: é o "teste" que se lança inteiro. */
const parentOptions = computed(() => {
  const withChildren = new Set(
    catalog.instruments.flatMap((node) => (node.parentId === null ? [] : [node.parentId]))
  )
  return catalog.flatInstruments.filter((entry) => withChildren.has(entry.node.id))
})

const key = (instrumentId: string, scoreType: ScoreType): string => `${instrumentId}|${scoreType}`

function existingResult(instrumentId: string, scoreType?: ScoreType): ResultRow | undefined {
  const candidates = props.results.filter((result) => result.instrumentId === instrumentId)
  return candidates.find((result) => result.scoreType === scoreType) ?? candidates[0]
}

function snapshotOf(result: ResultRow): Snapshot {
  return {
    scoreType: result.scoreType,
    rawValue: formatDecimalInput(result.value),
    status: result.status,
    notes: result.notes ?? ''
  }
}

watch(rootId, async (id) => {
  rows.value = []
  if (id === '') return

  // `flatInstruments` está em pré-ordem: o ramo é o pai seguido de tudo o que
  // vem depois dele com profundidade maior.
  const flat = catalog.flatInstruments
  const start = flat.findIndex((entry) => entry.node.id === id)
  if (start === -1) return
  const rootDepth = flat[start]!.depth
  let end = start + 1
  while (end < flat.length && flat[end]!.depth > rootDepth) end++
  const branch = flat.slice(start, end)

  loading.value = true
  try {
    const ranges = await api('classifications:listForInstruments', {
      instrumentIds: branch.map((entry) => entry.node.id)
    })
    const grouped = new Map<string, ClassificationRangeWithColor[]>()
    for (const range of ranges) {
      const bucket = grouped.get(key(range.instrumentId, range.scoreType)) ?? []
      bucket.push(range)
      grouped.set(key(range.instrumentId, range.scoreType), bucket)
    }
    rangesByKey.value = grouped

    rows.value = branch.map((entry) => {
      const configured = [
        ...new Set(
          ranges
            .filter((range) => range.instrumentId === entry.node.id)
            .map((range) => range.scoreType)
        )
      ]
      const preferred = defaultScoreType(availableScoreTypes(configured), configured)
      const existing = existingResult(entry.node.id, preferred)
      const original = existing ? snapshotOf(existing) : null

      return {
        instrumentId: entry.node.id,
        label: `${entry.node.name}${entry.node.acronym ? ` (${entry.node.acronym})` : ''}`,
        depth: entry.depth - rootDepth,
        configured,
        resultId: existing?.id ?? null,
        original,
        ...(original ?? { scoreType: preferred, rawValue: '', status: 'applied', notes: '' })
      }
    })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }

  await nextTick()
  focusValue(0)
})

function availableFor(row: BatchRow): ScoreType[] {
  return availableScoreTypes(row.configured, row.original?.scoreType)
}

/**
 * Trocar o tipo numa linha que já tem resultado desse outro tipo passa a editar
 * aquele — senão o índice único (avaliação, instrumento, tipo) recusaria o lote.
 */
function onScoreTypeChange(row: BatchRow): void {
  const match = props.results.find(
    (result) => result.instrumentId === row.instrumentId && result.scoreType === row.scoreType
  )
  if (match === undefined || match.id === row.resultId) return
  row.resultId = match.id
  row.original = snapshotOf(match)
  Object.assign(row, snapshotOf(match))
}

/** Tipos oferecidos no "para todos", com quantas linhas do teste os aceitam. */
const bulkOptions = computed(() =>
  SCORE_TYPES.flatMap((type) => {
    const count = rows.value.filter((row) => availableFor(row).includes(type)).length
    return count === 0 ? [] : [{ type, count }]
  })
)

const bulkScoreType = ref('')

/**
 * Aplica o tipo a todas as linhas que o têm disponível; as demais ficam como
 * estão, já que lançar num tipo sem faixas não classificaria.
 */
function applyScoreTypeToAll(): void {
  const type = bulkScoreType.value as ScoreType | ''
  bulkScoreType.value = ''
  if (type === '') return

  let skipped = 0
  for (const row of rows.value) {
    if (!availableFor(row).includes(type)) {
      skipped++
      continue
    }
    if (row.scoreType === type) continue
    row.scoreType = type
    onScoreTypeChange(row)
  }

  if (skipped > 0) {
    appStore.notify(
      'warning',
      `${SCORE_TYPE_LABELS[type]} não está disponível em ${skipped} linha(s); elas mantiveram o tipo anterior.`
    )
  }
}

interface RowState {
  parsed: number | null
  error: string | null
  preview: { name: string | null; colorHex: string | null }
  noRanges: boolean
  pending: boolean
}

function stateOf(row: BatchRow): RowState {
  const parsed = parseDecimalInput(row.rawValue)
  const needsValue = requiresValue(row.status)
  const autoClassify = SCORE_TYPE_DOMAINS[row.scoreType].autoClassify
  const ranges = rangesByKey.value.get(key(row.instrumentId, row.scoreType)) ?? []

  let error: string | null = null
  if (needsValue && row.rawValue.trim() !== '') {
    error =
      parsed === null
        ? 'Valor numérico inválido.'
        : (validateScoreValue(parsed, row.scoreType)?.message ?? null)
  }

  const touched = row.rawValue.trim() !== '' || row.status !== 'applied' || row.notes.trim() !== ''
  const pending =
    row.original === null
      ? touched
      : row.original.scoreType !== row.scoreType ||
        row.original.rawValue !== row.rawValue.trim() ||
        row.original.status !== row.status ||
        row.original.notes !== row.notes.trim()

  const match =
    needsValue && parsed !== null && error === null && autoClassify
      ? resolveRange(parsed, ranges, row.scoreType)
      : null

  return {
    parsed,
    error,
    preview: { name: match?.classificationName ?? null, colorHex: match?.colorHex ?? null },
    noRanges: autoClassify && ranges.length === 0,
    pending
  }
}

const states = computed(() => rows.value.map(stateOf))

const pendingCount = computed(() => states.value.filter((state) => state.pending).length)

const blocking = computed(() =>
  rows.value.some((row, index) => {
    const state = states.value[index]!
    if (!state.pending) return false
    if (state.error !== null) return true
    return requiresValue(row.status) && state.parsed === null
  })
)

const canSave = computed(() => pendingCount.value > 0 && !blocking.value && !saving.value)

function focusValue(index: number): void {
  for (let cursor = index; cursor < rows.value.length; cursor++) {
    const input = valueInputs.value[cursor]
    if (input && requiresValue(rows.value[cursor]!.status)) {
      input.focus()
      input.select()
      return
    }
  }
}

function onValueEnter(index: number): void {
  const hasNext = rows.value.slice(index + 1).some((row) => requiresValue(row.status))
  if (hasNext) focusValue(index + 1)
  else void save()
}

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true

  try {
    const items = rows.value.flatMap((row, index) => {
      const state = states.value[index]!
      if (!state.pending) return []
      return [
        {
          id: row.resultId,
          input: {
            assessmentId: props.assessmentId,
            instrumentId: row.instrumentId,
            scoreType: row.scoreType,
            value: requiresValue(row.status) ? state.parsed : null,
            status: row.status,
            notes: row.notes.trim() || null,
            override: null
          }
        }
      ]
    })

    const saved = await api('results:saveMany', { assessmentId: props.assessmentId, items })
    appStore.notify('success', `${saved.length} resultado(s) lançado(s).`)

    // Próxima bateria: volta ao seletor de teste.
    rootId.value = ''
    emit('saved')
    await nextTick()
    rootSelect.value?.focus()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-end gap-3">
      <BaseField :id="`batch-root-${assessmentId}`" label="Teste" class="min-w-72 flex-1">
        <BaseSelect ref="rootSelect" v-model="rootId">
          <option value="">Selecione o teste…</option>
          <option v-for="entry in parentOptions" :key="entry.node.id" :value="entry.node.id">
            {{ '— '.repeat(entry.depth) }}{{ entry.node.name
            }}{{ entry.node.acronym ? ` (${entry.node.acronym})` : '' }}
          </option>
        </BaseSelect>
      </BaseField>

      <BaseField
        v-if="rows.length > 0"
        :id="`batch-bulk-type-${assessmentId}`"
        label="Tipo de escore para todos"
        class="w-60"
      >
        <BaseSelect v-model="bulkScoreType" @change="applyScoreTypeToAll">
          <option value="">Aplicar a todos…</option>
          <option v-for="option in bulkOptions" :key="option.type" :value="option.type">
            {{ SCORE_TYPE_LABELS[option.type]
            }}{{ option.count < rows.length ? ` (${option.count} de ${rows.length})` : '' }}
          </option>
        </BaseSelect>
      </BaseField>

      <div class="ml-auto flex items-center gap-2 pb-0.5">
        <BaseButton size="sm" variant="ghost" @click="emit('cancel')">Fechar</BaseButton>
        <BaseButton
          size="sm"
          variant="primary"
          :disabled="!canSave"
          :loading="saving"
          @click="save"
        >
          {{ pendingCount > 0 ? `Lançar ${pendingCount} resultado(s)` : 'Lançar' }}
        </BaseButton>
      </div>
    </div>

    <p v-if="parentOptions.length === 0" class="mt-3 text-xs text-fg-subtle">
      Nenhum instrumento tem subtestes cadastrados. Use "Item individual" ou organize os subtestes
      em Instrumentos.
    </p>

    <p v-if="loading" class="mt-3 text-sm text-fg-subtle">Carregando subtestes…</p>

    <BaseCard v-else-if="rows.length > 0" class="mt-3 overflow-x-auto">
      <BaseTable :columns="COLUMNS" density="compact">
        <tr
          v-for="(row, index) in rows"
          :key="row.instrumentId"
          :class="{ 'bg-accent-soft/40': states[index]!.pending }"
        >
          <td class="text-fg" :style="{ paddingLeft: `${0.75 + row.depth * 1.25}rem` }">
            <span :class="{ 'font-semibold': row.depth === 0 }">{{ row.label }}</span>
            <span v-if="row.resultId !== null" class="ml-2 text-xs text-fg-faint">já lançado</span>
          </td>
          <td>
            <BaseSelect
              v-model="row.scoreType"
              size="sm"
              :aria-label="`Tipo de escore — ${row.label}`"
              @change="onScoreTypeChange(row)"
            >
              <option v-for="type in availableFor(row)" :key="type" :value="type">
                {{ SCORE_TYPE_LABELS[type] }}
              </option>
            </BaseSelect>
          </td>
          <td>
            <BaseInput
              :ref="(component) => (valueInputs[index] = component as ValueInput | null)"
              v-model="row.rawValue"
              size="sm"
              class="tabular text-right"
              :invalid="states[index]!.error !== null"
              :aria-label="`Valor — ${row.label}`"
              :disabled="!requiresValue(row.status)"
              :title="states[index]!.error ?? undefined"
              inputmode="decimal"
              autocomplete="off"
              @keydown.enter.prevent="onValueEnter(index)"
            />
          </td>
          <td>
            <BaseSelect v-model="row.status" size="sm" :aria-label="`Situação — ${row.label}`">
              <option v-for="value in RESULT_STATUSES" :key="value" :value="value">
                {{ RESULT_STATUS_LABELS[value] }}
              </option>
            </BaseSelect>
          </td>
          <td>
            <BaseInput v-model="row.notes" size="sm" :aria-label="`Observação — ${row.label}`" />
          </td>
          <td>
            <span v-if="states[index]!.error !== null" class="text-xs text-danger">
              {{ states[index]!.error }}
            </span>
            <ClassificationBadge
              v-else-if="states[index]!.preview.name !== null"
              :name="states[index]!.preview.name"
              :color-hex="states[index]!.preview.colorHex"
            />
            <span
              v-else-if="states[index]!.noRanges && requiresValue(row.status)"
              class="text-xs text-warn-strong"
            >
              Sem faixas
            </span>
            <span
              v-else-if="
                states[index]!.parsed !== null && SCORE_TYPE_DOMAINS[row.scoreType].autoClassify
              "
              class="text-xs text-warn-strong"
            >
              Fora das faixas
            </span>
            <span v-else class="text-xs text-fg-faint">—</span>
          </td>
        </tr>
      </BaseTable>
    </BaseCard>

    <p v-if="rows.length > 0" class="mt-2 text-xs text-fg-subtle">
      Linhas em branco não são lançadas. <kbd>Enter</kbd> no valor vai para o próximo subteste; no
      último, lança o teste inteiro.
    </p>
  </div>
</template>
