<script setup lang="ts">
/**
 * NodeView do `bloco-resultados` (spec §9.2).
 *
 * Lê os resultados do banco a cada renderização. O documento guarda só a
 * referência à avaliação — reabrir o documento meses depois mostra o prontuário
 * como ele está, não uma fotografia dele.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/vue-3'
import { api } from '../api'
import BaseCard from '../components/BaseCard.vue'
import BaseSelect from '../components/BaseSelect.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import ClassificationBadge from '../components/ClassificationBadge.vue'
import { useCatalogStore } from '../stores/catalog'
import { formatIsoDate } from '@shared/domain/dates'
import type { ChannelOutput } from '@shared/contracts'

const COLUMNS: TableColumn[] = [
  { key: 'instrument', label: 'Instrumento' },
  { key: 'function', label: 'Função' },
  { key: 'scoreType', label: 'Escore' },
  { key: 'value', label: 'Valor', align: 'right' },
  { key: 'classification', label: 'Classificação' }
]

const props = defineProps<NodeViewProps>()

const catalog = useCatalogStore()

type BlockData = ChannelOutput<'documents:resultsBlock'>

const data = ref<BlockData | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

const assessmentId = computed(() => props.node.attrs['assessmentId'] as string | null)
const cognitiveFunctionId = computed(() => props.node.attrs['cognitiveFunctionId'] as string | null)

async function load(): Promise<void> {
  if (assessmentId.value === null) {
    data.value = null
    error.value = 'Nenhuma avaliação selecionada para este bloco.'
    return
  }

  loading.value = true
  error.value = null

  try {
    data.value = await api('documents:resultsBlock', {
      assessmentId: assessmentId.value,
      cognitiveFunctionId: cognitiveFunctionId.value
    })
  } catch {
    error.value = 'Não foi possível carregar os resultados desta avaliação.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([assessmentId, cognitiveFunctionId], load)

function setFunction(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  props.updateAttributes({ cognitiveFunctionId: value === '' ? null : value })
}
</script>

<template>
  <NodeViewWrapper>
    <BaseCard
      variant="accent"
      padding="sm"
      class="my-4"
      :class="{ 'ring-2 ring-accent': selected }"
    >
      <div class="mb-2 flex items-center justify-between gap-3" contenteditable="false">
        <p class="text-xs font-semibold uppercase tracking-wide text-accent-strong">
          Tabela de resultados
          <span v-if="data" class="font-normal normal-case text-fg-subtle">
            — avaliação de {{ formatIsoDate(data.assessmentDate) }}
          </span>
        </p>

        <BaseSelect
          :model-value="cognitiveFunctionId ?? ''"
          size="xs"
          class="w-auto"
          aria-label="Função cognitiva da tabela"
          @change="setFunction"
        >
          <option value="">Todas as funções</option>
          <option
            v-for="entry in catalog.flatFunctions"
            :key="entry.node.id"
            :value="entry.node.id"
          >
            {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
          </option>
        </BaseSelect>
      </div>

      <div contenteditable="false">
        <p v-if="loading" class="py-4 text-center text-xs text-fg-faint">Carregando…</p>
        <p v-else-if="error !== null" class="py-4 text-center text-xs text-warn-strong">
          {{ error }}
        </p>
        <p
          v-else-if="data && data.rows.length === 0"
          class="py-4 text-center text-xs text-fg-faint"
        >
          Nenhum resultado para este recorte.
        </p>

        <BaseTable
          v-else-if="data"
          :columns="COLUMNS"
          density="compact"
          size="sm"
          class="bg-surface"
        >
          <tr v-for="(row, index) in data.rows" :key="index">
            <td>{{ row.instrumentPath }}</td>
            <td class="text-fg-muted">{{ row.cognitiveFunctionName ?? '—' }}</td>
            <td class="text-fg-muted">{{ row.scoreTypeLabel }}</td>
            <td class="text-right tabular">
              {{ row.value !== null ? String(row.value).replace('.', ',') : '—' }}
            </td>
            <td>
              <ClassificationBadge :name="row.classificationName" :color-hex="row.colorHex" />
            </td>
          </tr>
        </BaseTable>
      </div>
    </BaseCard>
  </NodeViewWrapper>
</template>
