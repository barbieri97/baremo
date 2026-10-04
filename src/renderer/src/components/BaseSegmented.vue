<script setup lang="ts" generic="T extends string">
/**
 * Escolha exclusiva entre poucas opções, sempre visíveis (modo de agrupamento,
 * modo de lançamento). É um `radiogroup`: a escolha muda a tela na hora, não
 * é um formulário a submeter.
 */
export interface SegmentedOption<V extends string = string> {
  value: V
  label: string
}

defineProps<{ options: readonly SegmentedOption<T>[]; label: string }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div
    class="inline-flex rounded-control border border-line-strong bg-surface p-0.5 text-xs"
    role="radiogroup"
    :aria-label="label"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      class="rounded-chip px-3 py-1 font-medium transition-colors"
      :class="
        model === option.value
          ? 'bg-accent text-fg-inverse'
          : 'text-fg-muted hover:bg-surface-muted'
      "
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
