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
import { X } from 'lucide-vue-next'
import BaseIconButton from './BaseIconButton.vue'

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
      <DialogOverlay class="fixed inset-0 z-40 bg-scrim/40" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-surface bg-surface shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-lg'
        ]"
      >
        <header class="border-b border-line px-5 py-4">
          <DialogTitle class="text-base font-semibold text-fg">{{ title }}</DialogTitle>
          <DialogDescription v-if="description" class="mt-1 text-sm text-fg-muted">
            {{ description }}
          </DialogDescription>
        </header>

        <div class="px-5 py-4">
          <slot />
        </div>

        <footer
          v-if="$slots.footer"
          class="flex items-center justify-end gap-2 border-t border-line px-5 py-3"
        >
          <slot name="footer" />
        </footer>

        <DialogClose as-child>
          <BaseIconButton :icon="X" label="Fechar" class="absolute right-3 top-3" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
