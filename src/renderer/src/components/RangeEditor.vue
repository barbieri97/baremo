<script setup lang="ts">
/**
 * Editor de faixas de classificação (spec §4.6).
 *
 * A convenção é `[min, max)` — mínimo inclusivo, máximo exclusivo — com a última
 * faixa da série fechada em `[min, max]`. A validação (sem sobreposição, sem
 * lacuna, cobrindo as extremidades) roda a cada tecla, com a MESMA função pura
 * que o processo principal aplica antes de gravar: a UI não é a autoridade, mas
 * também não deixa o usuário descobrir o erro só ao salvar.
 *
 * Duas colunas existem para a LEITURA, não para a resolução da faixa:
 *
 * **Nível** é o ordinal 1–5 que dá ordem ao nome livre da classificação. Sem
 * ele o app não sabe o que é bom e o que é ruim, e a visualização de resultados
 * não tem como pintar nada — "Média inferior" e "Risco clínico" são só texto.
 *
 * **Escore alto indica pior desempenho** marca o conjunto invertido, das escalas
 * de sintoma. Não muda a resolução da faixa, que continua puramente numérica;
 * muda a normalização dos gráficos e a direção da sugestão de níveis.
 *
 * Herança (§4.6): dentro de um teste as faixas costumam ser as mesmas para todos
 * os subtestes, então um subteste não cadastra nada — ele usa as faixas do
 * ancestral. Enquanto herda, esta tela mostra as faixas do pai TRAVADAS, com a
 * origem declarada: editar aqui daria a impressão de mexer só neste subteste
 * quando, na verdade, a alteração teria de ir para o pai e atingiria os irmãos.
 * Personalizar é um ato explícito, com botão próprio — e reversível.
 */
import { computed, ref, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from './BaseButton.vue'
import BaseAlert from './BaseAlert.vue'
import BaseCheckbox from './BaseCheckbox.vue'
import BaseEmptyState from './BaseEmptyState.vue'
import BaseField from './BaseField.vue'
import BaseIconButton from './BaseIconButton.vue'
import BaseInput from './BaseInput.vue'
import BaseSelect from './BaseSelect.vue'
import BaseTable, { type TableColumn } from './BaseTable.vue'
import { Plus, X } from 'lucide-vue-next'
import { SCORE_TYPES, SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import { describeRange, suggestNextMin, validateRangeSet } from '@shared/domain/ranges'
import { CLASSIFICATION_LEVELS, suggestLevels } from '@shared/domain/levels'
import type { ClassificationLevel } from '@shared/domain/levels'
import { SCORE_TYPE_LABELS } from '@shared/labels'
import { checkContrast } from '@shared/domain/color'
import type { Instrument, RangeOrigin } from '@shared/contracts/entities'

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Classificação' },
  { key: 'min', label: 'Mínimo', align: 'right', class: 'w-24' },
  { key: 'max', label: 'Máximo', align: 'right', class: 'w-24' },
  { key: 'color', label: 'Cor', class: 'w-40' },
  { key: 'level', label: 'Nível', class: 'w-48' },
  { key: 'interval', label: 'Intervalo', class: 'w-28' },
  { key: 'actions', class: 'w-10' }
]

const props = defineProps<{ instrument: Instrument }>()

const appStore = useAppStore()
const catalog = useCatalogStore()

interface DraftRow {
  key: number
  classificationName: string
  minValue: number
  maxValue: number
  colorId: string
  level: ClassificationLevel | null
}

let nextKey = 1

/** Tipo mostrado quando o instrumento ainda não tem faixa nenhuma. */
const FALLBACK_SCORE_TYPE: ScoreType = 'percentile'

const scoreType = ref<ScoreType>(FALLBACK_SCORE_TYPE)
const rows = ref<DraftRow[]>([])
const loading = ref(false)
const saving = ref(false)
const configured = ref<ScoreType[]>([])
/** Vale para o conjunto inteiro, não para a linha — daí viver fora de `rows`. */
const inverted = ref(false)
/** Origem das faixas (§4.6): de quem elas vêm e se este instrumento pode herdar. */
const origin = ref<RangeOrigin>({ ownerId: '', ownerName: '', inherited: false, canInherit: false })
const changingSource = ref(false)

/** Escore bruto não recebe classificação automática (§4.5). */
const classifiableTypes = SCORE_TYPES.filter((type) => SCORE_TYPE_DOMAINS[type].autoClassify)

async function load(): Promise<void> {
  loading.value = true
  try {
    configured.value = await api('classifications:listConfigured', {
      instrumentId: props.instrument.id
    })

    const source = await api('classifications:list', {
      instrumentId: props.instrument.id,
      scoreType: scoreType.value
    })
    const existing = source.ranges
    origin.value = {
      ownerId: source.ownerId,
      ownerName: source.ownerName,
      inherited: source.inherited,
      canInherit: source.canInherit
    }

    rows.value = existing.map((range) => ({
      key: nextKey++,
      classificationName: range.classificationName,
      minValue: range.minValue,
      maxValue: range.maxValue,
      colorId: range.colorId,
      level: range.level
    }))
    inverted.value = existing[0]?.inverted ?? false
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
}

/**
 * Ao abrir um instrumento, a aba mostra o primeiro tipo de escore que TEM
 * faixas — e só cai no percentil quando não há nenhuma.
 *
 * Abrir sempre no percentil escondia faixas que existem: um instrumento cujo
 * catálogo configura escore padrão e z aparecia com "nenhuma faixa cadastrada",
 * e o único indício do contrário era o ✓ dentro do seletor fechado. Quem acabou
 * de importar um catálogo lê isso como "a importação não trouxe as faixas".
 */
async function openInstrument(): Promise<void> {
  loading.value = true
  try {
    configured.value = await api('classifications:listConfigured', {
      instrumentId: props.instrument.id
    })
  } catch (error) {
    appStore.notifyError(error)
    configured.value = []
  }

  const preferred = classifiableTypes.find((type) => configured.value.includes(type))
  // Trocar o tipo dispara o watch abaixo, que é quem carrega as faixas.
  if (preferred !== undefined && preferred !== scoreType.value) {
    scoreType.value = preferred
    return
  }

  await load()
}

watch(() => props.instrument.id, openInstrument, { immediate: true })
watch(scoreType, load)

const asRangeLike = computed(() =>
  rows.value.map((row) => ({
    id: String(row.key),
    classificationName: row.classificationName,
    minValue: row.minValue,
    maxValue: row.maxValue,
    colorHex: catalog.colorById.get(row.colorId)?.hex ?? '#000000',
    version: 1,
    level: row.level,
    inverted: inverted.value
  }))
)

const issues = computed(() => validateRangeSet(asRangeLike.value, scoreType.value))

const blockingIssues = computed(() =>
  // Um conjunto vazio é estado inicial legítimo, não erro a exibir em vermelho.
  issues.value.filter((issue) => issue.code !== 'empty')
)

const domain = computed(() => SCORE_TYPE_DOMAINS[scoreType.value])

function addRow(): void {
  const min = suggestNextMin(asRangeLike.value, scoreType.value)
  const max = domain.value.max ?? min + 10

  rows.value = [
    ...rows.value,
    {
      key: nextKey++,
      classificationName: '',
      minValue: min,
      maxValue: Math.max(min + step(), Math.min(max, min + 10)),
      colorId: catalog.colors[0]?.id ?? '',
      level: null
    }
  ]
}

function step(): number {
  return 1 / 10 ** domain.value.decimals
}

function removeRow(key: number): void {
  rows.value = rows.value.filter((row) => row.key !== key)
}

/** Preenche a série cobrindo o domínio inteiro, em partes iguais. */
function fillDomain(count: number): void {
  const { min, max } = domain.value
  if (min === null || max === null) return

  const span = (max - min) / count
  const decimals = domain.value.decimals
  const levels = suggestLevels(count, inverted.value)

  rows.value = Array.from({ length: count }, (_, index) => ({
    key: nextKey++,
    classificationName: '',
    minValue: Number((min + span * index).toFixed(decimals)),
    maxValue: Number((min + span * (index + 1)).toFixed(decimals)),
    colorId: catalog.colors[index % Math.max(catalog.colors.length, 1)]?.id ?? '',
    level: levels[index] ?? null
  }))
}

/**
 * Preenche a coluna Nível de uma vez, a partir da ordem das faixas.
 *
 * É sugestão, não regra: o usuário ajusta linha a linha depois. Existe porque
 * sem ela a visualização de resultados nasceria cega — o nível teria de ser
 * escolhido faixa a faixa, instrumento a instrumento, antes que qualquer
 * gráfico mostrasse alguma coisa.
 */
function applySuggestedLevels(): void {
  const ordered = [...rows.value].sort((a, b) => a.minValue - b.minValue)
  const levels = suggestLevels(ordered.length, inverted.value)

  ordered.forEach((row, index) => {
    row.level = levels[index] ?? null
  })
}

/** Quantas faixas ainda não têm nível — o que a visualização não consegue ler. */
const missingLevels = computed(() => rows.value.filter((row) => row.level === null).length)

function rangeLabel(key: number): string {
  const range = asRangeLike.value.find((entry) => entry.id === String(key))
  return range ? describeRange(range, asRangeLike.value, scoreType.value) : ''
}

function contrastWarning(colorId: string): string | null {
  const color = catalog.colorById.get(colorId)
  if (!color) return null
  const check = checkContrast(color.hex)
  if (check === null || check.passesAA) return null
  return `Contraste ${check.ratio.toFixed(2)}:1 — abaixo do mínimo AA (4,5:1) para texto sobre esta cor.`
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await api('classifications:save', {
      instrumentId: props.instrument.id,
      scoreType: scoreType.value,
      ranges: rows.value.map((row) => ({
        classificationName: row.classificationName.trim(),
        minValue: row.minValue,
        maxValue: row.maxValue,
        colorId: row.colorId,
        level: row.level,
        inverted: inverted.value
      }))
    })
    await load()
    appStore.notify(
      'success',
      'Faixas salvas. Resultados já lançados mantêm a classificação com que foram gravados.'
    )
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}

/**
 * Outros tipos de escore deste instrumento que TÊM faixas.
 *
 * Sem isso, "nenhuma faixa cadastrada" é ambíguo entre "este instrumento não
 * tem faixas" e "tem, mas em outro tipo de escore" — e é a segunda leitura que
 * o vazio costuma esconder.
 */
const configuredElsewhere = computed(() =>
  classifiableTypes
    .filter((type) => type !== scoreType.value && configured.value.includes(type))
    .map((type) => SCORE_TYPE_LABELS[type])
)

/** Enquanto herda, a tabela é leitura: o cadastro vive no ancestral. */
const locked = computed(() => origin.value.inherited)

const canSave = computed(
  () =>
    !locked.value &&
    blockingIssues.value.length === 0 &&
    rows.value.every((row) => row.classificationName.trim() !== '')
)

/**
 * Passa a ter faixas próprias, partindo de uma cópia das que vinha herdando.
 *
 * Copiar em vez de começar do zero é o que torna a personalização barata: quase
 * sempre o usuário quer o conjunto do pai com um limite diferente, e não uma
 * tabela nova.
 */
async function detach(): Promise<void> {
  changingSource.value = true
  try {
    await api('classifications:detach', { instrumentId: props.instrument.id })
    await load()
    appStore.notify(
      'success',
      'Faixas copiadas para este instrumento. As alterações daqui em diante não afetam os outros subtestes.'
    )
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    changingSource.value = false
  }
}

/** Descarta as faixas próprias e volta a acompanhar o ancestral. */
async function reattach(): Promise<void> {
  const confirmed = window.confirm(
    'As faixas cadastradas neste instrumento serão apagadas e ele voltará a usar as do instrumento pai.\n\n' +
      'Resultados já lançados mantêm a classificação com que foram gravados.'
  )
  if (!confirmed) return

  changingSource.value = true
  try {
    await api('classifications:reattach', { instrumentId: props.instrument.id })
    await openInstrument()
    appStore.notify('success', 'Este instrumento voltou a herdar as faixas do instrumento pai.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    changingSource.value = false
  }
}
</script>

<template>
  <div>
    <BaseAlert v-if="origin.inherited" class="mb-4">
      <p class="max-w-2xl">
        <span class="font-medium">Este subteste usa as faixas de {{ origin.ownerName }}.</span>
        Editá-las lá vale para este e para os demais subtestes que herdam. Personalize só se as
        faixas deste subteste forem diferentes das do teste.
      </p>
      <template #actions>
        <BaseButton size="sm" :loading="changingSource" @click="detach">
          Personalizar para este subteste
        </BaseButton>
      </template>
    </BaseAlert>

    <div
      v-else-if="origin.canInherit"
      class="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-fg-subtle"
    >
      <p>Faixas próprias deste subteste — alterá-las não afeta o teste nem os outros subtestes.</p>
      <BaseButton variant="link-muted" size="sm" :disabled="changingSource" @click="reattach">
        Voltar a herdar do teste pai
      </BaseButton>
    </div>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <BaseField id="range-score-type" label="Tipo de escore">
        <BaseSelect v-model="scoreType" class="min-w-64">
          <option v-for="type in classifiableTypes" :key="type" :value="type">
            {{ SCORE_TYPE_LABELS[type] }}{{ configured.includes(type) ? ' ✓' : '' }}
          </option>
        </BaseSelect>
      </BaseField>

      <div class="text-xs text-fg-subtle">
        Domínio:
        <span class="tabular font-medium">
          {{ String(domain.min).replace('.', ',') }} a {{ String(domain.max).replace('.', ',') }}
        </span>
        · {{ domain.decimals === 0 ? 'inteiros' : `${domain.decimals} casa(s) decimal(is)` }}
      </div>

      <div v-if="!locked" class="ml-auto flex gap-2">
        <BaseButton size="sm" @click="fillDomain(5)">Gerar 5 faixas</BaseButton>
        <BaseButton size="sm" @click="fillDomain(7)">Gerar 7 faixas</BaseButton>
        <BaseButton size="sm" :icon="Plus" @click="addRow">Adicionar faixa</BaseButton>
      </div>
    </div>

    <BaseCheckbox v-model="inverted" :disabled="locked" class="mb-4 max-w-3xl">
      Escore alto indica <strong>pior</strong> desempenho
      <template #description>
        Marque em escalas de sintoma, em que um valor maior é o achado mais grave. Não muda em que
        faixa o valor cai — muda a direção dos gráficos e a sugestão de níveis abaixo.
      </template>
    </BaseCheckbox>

    <BaseEmptyState v-if="loading" message="Carregando faixas…" />

    <div v-else>
      <BaseTable v-if="rows.length > 0" :columns="COLUMNS" density="compact">
        <tr v-for="row in rows" :key="row.key">
          <td>
            <BaseInput
              v-model="row.classificationName"
              size="sm"
              placeholder="Ex.: Média superior"
              :disabled="locked"
            />
          </td>
          <td>
            <BaseInput
              v-model.number="row.minValue"
              type="number"
              size="sm"
              :step="step()"
              class="tabular text-right"
              :disabled="locked"
            />
          </td>
          <td>
            <BaseInput
              v-model.number="row.maxValue"
              type="number"
              size="sm"
              :step="step()"
              class="tabular text-right"
              :disabled="locked"
            />
          </td>
          <td>
            <BaseSelect v-model="row.colorId" size="sm" :disabled="locked">
              <option v-for="color in catalog.colors" :key="color.id" :value="color.id">
                {{ color.name }}
              </option>
            </BaseSelect>
            <p v-if="contrastWarning(row.colorId)" class="mt-0.5 text-xs text-warn-strong">
              {{ contrastWarning(row.colorId) }}
            </p>
          </td>
          <td>
            <BaseSelect v-model="row.level" size="sm" :disabled="locked">
              <option :value="null">— não definido</option>
              <option
                v-for="entry in CLASSIFICATION_LEVELS"
                :key="entry.level"
                :value="entry.level"
              >
                {{ entry.level }} · {{ entry.label }}
              </option>
            </BaseSelect>
          </td>
          <td class="tabular text-xs text-fg-subtle">{{ rangeLabel(row.key) }}</td>
          <td class="text-right">
            <BaseIconButton
              v-if="!locked"
              :icon="X"
              variant="danger"
              size="sm"
              :label="`Remover faixa ${row.classificationName}`"
              @click="removeRow(row.key)"
            />
          </td>
        </tr>
      </BaseTable>

      <BaseEmptyState v-else class="py-8">
        <template v-if="origin.inherited">
          {{ origin.ownerName }} não tem faixas de {{ SCORE_TYPE_LABELS[scoreType] }}. Sem faixas,
          os resultados deste instrumento são gravados sem classificação automática.
        </template>
        <template v-else>
          Nenhuma faixa cadastrada para {{ SCORE_TYPE_LABELS[scoreType] }}. Sem faixas, os
          resultados deste instrumento são gravados sem classificação automática.
        </template>
        <span v-if="configuredElsewhere.length > 0" class="mt-2 block text-fg-muted">
          {{ origin.inherited ? `${origin.ownerName} tem` : 'Este instrumento tem' }} faixas em
          <span class="font-medium">{{ configuredElsewhere.join(', ') }}</span> — troque o tipo de
          escore acima para vê-las.
        </span>
        <!--
          Um subteste próprio e sem faixa nenhuma quase sempre é engano: ele
          herdava e alguém salvou um conjunto vazio. Dizer só "nenhuma faixa"
          esconderia que as faixas do pai estão a um clique de distância.
        -->
        <span
          v-else-if="origin.canInherit && !origin.inherited"
          class="mx-auto mt-2 block max-w-xl text-fg-muted"
        >
          Este subteste está marcado como tendo faixas próprias, mas não tem nenhuma cadastrada. Use
          <span class="font-medium">Voltar a herdar do teste pai</span>, acima, para usar as faixas
          do teste.
        </span>
      </BaseEmptyState>

      <BaseAlert
        v-if="blockingIssues.length > 0"
        tone="danger"
        title="Corrija antes de salvar"
        class="mt-4"
      >
        <ul class="space-y-1">
          <li v-for="(issue, index) in blockingIssues" :key="index">{{ issue.message }}</li>
        </ul>
      </BaseAlert>

      <BaseAlert v-if="rows.length > 0 && missingLevels > 0 && !locked" tone="warn" class="mt-4">
        <p class="max-w-xl">
          <span class="font-medium">
            {{ missingLevels }} de {{ rows.length }}
            {{ missingLevels === 1 ? 'faixa está' : 'faixas estão' }} sem nível.
          </span>
          Resultados classificados por elas aparecem em cinza na visualização — sem nível, o app não
          sabe se a faixa é boa ou ruim.
        </p>
        <template #actions>
          <BaseButton size="sm" @click="applySuggestedLevels">Sugerir níveis</BaseButton>
        </template>
      </BaseAlert>

      <div v-if="!locked" class="mt-4 flex items-center justify-between">
        <p class="max-w-lg text-xs text-fg-subtle">
          O limite inferior é inclusivo e o superior exclusivo; a última faixa da série inclui o
          máximo. Faixas contíguas devem se encostar — o máximo de uma é o mínimo da seguinte.
        </p>
        <BaseButton variant="primary" :disabled="!canSave" :loading="saving" @click="save">
          Salvar faixas
        </BaseButton>
      </div>
    </div>
  </div>
</template>
