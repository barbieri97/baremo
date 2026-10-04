<script setup lang="ts">
/**
 * NodeView do `bloco-grafico` — perfil por função cognitiva (spec §9.2).
 *
 * O SVG é montado à mão, sem biblioteca de charting. Não é economia de
 * dependência: a janela de impressão do PDF roda sob `default-src 'none'` e sem
 * JavaScript, então um gráfico que dependesse de script na renderização
 * simplesmente não apareceria no documento final. Desenhar SVG estático é o que
 * funciona nos dois lugares.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { NodeViewProps } from '@tiptap/vue-3'
import { api } from '../api'
import BaseCard from '../components/BaseCard.vue'
import type { ChannelOutput } from '@shared/contracts'

const props = defineProps<NodeViewProps>()

type ChartData = ChannelOutput<'documents:profileChart'>

const data = ref<ChartData | null>(null)
const error = ref<string | null>(null)

const assessmentId = computed(() => props.node.attrs['assessmentId'] as string | null)

const BAR_HEIGHT = 18
const GAP = 8
const LABEL_WIDTH = 150
const CHART_WIDTH = 320

async function load(): Promise<void> {
  if (assessmentId.value === null) {
    error.value = 'Nenhuma avaliação selecionada para este gráfico.'
    return
  }

  error.value = null
  try {
    data.value = await api('documents:profileChart', { assessmentId: assessmentId.value })
  } catch {
    error.value = 'Não foi possível carregar o perfil desta avaliação.'
  }
}

onMounted(load)
watch(assessmentId, load)

const height = computed(() => (data.value?.points.length ?? 0) * (BAR_HEIGHT + GAP) + 24)
const width = LABEL_WIDTH + CHART_WIDTH + 40

function barY(index: number): number {
  return index * (BAR_HEIGHT + GAP) + 16
}

function barLength(normalized: number): number {
  return Math.max(2, Math.round((normalized / 100) * CHART_WIDTH))
}

function truncate(value: string, max = 28): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
</script>

<template>
  <NodeViewWrapper>
    <BaseCard
      variant="accent"
      padding="sm"
      class="my-4"
      :class="{ 'ring-2 ring-accent': selected }"
    >
      <p
        class="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-strong"
        contenteditable="false"
      >
        Perfil por função cognitiva
      </p>

      <div contenteditable="false">
        <p v-if="error !== null" class="py-4 text-center text-xs text-warn-strong">{{ error }}</p>

        <p
          v-else-if="data !== null && data.points.length === 0"
          class="py-4 text-center text-xs text-fg-faint"
        >
          Sem resultados suficientes para montar o perfil. Vincule os instrumentos a funções
          cognitivas e lance ao menos um resultado com valor.
        </p>

        <svg
          v-else-if="data !== null"
          :viewBox="`0 0 ${width} ${height}`"
          class="w-full bg-surface"
          role="img"
          aria-label="Perfil por função cognitiva"
        >
          <line
            v-for="percent in [25, 50, 75]"
            :key="percent"
            :x1="LABEL_WIDTH + (percent / 100) * CHART_WIDTH"
            y1="8"
            :x2="LABEL_WIDTH + (percent / 100) * CHART_WIDTH"
            :y2="height - 8"
            class="stroke-line-strong"
            stroke-width="0.5"
            stroke-dasharray="2 2"
          />

          <template v-for="(point, index) in data.points" :key="point.cognitiveFunctionName">
            <text
              x="0"
              :y="barY(index) + BAR_HEIGHT * 0.72"
              font-size="9"
              class="fill-fg-secondary"
            >
              {{ truncate(point.cognitiveFunctionName) }}
            </text>
            <rect
              :x="LABEL_WIDTH"
              :y="barY(index)"
              :width="CHART_WIDTH"
              :height="BAR_HEIGHT"
              class="fill-surface-muted"
            />
            <rect
              :x="LABEL_WIDTH"
              :y="barY(index)"
              :width="barLength(point.normalized)"
              :height="BAR_HEIGHT"
              class="fill-accent"
            />
            <text
              :x="LABEL_WIDTH + barLength(point.normalized) + 6"
              :y="barY(index) + BAR_HEIGHT * 0.72"
              font-size="8.5"
              class="fill-fg-muted"
            >
              {{ point.normalized.toFixed(0) }}
            </text>
          </template>
        </svg>

        <p class="mt-2 text-xs leading-snug text-fg-subtle">
          Escores de tipos diferentes são normalizados pela posição no domínio de cada métrica, para
          caberem na mesma escala. A conversão é posicional, não psicométrica: o gráfico serve para
          leitura de perfil, não para comparar magnitude entre instrumentos.
        </p>
      </div>
    </BaseCard>
  </NodeViewWrapper>
</template>
