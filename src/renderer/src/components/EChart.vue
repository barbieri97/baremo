<script setup lang="ts">
/**
 * Wrapper do ECharts (spec §7.3).
 *
 * Existe para três coisas que, esquecidas, viram vazamento: `dispose` ao
 * desmontar, `ResizeObserver` para o gráfico acompanhar a largura do cartão, e
 * `setOption(option, true)` — com `notMerge`, porque trocar de tipo de gráfico
 * pela UI substitui a opção inteira. Sem `notMerge`, o `xAxis` de um gráfico de
 * colunas sobreviveria por baixo de uma pizza.
 *
 * A exportação de imagem mora aqui pelo mesmo motivo: é esta instância que tem
 * o estado que o usuário está vendo. O PNG sai do renderer canvas; o SVG exige
 * uma instância temporária com o renderer SVG, porque `getDataURL` ignora
 * `type` quando o renderer já é SVG e devolveria sempre `image/svg+xml`.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

const props = withDefaults(
  defineProps<{
    option: EChartsOption
    /** Altura em pixels; a largura acompanha o contêiner. */
    height?: number
  }>(),
  { height: 320 }
)

const container = ref<HTMLDivElement | null>(null)
/** `shallowRef`: a instância do ECharts é grande e não deve virar reativa. */
const chart = shallowRef<echarts.ECharts | null>(null)
let observer: ResizeObserver | null = null

onMounted(() => {
  if (container.value === null) return

  chart.value = echarts.init(container.value, null, { renderer: 'canvas' })
  chart.value.setOption(props.option, true)

  observer = new ResizeObserver(() => chart.value?.resize())
  observer.observe(container.value)
})

watch(
  () => props.option,
  (option) => chart.value?.setOption(option, true)
)

watch(
  () => props.height,
  () => chart.value?.resize()
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart.value?.dispose()
  chart.value = null
})

/** PNG em 3× para o arquivo salvo não sair borrado ao ser ampliado. */
function toPng(): string | null {
  return chart.value?.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#ffffff' }) ?? null
}

/**
 * SVG a partir de uma instância descartável.
 *
 * Trocar o renderer da instância viva não é possível, e reinicializá-la faria o
 * gráfico piscar na tela no meio de um "salvar como".
 */
function toSvg(): string | null {
  const element = container.value
  if (element === null) return null

  const offscreen = document.createElement('div')
  offscreen.style.width = `${element.clientWidth}px`
  offscreen.style.height = `${props.height}px`

  const temporary = echarts.init(offscreen, null, {
    renderer: 'svg',
    width: element.clientWidth,
    height: props.height
  })

  try {
    temporary.setOption({ ...props.option, animation: false }, true)
    return temporary.renderToSVGString()
  } finally {
    temporary.dispose()
  }
}

defineExpose({ toPng, toSvg })
</script>

<template>
  <div ref="container" :style="{ height: `${height}px` }" class="w-full" />
</template>
