<script setup lang="ts">
/**
 * Selo de classificação com a cor da faixa.
 *
 * A cor do texto é escolhida pelo contraste (§5), com a mesma função que os
 * templates de PDF usam — é o que garante que a célula colorida seja legível na
 * tela e no papel com qualquer cor que o usuário cadastre.
 */
import { computed } from 'vue'
import { readableTextColor } from '@shared/domain/color'

const props = defineProps<{
  name: string | null
  colorHex: string | null
  /** Marca visualmente a sobrescrita manual da classificação (§4.8). */
  overridden?: boolean
}>()

const background = computed(() =>
  props.colorHex !== null && /^#[0-9A-Fa-f]{6}$/.test(props.colorHex)
    ? props.colorHex
    : '#e2e8f0'
)

const color = computed(() => readableTextColor(background.value))
</script>

<template>
  <span
    v-if="name !== null"
    class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
    :style="{ backgroundColor: background, color }"
    :title="overridden ? 'Classificação definida manualmente pelo profissional' : undefined"
  >
    {{ name }}
    <span v-if="overridden" aria-hidden="true">*</span>
  </span>
  <span v-else class="text-xs text-ink-400">—</span>
</template>
