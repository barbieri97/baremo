<script setup lang="ts">
/**
 * Cabeçalho de tela: link de volta, título, linha de contexto e ações.
 *
 * `md` é o tamanho das telas de trabalho em altura cheia (documento,
 * assistente), em que o cabeçalho é uma barra e o espaço vertical vale mais.
 */
import { useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import BaseButton from './BaseButton.vue'

withDefaults(
  defineProps<{
    title?: string
    subtitle?: string | null
    back?: { label: string; to: string } | null
    size?: 'md' | 'lg'
  }>(),
  { title: undefined, subtitle: null, back: null, size: 'lg' }
)

const router = useRouter()
</script>

<template>
  <header>
    <div class="flex items-start justify-between gap-6">
      <div class="min-w-0">
        <BaseButton
          v-if="back !== null"
          variant="link-muted"
          size="sm"
          :icon="ArrowLeft"
          @click="router.push(back.to)"
        >
          {{ back.label }}
        </BaseButton>
        <h1
          class="font-bold text-fg"
          :class="[size === 'lg' ? 'text-xl' : 'text-lg', { 'mt-1': back !== null }]"
        >
          <slot name="title">{{ title }}</slot>
        </h1>
        <p
          v-if="subtitle || $slots.subtitle"
          class="max-w-3xl text-fg-subtle"
          :class="size === 'lg' ? 'mt-1 text-sm' : 'mt-0.5 text-xs'"
        >
          <slot name="subtitle">{{ subtitle }}</slot>
        </p>
      </div>

      <div v-if="$slots.actions" class="flex flex-wrap items-center justify-end gap-2">
        <slot name="actions" />
      </div>
    </div>

    <slot />
  </header>
</template>
