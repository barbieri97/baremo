<script setup lang="ts">
/**
 * Botão do aplicativo.
 *
 * `type="button"` é o padrão de propósito: dentro de um formulário, o padrão do
 * HTML é `submit`, e um botão de ação secundária que submete o formulário por
 * engano é a fonte mais comum de gravação acidental.
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    disabled?: boolean
    loading?: boolean
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', disabled: false, loading: false }
)

const classes = computed(() => {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'

  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm'
  }

  const variants = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600',
    secondary: 'bg-white text-ink-700 border border-ink-300 hover:bg-ink-100',
    ghost: 'text-ink-600 hover:bg-ink-100',
    danger: 'bg-danger-500 text-white hover:bg-danger-600'
  }

  return [base, sizes[props.size], variants[props.variant]].join(' ')
})
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading">
    <span
      v-if="loading"
      class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
    <slot />
  </button>
</template>
