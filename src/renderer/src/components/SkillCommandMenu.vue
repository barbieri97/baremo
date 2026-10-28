<script setup lang="ts">
/**
 * Menu de skills do composer do chat: aparece ao digitar `/` no início da
 * mensagem.
 *
 * Mesmo visual e mesmo contrato de teclado de `SlashMenu.vue` (setas movem,
 * Enter/Tab escolhe, o pai cuida do Esc), mas separado dele: aquele é preso à
 * `Suggestion` do TipTap, e o composer é um textarea comum. Abre para cima,
 * ancorado ao próprio composer, em vez de posicionado por coordenada de cursor.
 */
import { nextTick, ref, watch } from 'vue'

export interface SkillCommandItem {
  readonly name: string
  readonly description: string
}

const props = defineProps<{ items: SkillCommandItem[] }>()

const emit = defineEmits<{ pick: [item: SkillCommandItem] }>()

const selected = ref(0)
const list = ref<HTMLElement | null>(null)

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

/** Devolve `true` quando consumiu a tecla. */
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

  if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
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
    v-if="items.length > 0"
    class="absolute bottom-full left-0 z-50 mb-2 w-96 overflow-hidden rounded-control border border-line-strong bg-surface shadow-xl"
    role="listbox"
    aria-label="Aplicar skill"
    data-testid="skill-command-menu"
  >
    <ul ref="list" class="max-h-72 overflow-y-auto py-1">
      <li
        v-for="(item, index) in items"
        :key="item.name"
        :data-selected="index === selected"
        role="option"
        :aria-selected="index === selected"
        class="cursor-pointer px-3 py-1.5"
        :class="index === selected ? 'bg-accent-soft' : 'hover:bg-canvas'"
        @mouseenter="selected = index"
        @mousedown.prevent="emit('pick', item)"
      >
        <p
          class="font-mono text-sm"
          :class="index === selected ? 'font-semibold text-accent-strong' : 'text-fg'"
        >
          /{{ item.name }}
        </p>
        <p class="text-xs text-fg-subtle">{{ item.description }}</p>
      </li>
    </ul>

    <p class="border-t border-line px-3 py-1.5 text-xs text-fg-faint">
      ↑↓ navegar · Enter aplicar · Esc fechar
    </p>
  </div>
</template>
