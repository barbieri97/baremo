<script setup lang="ts">
/**
 * Etiqueta "também avalia: …" com as funções secundárias de um instrumento.
 *
 * Só informativa: agrupar e agregar resultados continua usando a função
 * principal (SPEC funções múltiplas, F2).
 */
import { computed } from 'vue'
import { alsoAssessesLabel } from '@shared/domain/instrument-functions'

const props = defineProps<{ functions: readonly ({ name: string } | string)[] }>()

const label = computed(() => alsoAssessesLabel(props.functions))
</script>

<template>
  <span
    v-if="label !== null"
    class="mt-0.5 block text-xs text-fg-subtle"
    data-testid="also-assesses"
  >
    {{ label }}
  </span>
</template>
