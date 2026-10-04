<script setup lang="ts" generic="T extends string">
/**
 * Abas de uma tela (Configurações, ficha do instrumento).
 *
 * Só a lista de abas: o conteúdo continua nas telas, com `v-if`, porque cada
 * painel carrega dados próprios e não deve montar antes de ser aberto. As setas
 * do teclado movem entre abas, como o padrão ARIA de `tablist` pede.
 */
import { ref } from 'vue'

export interface TabItem<V extends string = string> {
  value: V
  label: string
}

defineProps<{ items: readonly TabItem<T>[]; label?: string }>()
const model = defineModel<T>({ required: true })

const buttons = ref<HTMLButtonElement[]>([])

function move(items: readonly TabItem<T>[], index: number, delta: number): void {
  const next = (index + delta + items.length) % items.length
  model.value = items[next]!.value
  buttons.value[next]?.focus()
}
</script>

<template>
  <div role="tablist" :aria-label="label" class="flex gap-1 border-b border-line">
    <button
      v-for="(item, index) in items"
      :key="item.value"
      ref="buttons"
      type="button"
      role="tab"
      :aria-selected="model === item.value"
      :tabindex="model === item.value ? 0 : -1"
      class="-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors"
      :class="
        model === item.value
          ? 'border-accent text-accent-strong'
          : 'border-transparent text-fg-subtle hover:text-fg-secondary'
      "
      @click="model = item.value"
      @keydown.right.prevent="move(items, index, 1)"
      @keydown.left.prevent="move(items, index, -1)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
