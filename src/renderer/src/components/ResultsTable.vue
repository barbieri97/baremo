<script setup lang="ts">
/**
 * A tabela de resultados da grade da avaliação (spec §4.8).
 *
 * Vive em componente próprio porque a grade passou a mostrar as mesmas linhas em
 * dois agrupamentos (por função e por instrumento) e em vários níveis de
 * acordeão. Duplicar a tabela em cada um deles seria duplicar também a edição
 * inline, que é a parte que não pode divergir.
 */
import { useCatalogStore } from '../stores/catalog'
import ClassificationBadge from './ClassificationBadge.vue'
import ResultRowEditor from './ResultRowEditor.vue'
import { RESULT_STATUS_LABELS, SCORE_TYPE_SHORT_LABELS } from '@shared/labels'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ChannelOutput } from '@shared/contracts'

type ResultRow = ChannelOutput<'results:listByAssessment'>[number]

const props = defineProps<{
  rows: readonly ResultRow[]
  assessmentId: string
  editingId: string | null
  /**
   * Agrupado por instrumento, o acordeão já carrega o caminho — repeti-lo em
   * cada linha só afasta as colunas que importam.
   */
  instrumentLabel: 'path' | 'name'
}>()

const emit = defineEmits<{
  edit: [id: string]
  remove: [result: ResultRow]
  saved: []
  cancel: []
}>()

const catalog = useCatalogStore()

function labelOf(result: ResultRow): string {
  if (props.instrumentLabel === 'path') return catalog.instrumentPath(result.instrumentId)
  return catalog.instrumentById.get(result.instrumentId)?.name ?? result.instrumentName
}

function formatValue(result: ResultRow): string {
  if (result.value === null) return '—'
  return result.value.toFixed(SCORE_TYPE_DOMAINS[result.scoreType].decimals).replace('.', ',')
}
</script>

<template>
  <div class="card overflow-hidden">
    <table class="w-full text-sm">
      <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
        <tr>
          <th class="px-3 py-2 text-left font-semibold">Instrumento</th>
          <th class="w-28 px-3 py-2 text-left font-semibold">Escore</th>
          <th class="w-20 px-3 py-2 text-right font-semibold">Valor</th>
          <th class="w-44 px-3 py-2 text-left font-semibold">Classificação</th>
          <th class="w-28 px-3 py-2 text-left font-semibold">Situação</th>
          <th class="px-3 py-2 text-left font-semibold">Observação</th>
          <th class="w-24 px-3 py-2" />
        </tr>
      </thead>
      <tbody>
        <template v-for="result in rows" :key="result.id">
          <tr v-if="editingId !== result.id" class="border-t border-ink-200">
            <td class="px-3 py-2 text-ink-800">{{ labelOf(result) }}</td>
            <td class="px-3 py-2 text-ink-600">
              {{ SCORE_TYPE_SHORT_LABELS[result.scoreType] }}
            </td>
            <td class="px-3 py-2 text-right tabular font-medium text-ink-800">
              {{ formatValue(result) }}
            </td>
            <td class="px-3 py-2">
              <ClassificationBadge
                :name="result.classificationName"
                :color-hex="result.colorHex"
                :overridden="result.manuallyOverridden"
              />
            </td>
            <td class="px-3 py-2 text-ink-600">
              {{ RESULT_STATUS_LABELS[result.status] }}
            </td>
            <td class="px-3 py-2 text-ink-500">{{ result.notes ?? '' }}</td>
            <td class="px-3 py-2 text-right">
              <button
                class="mr-2 text-xs text-brand-500 hover:underline"
                @click="emit('edit', result.id)"
              >
                Editar
              </button>
              <button
                class="text-xs text-danger-500 hover:underline"
                @click="emit('remove', result)"
              >
                Remover
              </button>
            </td>
          </tr>
          <tr v-else class="border-t border-ink-200 bg-brand-50/40">
            <td colspan="7" class="px-3 py-3">
              <ResultRowEditor
                :assessment-id="assessmentId"
                :result="result"
                @saved="emit('saved')"
                @cancel="emit('cancel')"
              />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
