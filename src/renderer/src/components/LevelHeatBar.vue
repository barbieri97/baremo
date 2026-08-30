<script setup lang="ts">
/**
 * Barra de calor da distribuição de níveis (spec §7.3).
 *
 * Marcação simples, e não um gráfico: são dezenas destas na tela, uma por
 * função, e cada instância do ECharts custa um canvas e um observador. Aqui o
 * desenho é uma linha de `div`s com largura proporcional — mais leve, mais
 * nítido em qualquer zoom, e trivial de reproduzir no HTML do PDF.
 */
import { computed } from 'vue'
import { CLASSIFICATION_LEVELS, levelLabel, LEVEL_UNKNOWN_HEX } from '@shared/domain/levels'
import type { LevelDistribution } from '@shared/domain/levels'

const props = defineProps<{ distribution: LevelDistribution; height?: number }>()

const total = computed(
  () =>
    CLASSIFICATION_LEVELS.reduce((sum, entry) => sum + props.distribution[entry.level], 0) +
    props.distribution.unknown
)

const segments = computed(() => {
  if (total.value === 0) return []

  const known = CLASSIFICATION_LEVELS.filter((entry) => props.distribution[entry.level] > 0).map(
    (entry) => ({
      key: String(entry.level),
      count: props.distribution[entry.level],
      hex: entry.hex,
      title: `${props.distribution[entry.level]} × ${entry.label}`
    })
  )

  if (props.distribution.unknown > 0) {
    known.push({
      key: 'unknown',
      count: props.distribution.unknown,
      hex: LEVEL_UNKNOWN_HEX,
      title: `${props.distribution.unknown} × ${levelLabel(null)}`
    })
  }

  return known.map((segment) => ({
    ...segment,
    percent: (segment.count / total.value) * 100
  }))
})
</script>

<template>
  <div
    class="flex overflow-hidden rounded-full bg-ink-100"
    :style="{ height: `${height ?? 10}px` }"
    role="img"
    :aria-label="segments.map((s) => s.title).join('; ') || 'Sem resultados'"
  >
    <div
      v-for="segment in segments"
      :key="segment.key"
      :style="{ width: `${segment.percent}%`, backgroundColor: segment.hex }"
      :title="segment.title"
    />
  </div>
</template>
