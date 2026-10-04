<script setup lang="ts">
/**
 * Gráfico com seletor de tipo e exportação (spec §7.3).
 *
 * O tipo de gráfico é escolha de quem lê, não do programa: o mesmo conjunto de
 * subtestes é mais claro em colunas para uns e em radar para outros, e um perfil
 * com nomes longos só é legível em barra horizontal. A escolha vive aqui, e não
 * numa configuração global, porque cada teste pede uma leitura diferente.
 *
 * O download passa pelo processo principal (`charts:exportImage`), como todo
 * salvamento no app: o renderer não escreve em disco, e `<a download>` não é o
 * caminho — a CSP e o esquema `app://` não o permitiriam.
 */
import { computed, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from './BaseButton.vue'
import EChart from './EChart.vue'
import BaseCard from './BaseCard.vue'
import BaseCheckbox from './BaseCheckbox.vue'
import BaseField from './BaseField.vue'
import BaseSelect from './BaseSelect.vue'
import SectionHeader from './SectionHeader.vue'
import { CHART_KINDS } from '@shared/charts/options'
import type { ChartKind } from '@shared/charts/options'
import type { EChartsOption } from 'echarts'

const props = withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    option: EChartsOption
    /** Nome sugerido do arquivo, sem extensão. */
    fileName: string
    height?: number
    /** Sem isto o seletor some: um gráfico que não é comparação não troca de tipo. */
    kinds?: readonly ChartKind[]
    showBandToggle?: boolean
  }>(),
  { height: 320, showBandToggle: false, subtitle: undefined, kinds: undefined }
)

const kind = defineModel<ChartKind>('kind', { default: 'column' })
const normBand = defineModel<boolean>('normBand', { default: true })

const appStore = useAppStore()
const chart = ref<InstanceType<typeof EChart> | null>(null)
const exporting = ref(false)

const availableKinds = computed(() =>
  props.kinds === undefined
    ? CHART_KINDS
    : CHART_KINDS.filter((entry) => props.kinds!.includes(entry.kind))
)

async function download(format: 'png' | 'svg'): Promise<void> {
  const content = format === 'png' ? chart.value?.toPng() : chart.value?.toSvg()
  if (content === null || content === undefined) {
    appStore.notify('warning', 'O gráfico ainda não terminou de desenhar.')
    return
  }

  exporting.value = true
  try {
    const result = await api('charts:exportImage', {
      fileName: props.fileName,
      format,
      content
    })
    if (!result.cancelled) {
      appStore.notify('success', `Imagem salva em ${result.filePath}`)
    }
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <BaseCard as="section" padding="md">
    <SectionHeader :title="title" :description="subtitle" size="sm" as="h3" class="mb-3">
      <template #actions>
        <BaseCheckbox v-if="showBandToggle" v-model="normBand" size="sm" label="Faixa esperada" />

        <BaseField
          v-if="availableKinds.length > 1"
          :id="`kind-${fileName}`"
          label="Tipo de gráfico"
          hide-label
        >
          <BaseSelect v-model="kind" size="xs" class="w-auto">
            <option v-for="entry in availableKinds" :key="entry.kind" :value="entry.kind">
              {{ entry.label }}
            </option>
          </BaseSelect>
        </BaseField>

        <BaseButton size="sm" :loading="exporting" @click="download('png')">PNG</BaseButton>
        <BaseButton size="sm" :loading="exporting" @click="download('svg')">SVG</BaseButton>
      </template>
    </SectionHeader>

    <EChart ref="chart" :option="option" :height="height" />
  </BaseCard>
</template>
