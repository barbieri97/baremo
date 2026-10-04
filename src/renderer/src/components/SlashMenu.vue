<script setup lang="ts">
/**
 * Popover do slash menu (spec §9.2).
 *
 * Renderização e teclado: setas movem, Enter escolhe, Esc fecha. O estado vem
 * do componente pai, que conecta a extensão do TipTap a este popover.
 */
import { nextTick, ref, watch } from 'vue'
import type { SlashItem } from '../editor/slash-menu'

const props = defineProps<{
  items: SlashItem[]
  position: { top: number; left: number } | null
}>()

const selected = ref(0)
const list = ref<HTMLElement | null>(null)

const emit = defineEmits<{ pick: [item: SlashItem] }>()

watch(
  () => props.items,
  () => {
    selected.value = 0
  }
)

async function scrollSelectedIntoView(): Promise<void> {
  await nextTick()
  list.value?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}

/** Devolve `true` quando consumiu a tecla — é o contrato do `Suggestion`. */
function handleKey(event: KeyboardEvent): boolean {
  if (props.items.length === 0) return false

  if (event.key === 'ArrowDown') {
    selected.value = (selected.value + 1) % props.items.length
    void scrollSelectedIntoView()
    return true
  }

  if (event.key === 'ArrowUp') {
    selected.value = (selected.value - 1 + props.items.length) % props.items.length
    void scrollSelectedIntoView()
    return true
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    const item = props.items[selected.value]
    if (item) emit('pick', item)
    return true
  }

  return false
}

defineExpose({ handleKey })
</script>

<template>
  <div
    v-if="position !== null && items.length > 0"
    class="fixed z-50 w-80 overflow-hidden rounded-control border border-line-strong bg-surface shadow-xl"
    :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    role="listbox"
    aria-label="Inserir bloco"
  >
    <ul ref="list" class="max-h-72 overflow-y-auto py-1">
      <li
        v-for="(item, index) in items"
        :key="item.title"
        :data-selected="index === selected"
        role="option"
        :aria-selected="index === selected"
        class="cursor-pointer px-3 py-1.5"
        :class="index === selected ? 'bg-accent-soft' : 'hover:bg-canvas'"
        @mouseenter="selected = index"
        @mousedown.prevent="emit('pick', item)"
      >
        <p
          class="text-sm"
          :class="index === selected ? 'font-semibold text-accent-strong' : 'text-fg'"
        >
          {{ item.title }}
        </p>
        <p class="text-xs text-fg-subtle">{{ item.hint }}</p>
      </li>
    </ul>

    <p class="border-t border-line px-3 py-1.5 text-xs text-fg-faint">
      ↑↓ navegar · Enter inserir · Esc fechar
    </p>
  </div>
</template>
