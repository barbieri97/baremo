<script setup lang="ts">
/**
 * Histórico recolhível das tools que o assistente usou num turno.
 *
 * Aberto enquanto o turno roda (o profissional acompanha o que está sendo
 * consultado); recolhido depois, preso à pergunta que o originou — o registro
 * continua lá, a um clique, em vez de sumir quando a resposta chega.
 */
import { computed } from 'vue'
import { toolLabel } from '@shared/ai/tool-activity'

export interface ToolActivityItem {
  id: string
  toolName: string
  argumentsJson: string
  status: 'running' | 'executed' | 'failed' | 'rejected' | 'awaiting_confirmation'
  summary: string | null
}

const props = withDefaults(defineProps<{ calls: ToolActivityItem[]; open?: boolean }>(), {
  open: false
})

const STATUS_ICONS: Record<ToolActivityItem['status'], string> = {
  running: '…',
  awaiting_confirmation: '…',
  executed: '✓',
  failed: '✗',
  rejected: '⊘'
}

const STATUS_CLASSES: Record<ToolActivityItem['status'], string> = {
  running: 'text-ink-400',
  awaiting_confirmation: 'text-warn-700',
  executed: 'text-ok-500',
  failed: 'text-danger-600',
  rejected: 'text-warn-700'
}

const running = computed(() => props.calls.some((call) => call.status === 'running'))
const failures = computed(() => props.calls.filter((call) => call.status === 'failed').length)

const heading = computed(() => {
  const count = props.calls.length
  const noun = count === 1 ? 'ferramenta utilizada' : 'ferramentas utilizadas'
  const suffix = failures.value > 0 ? ` · ${failures.value} com falha` : ''
  return running.value ? `Consultando… (${count})` : `${count} ${noun}${suffix}`
})

/** Argumentos indentados; um JSON vazio não merece bloco próprio. */
function formatArguments(json: string): string | null {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0) {
      return null
    }
    return JSON.stringify(parsed, null, 2)
  } catch {
    return json === '' ? null : json
  }
}
</script>

<template>
  <details
    class="group max-w-2xl rounded-lg border border-ink-200 bg-ink-50 text-xs"
    :open="open"
    data-testid="tool-activity"
  >
    <summary
      class="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-1.5 text-ink-600 hover:text-ink-800"
    >
      <span class="transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
      <span>{{ heading }}</span>
    </summary>

    <ol class="space-y-1.5 border-t border-ink-200 px-3 py-2">
      <li v-for="call in calls" :key="call.id">
        <div class="flex items-start gap-2">
          <span class="w-3 shrink-0 text-center font-semibold" :class="STATUS_CLASSES[call.status]">
            {{ STATUS_ICONS[call.status] }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="font-medium text-ink-700">{{ toolLabel(call.toolName) }}</span>
            <span class="ml-1 font-mono text-[10px] text-ink-400">{{ call.toolName }}</span>
            <span v-if="call.summary" class="block text-ink-500">{{ call.summary }}</span>

            <details v-if="formatArguments(call.argumentsJson) !== null" class="mt-0.5">
              <summary class="cursor-pointer text-ink-400 hover:text-ink-600">Parâmetros</summary>
              <pre
                class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-[10px] text-ink-600"
                >{{ formatArguments(call.argumentsJson) }}</pre
              >
            </details>
          </span>
        </div>
      </li>
    </ol>
  </details>
</template>
