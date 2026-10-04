<script setup lang="ts">
/**
 * Título de seção dentro de uma tela (Avaliações, Documentos, Backups…),
 * com contagem, descrição e ações à direita.
 *
 * `sm` é o título dentro de um cartão; `md`, o de uma seção da página.
 * A margem fica com quem usa — o respiro depende do que vem embaixo.
 */
withDefaults(
  defineProps<{
    title: string
    count?: number
    description?: string
    size?: 'sm' | 'md'
    as?: string
  }>(),
  { count: undefined, description: undefined, size: 'md', as: 'h2' }
)
</script>

<template>
  <div
    class="flex flex-wrap justify-between gap-2"
    :class="description || $slots.description ? 'items-start' : 'items-center'"
  >
    <div class="min-w-0">
      <component
        :is="as"
        class="font-semibold text-fg"
        :class="size === 'md' ? 'text-base' : 'text-sm'"
      >
        {{ title }}
        <span v-if="count !== undefined" class="ml-1 text-sm font-normal text-fg-subtle">
          ({{ count }})
        </span>
      </component>
      <p v-if="description || $slots.description" class="mt-0.5 text-xs text-fg-subtle">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>

    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
