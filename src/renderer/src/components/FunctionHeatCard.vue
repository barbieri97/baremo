<script setup lang="ts">
/**
 * Cartão de uma função cognitiva no panorama (spec §7.3).
 *
 * É a unidade de "bater o olho". Três informações, em ordem de leitura: a cor
 * do nível médio, que responde antes de qualquer texto ser lido; a barra de
 * calor, que mostra se o rebaixamento é geral ou de um resultado só; e a
 * contagem de quantos ficaram abaixo do esperado, que é o número que entra no
 * laudo.
 *
 * Uma função sem nível nenhum aparece em cinza e diz isso — nunca em verde. Um
 * cartão sem nível pintado de verde seria uma afirmação clínica que ninguém
 * fez.
 */
import { computed } from 'vue'
import { levelColorContinuous, levelLabel } from '@shared/domain/levels'
import { readableTextColor } from '@shared/domain/color'
import type { FunctionSummary } from '@shared/contracts/results'
import LevelHeatBar from './LevelHeatBar.vue'
import BaseCard from './BaseCard.vue'

const props = defineProps<{ summary: FunctionSummary }>()
defineEmits<{ select: [id: string | null] }>()

const accent = computed(() => levelColorContinuous(props.summary.averageLevel))
const textOnAccent = computed(() => readableTextColor(accent.value))

const rounded = computed(() =>
  props.summary.averageLevel === null
    ? null
    : (Math.round(props.summary.averageLevel * 10) / 10).toFixed(1).replace('.', ',')
)

/** O rótulo do nível mais próximo, para dar nome ao número. */
const nearestLabel = computed(() =>
  props.summary.averageLevel === null
    ? levelLabel(null)
    : levelLabel(Math.round(props.summary.averageLevel) as 1 | 2 | 3 | 4 | 5)
)
</script>

<template>
  <BaseCard
    as="button"
    type="button"
    padding="md"
    class="flex w-full flex-col gap-3 text-left transition hover:border-line-hover"
    @click="$emit('select', summary.id)"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-fg" :title="summary.name">
          {{ summary.name }}
        </p>
        <p class="mt-0.5 text-xs text-fg-subtle">
          {{ summary.points.length }}
          {{ summary.points.length === 1 ? 'resultado' : 'resultados' }}
        </p>
      </div>

      <span
        class="tabular shrink-0 rounded-chip px-2 py-1 text-lg font-bold leading-none"
        :style="{ backgroundColor: accent, color: textOnAccent }"
        :title="nearestLabel"
      >
        {{ rounded ?? '—' }}
      </span>
    </div>

    <LevelHeatBar :distribution="summary.distribution" />

    <p class="text-xs" :class="summary.belowExpected > 0 ? 'text-danger' : 'text-fg-subtle'">
      <template v-if="summary.belowExpected > 0">
        {{ summary.belowExpected }} de {{ summary.points.length }} abaixo do esperado
      </template>
      <template v-else-if="rounded === null">
        Sem nível cadastrado nas faixas — defina para ver a leitura por cor
      </template>
      <template v-else>Nenhum resultado abaixo do esperado</template>
    </p>
  </BaseCard>
</template>
