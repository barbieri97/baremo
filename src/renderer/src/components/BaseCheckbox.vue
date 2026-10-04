<script setup lang="ts" generic="T extends boolean | unknown[]">
/**
 * Caixa de seleção com rótulo.
 *
 * `class` e `style` ficam no rótulo (o bloco que ocupa espaço no layout); os
 * demais atributos — `value`, `disabled`, `aria-label` — vão para o `<input>`.
 */
import { computed, useAttrs, useSlots } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{ label?: string; description?: string; size?: 'sm' | 'md' }>(), {
  label: undefined,
  description: undefined,
  size: 'md'
})

const model = defineModel<T>()

const attrs = useAttrs()
const slots = useSlots()

const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})
const hasLabel = computed(() => slots.default !== undefined)
const hasDescription = computed(() => slots.description !== undefined)
</script>

<template>
  <label
    v-bind="rootAttrs"
    class="inline-flex gap-2"
    :class="[
      description || hasDescription ? 'items-start' : 'items-center',
      size === 'sm' ? 'text-xs' : 'text-sm'
    ]"
  >
    <input
      v-model="model"
      type="checkbox"
      class="shrink-0 rounded-chip border-line-strong accent-accent disabled:cursor-not-allowed"
      :class="{ 'mt-0.5': description || hasDescription }"
      v-bind="inputAttrs"
    />
    <span v-if="label || hasLabel || description || hasDescription" class="min-w-0">
      <span
        v-if="label || hasLabel"
        :class="description || hasDescription ? 'font-medium text-fg' : 'text-fg-muted'"
      >
        <slot>{{ label }}</slot>
      </span>
      <span v-if="description || hasDescription" class="block text-xs leading-snug text-fg-subtle">
        <slot name="description">{{ description }}</slot>
      </span>
    </span>
  </label>
</template>
