<script setup lang="ts">
/**
 * Selo de estado ou etiqueta (Arquivado, situação do documento, tags).
 *
 * A cor das classificações não passa por aqui: ela vem da faixa cadastrada
 * pelo usuário e tem componente próprio (`ClassificationBadge`).
 */
withDefaults(defineProps<{ tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok' }>(), {
  tone: 'neutral'
})

const TONES = {
  neutral: 'bg-surface-muted text-fg-muted',
  accent: 'bg-accent-soft text-accent-strong',
  warn: 'bg-warn-soft text-warn-strong',
  danger: 'bg-danger-soft text-danger-strong',
  ok: 'bg-ok-soft text-ok'
} as const
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded-chip px-2 py-0.5 align-middle text-xs font-medium"
    :class="TONES[tone]"
  >
    <slot />
  </span>
</template>
