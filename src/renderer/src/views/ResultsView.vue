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
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from '../components/BaseButton.vue'
import ChartCard from '../components/ChartCard.vue'
import ClassificationBadge from '../components/ClassificationBadge.vue'
import FunctionHeatCard from '../components/FunctionHeatCard.vue'
import LevelHeatBar from '../components/LevelHeatBar.vue'
import { comparisonOption, evolutionOption, functionRadarOption } from '@shared/charts/options'
import type { ChartKind } from '@shared/charts/options'
import { CLASSIFICATION_LEVELS, levelColor, levelLabel } from '@shared/domain/levels'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import { formatIsoDate } from '@shared/domain/dates'
import type { ChannelOutput } from '@shared/contracts'
import type { FunctionRadar, ResultPoint, TestGroup } from '@shared/contracts/results'
import type { EChartsOption } from 'echarts'

const props = defineProps<{ id: string }>()

const router = useRouter()
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
    <p v-if="loading" class="py-16 text-center text-sm text-ink-400">Carregando resultados…</p>

    <template v-else-if="overview !== null">
      <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            class="text-xs text-brand-500 hover:underline"
            @click="router.push(`/avaliacoes/${id}`)"
          >
            ← Voltar à avaliação
          </button>
          <h1 class="mt-1 text-xl font-bold text-ink-800">
            Resultados de {{ overview.patient.fullName }}
          </h1>
          <p class="mt-1 text-sm text-ink-500">
            Avaliação de {{ overview.assessmentDate }}
            <template v-if="overview.patient.ageAtAssessment">
              · {{ overview.patient.ageAtAssessment }}
            </template>
            · {{ overview.totalResults }}
            {{ overview.totalResults === 1 ? 'resultado' : 'resultados' }}
          </p>
        </div>

        <BaseButton variant="primary" :loading="exporting" @click="exportPdf">
          Exportar PDF
        </BaseButton>
      </header>

      <div
        v-if="overview.missingLevels > 0"
        class="mb-6 rounded border border-warn-200 bg-warn-50 p-3 text-sm text-warn-700"
      >
        <span class="font-medium">
          {{ overview.missingLevels }} de {{ overview.totalResults }}
          {{ overview.missingLevels === 1 ? 'resultado está' : 'resultados estão' }} sem nível.
        </span>
        Eles aparecem em cinza, e não entram na média das funções. Defina o nível das faixas em
        Instrumentos e use "Reprocessar classificações" na avaliação para aplicá-lo — reprocessar é
        ação explícita, e mostra a prévia antes de gravar.
      </div>

      <!-- ── Comparar com outras avaliações ────────────────────────────── -->
      <section v-if="comparableSiblings.length > 0" class="card mb-6 p-4">
        <h2 class="mb-2 text-sm font-semibold text-ink-800">Comparar com outras avaliações</h2>
        <div class="flex flex-wrap gap-x-5 gap-y-2">
          <label
            v-for="assessment in comparableSiblings"
            :key="assessment.id"
            class="flex items-center gap-2 text-sm text-ink-700"
          >
            <input v-model="comparisonIds" type="checkbox" :value="assessment.id" />
            {{ formatIsoDate(assessment.date) }}
          </label>
        </div>
      </section>

      <div v-if="overview.totalResults === 0" class="card p-10 text-center text-sm text-ink-400">
        Esta avaliação ainda não tem resultados lançados.
      </div>

      <template v-else>
        <!-- ── Panorama por função ─────────────────────────────────────── -->
        <section class="mb-8">
          <h2 class="mb-1 text-base font-semibold text-ink-800">Panorama por função</h2>
          <p class="mb-3 text-xs text-ink-500">
            Ordenado da função mais rebaixada para a mais preservada. O número é o nível médio, de 1
            (muito rebaixado) a 5 (muito acima do esperado).
          </p>

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

          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
            <span
              v-for="entry in CLASSIFICATION_LEVELS"
              :key="entry.level"
              class="flex items-center gap-1.5"
            >
              <span class="h-2.5 w-2.5 rounded-sm" :style="{ backgroundColor: entry.hex }" />
              {{ entry.level }} · {{ entry.label }}
            </span>
          </div>
        </section>

        <!-- ── Detalhe por função ──────────────────────────────────────── -->
        <section class="mb-8">
          <h2 class="mb-3 text-base font-semibold text-ink-800">Detalhe por função</h2>

          <!-- Agrupado por função raiz: o radar de um pai compara as filhas dele,
               e só se lê junto das tabelas dessas filhas. Uma função pai sem
               instrumentos próprios não teria bloco nenhum numa lista plana. -->
          <div
            v-for="group in overview.functionGroups"
            :key="group.rootId ?? '__none__'"
            class="mb-6"
          >
            <div class="mb-2 flex items-center gap-3">
              <h3 class="text-sm font-semibold text-ink-800">{{ group.name }}</h3>
              <LevelHeatBar
                :distribution="group.distribution"
                class="max-w-40 flex-1"
                :height="6"
              />
              <span class="text-xs text-ink-500">
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
              class="mb-4 scroll-mt-4 border-l border-ink-200 pl-3"
            >
              <div class="mb-1 flex items-center gap-3">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  {{ summary.name }}
                </h4>
                <LevelHeatBar
                  :distribution="summary.distribution"
                  class="max-w-40 flex-1"
                  :height="6"
                />
              </div>

              <div class="card overflow-hidden">
                <table class="w-full text-sm">
                  <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th class="px-3 py-2 text-left font-semibold">Instrumento</th>
                      <th class="w-24 px-3 py-2 text-left font-semibold">Escore</th>
                      <th class="w-20 px-3 py-2 text-right font-semibold">Valor</th>
                      <th class="w-44 px-3 py-2 text-left font-semibold">Classificação</th>
                      <th class="w-32 px-3 py-2 text-left font-semibold">Nível</th>
                      <th class="w-28 px-3 py-2 text-left font-semibold">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="point in summary.points"
                      :key="point.resultId"
                      class="border-t border-ink-200"
                    >
                      <td class="px-3 py-2 text-ink-800">{{ point.instrumentPath }}</td>
                      <td class="px-3 py-2 text-ink-600">{{ point.scoreTypeLabel }}</td>
                      <td class="tabular px-3 py-2 text-right font-medium text-ink-800">
                        {{ formatValue(point) }}
                      </td>
                      <td class="px-3 py-2">
                        <ClassificationBadge
                          :name="point.classificationName"
                          :color-hex="point.colorHex"
                          :overridden="point.manuallyOverridden"
                        />
                      </td>
                      <td class="px-3 py-2">
                        <span class="flex items-center gap-1.5 text-xs text-ink-600">
                          <span
                            class="h-2.5 w-2.5 shrink-0 rounded-sm"
                            :style="{ backgroundColor: levelColor(point.classificationLevel) }"
                          />
                          {{ levelLabel(point.classificationLevel) }}
                        </span>
                      </td>
                      <td class="px-3 py-2 text-ink-600">{{ point.statusLabel }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Por teste ───────────────────────────────────────────────── -->
        <section>
          <h2 class="mb-1 text-base font-semibold text-ink-800">Por teste</h2>
          <p class="mb-3 text-xs text-ink-500">
            Os subtestes na régua normalizada de 0 a 100, em que 100 é sempre o melhor desempenho —
            é o que torna comparáveis escores de escalas diferentes.
          </p>

          <div v-for="group in overview.tests" :key="group.instrumentId" class="mb-6">
            <div class="card mb-3 overflow-hidden">
              <table class="w-full text-sm">
                <caption class="bg-ink-50 px-3 py-2 text-left text-sm font-semibold text-ink-800">
                  {{
                    group.label
                  }}
                  <span v-if="group.inverted" class="ml-2 text-xs font-normal text-warn-700">
                    escore alto indica pior desempenho
                  </span>
                </caption>
                <thead class="bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th class="px-3 py-2 text-left font-semibold">Subteste</th>
                    <th class="w-20 px-3 py-2 text-left font-semibold">Escore</th>
                    <th
                      v-for="assessment in assessments"
                      :key="assessment.id"
                      class="w-32 px-3 py-2 text-right font-semibold"
                    >
                      {{ assessment.dateLabel }}
                    </th>
                    <th v-if="!comparing" class="w-44 px-3 py-2 text-left font-semibold">
                      Classificação
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="entry in group.entries"
                    :key="entry.key"
                    class="border-t border-ink-200"
                  >
                    <td class="px-3 py-2 text-ink-800">{{ entry.label }}</td>
                    <td class="px-3 py-2 text-ink-600">{{ entry.scoreTypeLabel }}</td>
                    <td
                      v-for="(point, index) in entry.values"
                      :key="index"
                      class="tabular px-3 py-2 text-right font-medium text-ink-800"
                    >
                      {{ formatValue(point) }}
                    </td>
                    <td v-if="!comparing" class="px-3 py-2">
                      <ClassificationBadge
                        :name="entry.values[0]?.classificationName ?? null"
                        :color-hex="entry.values[0]?.colorHex ?? null"
                        :overridden="entry.values[0]?.manuallyOverridden ?? false"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

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
