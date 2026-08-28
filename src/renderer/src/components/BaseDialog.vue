<script setup lang="ts">
/**
 * Diálogo modal, sobre as primitivas da Reka UI.
 *
 * A escolha por primitivas headless em vez de um `<dialog>` próprio é por
 * acessibilidade: foco preso dentro do modal, retorno do foco ao fechar, `Esc`,
 * e os papéis ARIA corretos já vêm resolvidos — e são exatamente as partes que
 * uma implementação caseira costuma errar.
 */
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'

defineProps<{
  title: string
  description?: string
  wide?: boolean
}>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-ink-900/40" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-lg'
        ]"
      >
        <header class="border-b border-ink-200 px-5 py-4">
          <DialogTitle class="text-base font-semibold text-ink-800">{{ title }}</DialogTitle>
          <DialogDescription v-if="description" class="mt-1 text-sm text-ink-600">
            {{ description }}
          </DialogDescription>
        </header>

        <div class="px-5 py-4">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex items-center justify-end gap-2 border-t border-ink-200 px-5 py-3"
        >
          <slot name="footer" />
        </footer>

        <DialogClose
          class="absolute right-3 top-3 rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          aria-label="Fechar"
        >
          <svg viewBox="0 0 20 20" class="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path
              d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
            />
          </svg>
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
