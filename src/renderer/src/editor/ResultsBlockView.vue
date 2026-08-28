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
import ClassificationBadge from '../components/ClassificationBadge.vue'
import { useCatalogStore } from '../stores/catalog'
import { formatIsoDate } from '@shared/domain/dates'
import type { ChannelOutput } from '@shared/contracts'

const props = defineProps<NodeViewProps>()

const catalog = useCatalogStore()

type BlockData = ChannelOutput<'documents:resultsBlock'>

const data = ref<BlockData | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

const assessmentId = computed(() => props.node.attrs['assessmentId'] as string | null)
const cognitiveFunctionId = computed(
  () => props.node.attrs['cognitiveFunctionId'] as string | null
)

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
  <NodeViewWrapper
    class="my-4 rounded-md border border-brand-200 bg-brand-50/40 p-3"
    :class="{ 'ring-2 ring-brand-500': selected }"
  >
    <div class="mb-2 flex items-center justify-between gap-3" contenteditable="false">
      <p class="text-xs font-semibold uppercase tracking-wide text-brand-700">
        Tabela de resultados
        <span v-if="data" class="font-normal normal-case text-ink-500">
          — avaliação de {{ formatIsoDate(data.assessmentDate) }}
        </span>
      </p>

      <select
        class="rounded border border-ink-300 bg-white px-2 py-1 text-xs"
        :value="cognitiveFunctionId ?? ''"
        @change="setFunction"
      >
        <option value="">Todas as funções</option>
        <option v-for="entry in catalog.flatFunctions" :key="entry.node.id" :value="entry.node.id">
          {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
        </option>
      </select>
    </div>

    <div contenteditable="false">
      <p v-if="loading" class="py-4 text-center text-xs text-ink-400">Carregando…</p>
      <p v-else-if="error !== null" class="py-4 text-center text-xs text-warn-700">{{ error }}</p>
      <p v-else-if="data && data.rows.length === 0" class="py-4 text-center text-xs text-ink-400">
        Nenhum resultado para este recorte.
      </p>

      <table v-else-if="data" class="w-full bg-white text-xs">
        <thead class="bg-ink-100 uppercase tracking-wide text-ink-500">
          <tr>
            <th class="px-2 py-1.5 text-left font-semibold">Instrumento</th>
            <th class="px-2 py-1.5 text-left font-semibold">Função</th>
            <th class="px-2 py-1.5 text-left font-semibold">Escore</th>
            <th class="px-2 py-1.5 text-right font-semibold">Valor</th>
            <th class="px-2 py-1.5 text-left font-semibold">Classificação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in data.rows" :key="index" class="border-t border-ink-200">
            <td class="px-2 py-1.5">{{ row.instrumentPath }}</td>
            <td class="px-2 py-1.5 text-ink-600">{{ row.cognitiveFunctionName ?? '—' }}</td>
            <td class="px-2 py-1.5 text-ink-600">{{ row.scoreTypeLabel }}</td>
            <td class="px-2 py-1.5 text-right tabular">
              {{ row.value !== null ? String(row.value).replace('.', ',') : '—' }}
            </td>
            <td class="px-2 py-1.5">
              <ClassificationBadge :name="row.classificationName" :color-hex="row.colorHex" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </NodeViewWrapper>
</template>
