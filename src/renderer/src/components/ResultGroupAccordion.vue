<script setup lang="ts">
/**
 * Um nó da grade de resultados, recolhível, com os descendentes dentro (§4.8).
 *
 * Recursivo porque a hierarquia é de profundidade ilimitada nas duas leituras —
 * função cognitiva e instrumento —, e achatá-la é justamente o que fazia
 * "Desenvolvimento" e "Desenvolvimento cognitivo" aparecerem lado a lado como se
 * não tivessem relação.
 *
 * `<details>` nativo, e não um `v-if` com estado próprio: fechado por padrão sai
 * de graça, o teclado funciona sem nada, e não há um segundo lugar guardando
 * quais nós estão abertos.
 */
import ResultsTable from './ResultsTable.vue'
import type { ResultGroup } from '@shared/domain/result-grouping'
import type { ChannelOutput } from '@shared/contracts'

type ResultRow = ChannelOutput<'results:listByAssessment'>[number]

defineProps<{
  group: ResultGroup<ResultRow>
  assessmentId: string
  editingId: string | null
  instrumentLabel: 'path' | 'name'
}>()

const emit = defineEmits<{
  edit: [id: string]
  remove: [result: ResultRow]
  saved: []
  cancel: []
}>()
</script>

<template>
  <details class="group/node">
    <summary
      class="flex cursor-pointer select-none list-none items-center gap-2 rounded px-1 py-1 hover:bg-ink-50"
    >
      <span
        class="w-3 shrink-0 text-center text-ink-400 transition-transform group-open/node:rotate-90"
        aria-hidden="true"
      >
        ▸
      </span>
      <span
        :class="
          group.depth === 0
            ? 'text-sm font-semibold text-ink-800'
            : 'text-xs font-semibold uppercase tracking-wide text-ink-500'
        "
      >
        {{ group.name }}
      </span>
      <span class="text-xs font-normal text-ink-400">
        {{ group.total }} {{ group.total === 1 ? 'resultado' : 'resultados' }}
      </span>
    </summary>

    <div class="mb-2 ml-2 space-y-2 border-l border-ink-200 pb-1 pl-3 pt-2">
      <ResultsTable
        v-if="group.rows.length > 0"
        :rows="group.rows"
        :assessment-id="assessmentId"
        :editing-id="editingId"
        :instrument-label="instrumentLabel"
        @edit="emit('edit', $event)"
        @remove="emit('remove', $event)"
        @saved="emit('saved')"
        @cancel="emit('cancel')"
      />

      <ResultGroupAccordion
        v-for="child in group.children"
        :key="child.id ?? '__none__'"
        :group="child"
        :assessment-id="assessmentId"
        :editing-id="editingId"
        :instrument-label="instrumentLabel"
        @edit="emit('edit', $event)"
        @remove="emit('remove', $event)"
        @saved="emit('saved')"
        @cancel="emit('cancel')"
      />
    </div>
  </details>
</template>
