<script setup lang="ts">
/**
 * Editor de faixas de classificação (spec §4.6).
 *
 * A convenção é `[min, max)` — mínimo inclusivo, máximo exclusivo — com a última
 * faixa da série fechada em `[min, max]`. A validação (sem sobreposição, sem
 * lacuna, cobrindo as extremidades) roda a cada tecla, com a MESMA função pura
 * que o processo principal aplica antes de gravar: a UI não é a autoridade, mas
 * também não deixa o usuário descobrir o erro só ao salvar.
 *
 * Faixas invertidas — escalas em que valor alto indica pior desempenho — não têm
 * tratamento especial: são as mesmas faixas numéricas com outros nomes.
 */
import { computed, ref, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from './BaseButton.vue'
import { SCORE_TYPES, SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import { describeRange, suggestNextMin, validateRangeSet } from '@shared/domain/ranges'
import { SCORE_TYPE_LABELS } from '@shared/labels'
import { checkContrast } from '@shared/domain/color'
import type { Instrument } from '@shared/contracts/entities'

const props = defineProps<{ instrument: Instrument }>()

const appStore = useAppStore()
const catalog = useCatalogStore()

interface DraftRow {
  key: number
  classificationName: string
  minValue: number
  maxValue: number
  colorId: string
}

let nextKey = 1

const scoreType = ref<ScoreType>('percentile')
const rows = ref<DraftRow[]>([])
const loading = ref(false)
const saving = ref(false)
const configured = ref<ScoreType[]>([])

/** Escore bruto não recebe classificação automática (§4.5). */
const classifiableTypes = SCORE_TYPES.filter((type) => SCORE_TYPE_DOMAINS[type].autoClassify)

async function load(): Promise<void> {
  loading.value = true
  try {
    configured.value = await api('classifications:listConfigured', {
      instrumentId: props.instrument.id
    })

    const existing = await api('classifications:list', {
      instrumentId: props.instrument.id,
      scoreType: scoreType.value
    })

    rows.value = existing.map((range) => ({
      key: nextKey++,
      classificationName: range.classificationName,
      minValue: range.minValue,
      maxValue: range.maxValue,
      colorId: range.colorId
    }))
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

watch(() => [props.instrument.id, scoreType.value], load, { immediate: true })

const asRangeLike = computed(() =>
  rows.value.map((row) => ({
    id: String(row.key),
    classificationName: row.classificationName,
    minValue: row.minValue,
    maxValue: row.maxValue,
    colorHex: catalog.colorById.get(row.colorId)?.hex ?? '#000000',
    version: 1
  }))
)

const issues = computed(() => validateRangeSet(asRangeLike.value, scoreType.value))

const blockingIssues = computed(() =>
  // Um conjunto vazio é estado inicial legítimo, não erro a exibir em vermelho.
  issues.value.filter((issue) => issue.code !== 'empty')
)

const domain = computed(() => SCORE_TYPE_DOMAINS[scoreType.value])

function addRow(): void {
  const min = suggestNextMin(asRangeLike.value, scoreType.value)
  const max = domain.value.max ?? min + 10

  rows.value = [
    ...rows.value,
    {
      key: nextKey++,
      classificationName: '',
      minValue: min,
      maxValue: Math.max(min + step(), Math.min(max, min + 10)),
      colorId: catalog.colors[0]?.id ?? ''
    }
  ]
}

function step(): number {
  return 1 / 10 ** domain.value.decimals
}

function removeRow(key: number): void {
  rows.value = rows.value.filter((row) => row.key !== key)
}

/** Preenche a série cobrindo o domínio inteiro, em partes iguais. */
function fillDomain(count: number): void {
  const { min, max } = domain.value
  if (min === null || max === null) return

  const span = (max - min) / count
  const decimals = domain.value.decimals

  rows.value = Array.from({ length: count }, (_, index) => ({
    key: nextKey++,
    classificationName: '',
    minValue: Number((min + span * index).toFixed(decimals)),
    maxValue: Number((min + span * (index + 1)).toFixed(decimals)),
    colorId: catalog.colors[index % Math.max(catalog.colors.length, 1)]?.id ?? ''
  }))
}

function rangeLabel(key: number): string {
  const range = asRangeLike.value.find((entry) => entry.id === String(key))
  return range ? describeRange(range, asRangeLike.value, scoreType.value) : ''
}

function contrastWarning(colorId: string): string | null {
  const color = catalog.colorById.get(colorId)
  if (!color) return null
  const check = checkContrast(color.hex)
  if (check === null || check.passesAA) return null
  return `Contraste ${check.ratio.toFixed(2)}:1 — abaixo do mínimo AA (4,5:1) para texto sobre esta cor.`
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await api('classifications:save', {
      instrumentId: props.instrument.id,
      scoreType: scoreType.value,
      ranges: rows.value.map((row) => ({
        classificationName: row.classificationName.trim(),
        minValue: row.minValue,
        maxValue: row.maxValue,
        colorId: row.colorId
      }))
    })
    await load()
    appStore.notify(
      'success',
      'Faixas salvas. Resultados já lançados mantêm a classificação com que foram gravados.'
    )
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}

const canSave = computed(
  () => blockingIssues.value.length === 0 && rows.value.every((row) => row.classificationName.trim() !== '')
)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label class="field-label" for="range-score-type">Tipo de escore</label>
        <select id="range-score-type" v-model="scoreType" class="field-input min-w-64">
          <option v-for="type in classifiableTypes" :key="type" :value="type">
            {{ SCORE_TYPE_LABELS[type] }}{{ configured.includes(type) ? ' ✓' : '' }}
          </option>
        </select>
      </div>

      <div class="text-xs text-ink-500">
        Domínio:
        <span class="tabular font-medium">
          {{ String(domain.min).replace('.', ',') }} a {{ String(domain.max).replace('.', ',') }}
        </span>
        · {{ domain.decimals === 0 ? 'inteiros' : `${domain.decimals} casa(s) decimal(is)` }}
      </div>

      <div class="ml-auto flex gap-2">
        <BaseButton size="sm" @click="fillDomain(5)">Gerar 5 faixas</BaseButton>
        <BaseButton size="sm" @click="fillDomain(7)">Gerar 7 faixas</BaseButton>
        <BaseButton size="sm" @click="addRow">Adicionar faixa</BaseButton>
      </div>
    </div>

    <p v-if="loading" class="py-6 text-center text-sm text-ink-400">Carregando faixas…</p>

    <div v-else>
      <table v-if="rows.length > 0" class="w-full text-sm">
        <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th class="px-2 py-2 text-left font-semibold">Classificação</th>
            <th class="w-24 px-2 py-2 text-right font-semibold">Mínimo</th>
            <th class="w-24 px-2 py-2 text-right font-semibold">Máximo</th>
            <th class="w-40 px-2 py-2 text-left font-semibold">Cor</th>
            <th class="w-28 px-2 py-2 text-left font-semibold">Intervalo</th>
            <th class="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" class="border-t border-ink-200">
            <td class="px-2 py-1.5">
              <input
                v-model="row.classificationName"
                class="field-input py-1"
                placeholder="Ex.: Média superior"
              />
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model.number="row.minValue"
                type="number"
                :step="step()"
                class="field-input tabular py-1 text-right"
              />
            </td>
            <td class="px-2 py-1.5">
              <input
                v-model.number="row.maxValue"
                type="number"
                :step="step()"
                class="field-input tabular py-1 text-right"
              />
            </td>
            <td class="px-2 py-1.5">
              <select v-model="row.colorId" class="field-input py-1">
                <option v-for="color in catalog.colors" :key="color.id" :value="color.id">
                  {{ color.name }}
                </option>
              </select>
              <p v-if="contrastWarning(row.colorId)" class="mt-0.5 text-xs text-warn-700">
                {{ contrastWarning(row.colorId) }}
              </p>
            </td>
            <td class="px-2 py-1.5 tabular text-xs text-ink-500">{{ rangeLabel(row.key) }}</td>
            <td class="px-2 py-1.5 text-right">
              <button
                class="text-xs text-danger-500 hover:underline"
                :aria-label="`Remover faixa ${row.classificationName}`"
                @click="removeRow(row.key)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else class="py-8 text-center text-sm text-ink-400">
        Nenhuma faixa cadastrada para {{ SCORE_TYPE_LABELS[scoreType] }}. Sem faixas, os resultados
        deste instrumento são gravados sem classificação automática.
      </p>

      <div
        v-if="blockingIssues.length > 0"
        class="mt-4 rounded border border-danger-500 bg-danger-50 p-3"
      >
        <p class="text-xs font-semibold uppercase tracking-wide text-danger-600">
          Corrija antes de salvar
        </p>
        <ul class="mt-2 space-y-1 text-sm text-danger-600">
          <li v-for="(issue, index) in blockingIssues" :key="index">{{ issue.message }}</li>
        </ul>
      </div>

      <div class="mt-4 flex items-center justify-between">
        <p class="max-w-lg text-xs text-ink-500">
          O limite inferior é inclusivo e o superior exclusivo; a última faixa da série inclui o
          máximo. Faixas contíguas devem se encostar — o máximo de uma é o mínimo da seguinte.
        </p>
        <BaseButton variant="primary" :disabled="!canSave" :loading="saving" @click="save">
          Salvar faixas
        </BaseButton>
      </div>
    </div>
  </div>
</template>
