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
import BaseCard from './BaseCard.vue'
import BaseTable, { type TableColumn } from './BaseTable.vue'
import { RESULT_STATUS_LABELS, SCORE_TYPE_SHORT_LABELS } from '@shared/labels'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ChannelOutput } from '@shared/contracts'

const COLUMNS: TableColumn[] = [
  { key: 'instrument', label: 'Instrumento' },
  { key: 'scoreType', label: 'Escore', class: 'w-28' },
  { key: 'value', label: 'Valor', align: 'right', class: 'w-20' },
  { key: 'classification', label: 'Classificação', class: 'w-44' },
  { key: 'status', label: 'Situação', class: 'w-28' },
  { key: 'notes', label: 'Observação' },
  { key: 'actions', class: 'w-24' }
]

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
  <BaseCard class="overflow-hidden">
    <BaseTable :columns="COLUMNS">
      <template v-for="result in rows" :key="result.id">
        <tr v-if="editingId !== result.id">
          <td class="text-fg">{{ labelOf(result) }}</td>
          <td class="text-fg-muted">
            {{ SCORE_TYPE_SHORT_LABELS[result.scoreType] }}
          </td>
          <td class="text-right tabular font-medium text-fg">
            {{ formatValue(result) }}
          </td>
          <td>
            <ClassificationBadge
              :name="result.classificationName"
              :color-hex="result.colorHex"
              :overridden="result.manuallyOverridden"
            />
          </td>
          <td class="text-fg-muted">
            {{ RESULT_STATUS_LABELS[result.status] }}
          </td>
          <td class="text-fg-subtle">{{ result.notes ?? '' }}</td>
          <td class="text-right">
            <BaseButton variant="link" size="sm" class="mr-2" @click="emit('edit', result.id)">
              Editar
            </BaseButton>
            <BaseButton variant="link-danger" size="sm" @click="emit('remove', result)">
              Remover
            </BaseButton>
          </td>
        </tr>
        <tr v-else class="bg-accent-soft/40">
          <td colspan="7">
            <ResultRowEditor
              :assessment-id="assessmentId"
              :result="result"
              @saved="emit('saved')"
              @cancel="emit('cancel')"
            />
          </td>
        </tr>
      </template>
    </BaseTable>
  </BaseCard>
</template>
