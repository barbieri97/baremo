<script setup lang="ts">
/**
 * Botão só com ícone.
 *
 * `label` é obrigatório: vira `aria-label` e `title` ao mesmo tempo. Um botão
 * de ícone sem nome é invisível para leitor de tela e enigmático para quem
 * não reconhece o símbolo.
 */
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon: Component
    label: string
    variant?: 'ghost' | 'accent' | 'danger' | 'inherit'
    size?: 'sm' | 'md'
    disabled?: boolean
  }>(),
  { variant: 'ghost', size: 'md', disabled: false }
)

const VARIANTS = {
  ghost: 'text-fg-faint hover:bg-surface-strong hover:text-fg-secondary',
  accent: 'text-accent hover:bg-accent-muted',
  danger: 'text-danger hover:bg-danger-soft',
  /** Herda a cor do contêiner (avisos coloridos). */
  inherit: 'text-current opacity-60 hover:opacity-100'
} as const

const SIZES = {
  sm: { box: 'size-5', icon: 'size-3.5' },
  md: { box: 'size-6', icon: 'size-4' }
} as const
</script>

<template>
  <button
    type="button"
    class="inline-flex shrink-0 items-center justify-center rounded-chip transition-colors disabled:cursor-not-allowed disabled:opacity-40"
    :class="[VARIANTS[variant], SIZES[size].box]"
    :aria-label="label"
    :title="label"
    :disabled="disabled"
  >
    <component :is="icon" :class="SIZES[size].icon" aria-hidden="true" />
  </button>
</template>
