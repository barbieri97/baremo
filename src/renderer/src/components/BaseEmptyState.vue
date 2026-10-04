<script setup lang="ts">
/**
 * Estado vazio: nada cadastrado, nada selecionado, módulo desligado.
 *
 * `framed` desenha a própria moldura, para quando o vazio ocupa o lugar de um
 * cartão; sem ele, o vazio fica dentro de um contêiner que já existe.
 */
import BaseCard from './BaseCard.vue'

defineProps<{ title?: string; message?: string; framed?: boolean }>()
</script>

<template>
  <component
    :is="framed ? BaseCard : 'div'"
    class="text-center"
    :class="framed ? 'px-6 py-8' : 'py-6'"
  >
    <h2 v-if="title" class="text-base font-semibold text-fg">{{ title }}</h2>
    <p
      v-if="message || $slots.default"
      class="text-sm"
      :class="title ? 'mt-2 text-fg-muted' : 'text-fg-faint'"
    >
      <slot>{{ message }}</slot>
    </p>
    <div v-if="$slots.actions" class="mt-4 flex justify-center gap-2">
      <slot name="actions" />
    </div>
  </component>
</template>
