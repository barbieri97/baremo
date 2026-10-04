<script setup lang="ts">
/**
 * Visualizar resultados (spec §7.3).
 *
 * A grade da avaliação (§4.8) é uma tabela de digitação: ótima para lançar
 * escore, ruim para enxergar o caso. Esta tela responde outras perguntas, e por
 * isso organiza os mesmos dados de duas maneiras.
 *
 * O **panorama por função** responde "onde está o problema?" — cartões
 * ordenados da função mais rebaixada para a mais preservada, com a cor do nível
 * médio antes de qualquer texto.
 *
 * A seção **por teste** responde "como este instrumento se comportou?" — os
 * subtestes lado a lado, no tipo de gráfico que quem lê escolher, com a faixa
 * esperada ao fundo.
 *
 * A agregação inteira vem pronta do processo principal, num canal só
 * (`results:overview`), e é a MESMA que gera o PDF. Montá-la aqui a partir de
 * `results:listByAssessment` seria a maneira de a tela e o laudo passarem a
 * discordar sem ninguém notar.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from '../components/BaseButton.vue'
import ChartCard from '../components/ChartCard.vue'
import ClassificationBadge from '../components/ClassificationBadge.vue'
import FunctionHeatCard from '../components/FunctionHeatCard.vue'
import LevelHeatBar from '../components/LevelHeatBar.vue'
import PageHeader from '../components/PageHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import BaseAlert from '../components/BaseAlert.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseCheckbox from '../components/BaseCheckbox.vue'
import BaseEmptyState from '../components/BaseEmptyState.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import { comparisonOption, evolutionOption, functionRadarOption } from '@shared/charts/options'
import type { ChartKind } from '@shared/charts/options'
import { CLASSIFICATION_LEVELS, levelColor, levelLabel } from '@shared/domain/levels'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import { formatIsoDate } from '@shared/domain/dates'
import type { ChannelOutput } from '@shared/contracts'
import type { FunctionRadar, ResultPoint, TestGroup } from '@shared/contracts/results'
import type { EChartsOption } from 'echarts'

const FUNCTION_COLUMNS: TableColumn[] = [
  { key: 'instrument', label: 'Instrumento' },
  { key: 'scoreType', label: 'Escore', class: 'w-24' },
  { key: 'value', label: 'Valor', align: 'right', class: 'w-20' },
  { key: 'classification', label: 'Classificação', class: 'w-44' },
  { key: 'level', label: 'Nível', class: 'w-32' },
  { key: 'status', label: 'Situação', class: 'w-28' }
]

const props = defineProps<{ id: string }>()

const appStore = useAppStore()

type Overview = ChannelOutput<'results:overview'>
type AssessmentOption = ChannelOutput<'assessments:listByPatient'>[number]

const overview = ref<Overview | null>(null)
const siblings = ref<AssessmentOption[]>([])
const comparisonIds = ref<string[]>([])
const loading = ref(true)
const exporting = ref(false)

/** Tipo de gráfico por teste: a escolha é de quem lê, e é por teste. */
const kindByTest = ref<Record<string, ChartKind>>({})
const normBand = ref(true)

const SCREEN = { forPrint: false } as const

async function load(): Promise<void> {
  loading.value = true
  try {
    const data = await api('results:overview', {
      assessmentId: props.id,
      comparisonAssessmentIds: comparisonIds.value
    })
    overview.value = data

    if (siblings.value.length === 0) {
      const assessment = await api('assessments:get', { id: props.id })
      siblings.value = await api('assessments:listByPatient', {
        patientId: assessment.patientId,
        includeArchived: false
      })
    }
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(comparisonIds, load, { deep: true })

const assessments = computed(() => overview.value?.assessments ?? [])
const comparing = computed(() => assessments.value.length > 1)
const testColumns = computed<TableColumn[]>(() => [
  { key: 'subtest', label: 'Subteste' },
  { key: 'scoreType', label: 'Escore', class: 'w-20' },
  ...assessments.value.map((assessment) => ({
    key: assessment.id,
    label: assessment.dateLabel,
    align: 'right' as const,
    class: 'w-32'
  })),
  ...(comparing.value ? [] : [{ key: 'classification', label: 'Classificação', class: 'w-44' }])
])

/** As outras avaliações do paciente, que podem entrar na comparação. */
const comparableSiblings = computed(() =>
  siblings.value.filter((assessment) => assessment.id !== props.id)
)

// O corte de eixo mínimo não mora mais aqui: o view-model só entrega radar que
// dá para desenhar, e é o mesmo objeto que o PDF recebe.
const radarOption = computed(() =>
  overview.value?.overallRadar == null
    ? null
    : functionRadarOption(overview.value.overallRadar.axes, SCREEN)
)

function radarOptionFor(radar: FunctionRadar): EChartsOption {
  return functionRadarOption(radar.axes, SCREEN)
}

function kindFor(group: TestGroup): ChartKind {
  return kindByTest.value[group.instrumentId] ?? 'column'
}

function setKind(group: TestGroup, kind: ChartKind): void {
  kindByTest.value = { ...kindByTest.value, [group.instrumentId]: kind }
}

function chartFor(group: TestGroup): ReturnType<typeof comparisonOption> {
  return comparisonOption(group, assessments.value, kindFor(group), {
    forPrint: false,
    showNormBand: normBand.value
  })
}

function evolutionFor(group: TestGroup): ReturnType<typeof evolutionOption> {
  return evolutionOption(group, assessments.value, SCREEN)
}

function formatValue(point: ResultPoint | null): string {
  if (point === null || point.value === null) return '—'
  return point.value.toFixed(SCORE_TYPE_DOMAINS[point.scoreType].decimals).replace('.', ',')
}

/** Rola até a seção da função clicada no panorama. */
function focusFunction(id: string | null): void {
  const element = document.getElementById(`funcao-${id ?? 'sem-funcao'}`)
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function exportPdf(): Promise<void> {
  exporting.value = true
  try {
    const result = await api('reports:generate', {
      kind: 'results',
      assessmentId: props.id,
      comparisonAssessmentIds: comparisonIds.value,
      comparisonAssessmentId: null,
      documentId: null
    })
    if (!result.cancelled) appStore.notify('success', 'Relatório gerado.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <BaseEmptyState v-if="loading" message="Carregando resultados…" class="py-16" />

    <template v-else-if="overview !== null">
      <PageHeader
        :title="`Resultados de ${overview.patient.fullName}`"
        :back="{ label: 'Voltar à avaliação', to: `/avaliacoes/${id}` }"
        class="mb-6"
      >
        <template #subtitle>
          Avaliação de {{ overview.assessmentDate }}
          <template v-if="overview.patient.ageAtAssessment">
            · {{ overview.patient.ageAtAssessment }}
          </template>
          · {{ overview.totalResults }}
          {{ overview.totalResults === 1 ? 'resultado' : 'resultados' }}
        </template>
        <template #actions>
          <BaseButton variant="primary" :loading="exporting" @click="exportPdf">
            Exportar PDF
          </BaseButton>
        </template>
      </PageHeader>

      <BaseAlert v-if="overview.missingLevels > 0" tone="warn" class="mb-6">
        <span class="font-medium">
          {{ overview.missingLevels }} de {{ overview.totalResults }}
          {{ overview.missingLevels === 1 ? 'resultado está' : 'resultados estão' }} sem nível.
        </span>
        Eles aparecem em cinza, e não entram na média das funções. Defina o nível das faixas em
        Instrumentos e use "Reprocessar classificações" na avaliação para aplicá-lo — reprocessar é
        ação explícita, e mostra a prévia antes de gravar.
      </BaseAlert>

      <!-- ── Comparar com outras avaliações ────────────────────────────── -->
      <BaseCard v-if="comparableSiblings.length > 0" as="section" padding="md" class="mb-6">
        <SectionHeader title="Comparar com outras avaliações" size="sm" class="mb-2" />
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          <BaseCheckbox
            v-for="assessment in comparableSiblings"
            :key="assessment.id"
            v-model="comparisonIds"
            :value="assessment.id"
            :label="formatIsoDate(assessment.date)"
          />
        </div>
      </BaseCard>

      <BaseEmptyState
        v-if="overview.totalResults === 0"
        framed
        message="Esta avaliação ainda não tem resultados lançados."
      />

      <template v-else>
        <!-- ── Panorama por função ─────────────────────────────────────── -->
        <section class="mb-8">
          <SectionHeader
            title="Panorama por função"
            description="Ordenado da função mais rebaixada para a mais preservada. O número é o nível médio, de 1 (muito rebaixado) a 5 (muito acima do esperado)."
            class="mb-3"
          />

          <div class="grid gap-4 lg:grid-cols-[1fr_460px]">
            <!-- `content-start`: sem isso as linhas esticam até a altura do
                 radar ao lado, e cada cartão ganha um vão morto embaixo. -->
            <div class="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <FunctionHeatCard
                v-for="summary in overview.functions"
                :key="summary.id ?? '__none__'"
                :summary="summary"
                @select="focusFunction"
              />
            </div>

            <ChartCard
              v-if="radarOption !== null"
              title="Perfil por função"
              subtitle="Nível médio, de 1 a 5"
              :option="radarOption"
              :file-name="`perfil-${overview.patient.fullName}`"
              :height="380"
              :kinds="[]"
            />
          </div>

          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-subtle">
            <span
              v-for="entry in CLASSIFICATION_LEVELS"
              :key="entry.level"
              class="flex items-center gap-1.5"
            >
              <span class="size-2.5 rounded-chip" :style="{ backgroundColor: entry.hex }" />
              {{ entry.level }} · {{ entry.label }}
            </span>
          </div>
        </section>

        <!-- ── Detalhe por função ──────────────────────────────────────── -->
        <section class="mb-8">
          <SectionHeader title="Detalhe por função" class="mb-3" />

          <!-- Agrupado por função raiz: o radar de um pai compara as filhas dele,
               e só se lê junto das tabelas dessas filhas. Uma função pai sem
               instrumentos próprios não teria bloco nenhum numa lista plana. -->
          <div
            v-for="group in overview.functionGroups"
            :key="group.rootId ?? '__none__'"
            class="mb-6"
          >
            <div class="mb-2 flex items-center gap-3">
              <h3 class="text-sm font-semibold text-fg">{{ group.name }}</h3>
              <LevelHeatBar
                :distribution="group.distribution"
                class="max-w-40 flex-1"
                :height="6"
              />
              <span class="text-xs text-fg-subtle">
                {{ group.resultCount }}
                {{ group.resultCount === 1 ? 'resultado' : 'resultados' }}
              </span>
            </div>

            <ChartCard
              v-for="radar in group.radars"
              :key="radar.parentId ?? '__root__'"
              class="mb-3"
              :title="radar.title"
              subtitle="Nível médio por subfunção, de 1 a 5"
              :option="radarOptionFor(radar)"
              :file-name="`perfil-${radar.title}-${overview.patient.fullName}`"
              :height="340"
              :kinds="[]"
            />

            <div
              v-for="summary in group.functions"
              :id="`funcao-${summary.id ?? 'sem-funcao'}`"
              :key="summary.id ?? '__none__'"
              class="mb-4 scroll-mt-4 border-l border-line pl-3"
            >
              <div class="mb-1 flex items-center gap-3">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                  {{ summary.name }}
                </h4>
                <LevelHeatBar
                  :distribution="summary.distribution"
                  class="max-w-40 flex-1"
                  :height="6"
                />
              </div>

              <BaseCard class="overflow-hidden">
                <BaseTable :columns="FUNCTION_COLUMNS">
                  <tr v-for="point in summary.points" :key="point.resultId">
                    <td class="text-fg">{{ point.instrumentPath }}</td>
                    <td class="text-fg-muted">{{ point.scoreTypeLabel }}</td>
                    <td class="tabular text-right font-medium text-fg">
                      {{ formatValue(point) }}
                    </td>
                    <td>
                      <ClassificationBadge
                        :name="point.classificationName"
                        :color-hex="point.colorHex"
                        :overridden="point.manuallyOverridden"
                      />
                    </td>
                    <td>
                      <span class="flex items-center gap-1.5 text-xs text-fg-muted">
                        <span
                          class="size-2.5 shrink-0 rounded-chip"
                          :style="{ backgroundColor: levelColor(point.classificationLevel) }"
                        />
                        {{ levelLabel(point.classificationLevel) }}
                      </span>
                    </td>
                    <td class="text-fg-muted">{{ point.statusLabel }}</td>
                  </tr>
                </BaseTable>
              </BaseCard>
            </div>
          </div>
        </section>

        <!-- ── Por teste ───────────────────────────────────────────────── -->
        <section>
          <SectionHeader
            title="Por teste"
            description="Os subtestes na régua normalizada de 0 a 100, em que 100 é sempre o melhor desempenho — é o que torna comparáveis escores de escalas diferentes."
            class="mb-3"
          />

          <div v-for="group in overview.tests" :key="group.instrumentId" class="mb-6">
            <BaseCard class="mb-3 overflow-hidden">
              <BaseTable :columns="testColumns">
                <template #caption>
                  {{ group.label }}
                  <span v-if="group.inverted" class="ml-2 text-xs font-normal text-warn-strong">
                    escore alto indica pior desempenho
                  </span>
                </template>
                <tr v-for="entry in group.entries" :key="entry.key">
                  <td class="text-fg">{{ entry.label }}</td>
                  <td class="text-fg-muted">{{ entry.scoreTypeLabel }}</td>
                  <td
                    v-for="(point, index) in entry.values"
                    :key="index"
                    class="tabular text-right font-medium text-fg"
                  >
                    {{ formatValue(point) }}
                  </td>
                  <td v-if="!comparing">
                    <ClassificationBadge
                      :name="entry.values[0]?.classificationName ?? null"
                      :color-hex="entry.values[0]?.colorHex ?? null"
                      :overridden="entry.values[0]?.manuallyOverridden ?? false"
                    />
                  </td>
                </tr>
              </BaseTable>
            </BaseCard>

            <ChartCard
              v-if="group.comparable"
              :title="`Comparação — ${group.label}`"
              subtitle="Posição na escala, de 0 a 100"
              :option="chartFor(group)"
              :file-name="`${group.acronym ?? group.name}-comparacao`"
              :model-value="kindFor(group)"
              :kind="kindFor(group)"
              v-model:norm-band="normBand"
              show-band-toggle
              @update:kind="setKind(group, $event)"
            />

            <ChartCard
              v-if="group.comparable && comparing"
              :title="`Evolução — ${group.label}`"
              subtitle="Uma linha por subteste, ao longo das avaliações"
              :option="evolutionFor(group)"
              :file-name="`${group.acronym ?? group.name}-evolucao`"
              :kinds="[]"
              class="mt-3"
            />
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
