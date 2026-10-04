<script setup lang="ts">
/** Barra de progresso de 0 a 100 (consumo do teto de tokens). */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ value: number; tone?: 'accent' | 'danger'; label?: string }>(),
  { tone: 'accent', label: undefined }
)

const clamped = computed(() => Math.min(100, Math.max(0, props.value)))
</script>

<template>
  <div
    class="h-2 overflow-hidden rounded-full bg-surface-strong"
    role="progressbar"
    :aria-valuenow="Math.round(clamped)"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="label"
  >
    <div
      class="h-full rounded-full"
      :class="tone === 'danger' ? 'bg-danger' : 'bg-accent'"
      :style="{ width: `${clamped}%` }"
    />
  </div>
</template>
