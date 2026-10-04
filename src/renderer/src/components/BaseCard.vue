<script setup lang="ts">
/**
 * Superfície com borda: o contêiner padrão de painéis, formulários e tabelas.
 *
 * `accent` marca uma área em edição ou um bloco inserido (linha de
 * lançamento, blocos dinâmicos do editor, área de soltar arquivo).
 */
withDefaults(
  defineProps<{
    as?: string
    padding?: 'none' | 'sm' | 'md' | 'lg'
    variant?: 'default' | 'accent'
  }>(),
  { as: 'div', padding: 'none', variant: 'default' }
)

const PADDINGS = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' } as const
const VARIANTS = {
  default: 'border-line bg-surface',
  accent: 'border-accent-line bg-accent-soft/40'
} as const
</script>

<template>
  <component
    :is="as"
    class="rounded-surface border"
    :class="[PADDINGS[padding], VARIANTS[variant]]"
  >
    <slot />
  </component>
</template>
