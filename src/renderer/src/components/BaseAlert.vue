<script setup lang="ts">
/**
 * Aviso em bloco: avisos de impacto, erros de validação, notificações.
 *
 * `banner` é a variante de largura total, presa ao topo da área de conteúdo
 * (o aviso de criptografia de disco); as demais ficam dentro do fluxo.
 */
import { X } from 'lucide-vue-next'
import BaseIconButton from './BaseIconButton.vue'

withDefaults(
  defineProps<{
    tone?: 'neutral' | 'info' | 'warn' | 'danger' | 'ok'
    title?: string
    size?: 'sm' | 'md'
    banner?: boolean
    dismissible?: boolean
  }>(),
  { tone: 'neutral', title: undefined, size: 'md', banner: false, dismissible: false }
)

const emit = defineEmits<{ dismiss: [] }>()

const TONES = {
  neutral: 'border-line bg-canvas text-fg-secondary',
  info: 'border-accent-line bg-accent-soft text-accent-strong',
  warn: 'border-warn-line bg-warn-soft text-warn-strong',
  danger: 'border-danger bg-danger-soft text-danger-strong',
  ok: 'border-ok bg-ok-soft text-fg'
} as const
</script>

<template>
  <div
    class="flex items-start gap-3"
    :class="[
      TONES[tone],
      banner ? 'border-b px-6 py-3' : 'rounded-control border',
      !banner && (size === 'sm' ? 'px-3 py-2' : 'p-3'),
      size === 'sm' ? 'text-xs' : 'text-sm'
    ]"
  >
    <div class="min-w-0 flex-1 leading-snug">
      <p v-if="title" class="mb-1 font-semibold">{{ title }}</p>
      <slot />
    </div>

    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>

    <BaseIconButton
      v-if="dismissible"
      :icon="X"
      label="Dispensar"
      size="sm"
      variant="inherit"
      @click="emit('dismiss')"
    />
  </div>
</template>
