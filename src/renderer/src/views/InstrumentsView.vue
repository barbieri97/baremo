<script setup lang="ts">
/**
 * Instrumentos e faixas de classificação (spec §4.4, §4.6).
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import BaseDialog from '../components/BaseDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import TreeManager from '../components/TreeManager.vue'
import RangeEditor from '../components/RangeEditor.vue'
import PageHeader from '../components/PageHeader.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseTabs from '../components/BaseTabs.vue'
import BaseEmptyState from '../components/BaseEmptyState.vue'
import BaseAlert from '../components/BaseAlert.vue'
import BaseField from '../components/BaseField.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import BaseTextarea from '../components/BaseTextarea.vue'
import BaseIconButton from '../components/BaseIconButton.vue'
import { ArrowDown, ArrowUp, X } from 'lucide-vue-next'
import { resolveFunctions } from '@shared/domain/instrument-functions'
import type { ChannelOutput } from '@shared/contracts'
import type { Instrument } from '@shared/contracts/entities'
import type { CatalogImportPlan } from '@shared/contracts/catalog'

const appStore = useAppStore()
const catalog = useCatalogStore()

const selectedId = ref<string | null>(null)
const isNew = ref(false)
const saving = ref(false)
const tab = ref<'details' | 'ranges'>('details')
const tabs = computed(() => [
  { value: 'details' as const, label: 'Dados' },
  ...(!isNew.value && selected.value !== null
    ? [{ value: 'ranges' as const, label: 'Faixas de classificação' }]
    : [])
])

const form = ref({
  name: '',
  acronym: '',
  parentId: null as string | null,
  cognitiveFunctionId: null as string | null,
  secondaryFunctionIds: [] as string[],
  minAgeYears: null as number | null,
  maxAgeYears: null as number | null,
  reference: ''
})

const deleteOpen = ref(false)
const impact = ref<ChannelOutput<'instruments:impact'> | null>(null)

onMounted(() => catalog.load(true))

const selected = computed<Instrument | null>(() =>
  selectedId.value === null ? null : (catalog.instrumentById.get(selectedId.value) ?? null)
)

function select(id: string): void {
  const node = catalog.instrumentById.get(id)
  if (!node) return

  isNew.value = false
  selectedId.value = id
  form.value = {
    name: node.name,
    acronym: node.acronym ?? '',
    parentId: node.parentId,
    cognitiveFunctionId: node.cognitiveFunctionId,
    secondaryFunctionIds: [...node.secondaryFunctionIds],
    minAgeYears: node.minAgeYears,
    maxAgeYears: node.maxAgeYears,
    reference: node.reference ?? ''
  }
}

function startNew(parentId: string | null): void {
  isNew.value = true
  selectedId.value = null
  tab.value = 'details'
  form.value = {
    name: '',
    acronym: '',
    parentId,
    cognitiveFunctionId: null,
    secondaryFunctionIds: [],
    minAgeYears: null,
    maxAgeYears: null,
    reference: ''
  }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const input = {
      parentId: form.value.parentId,
      name: form.value.name.trim(),
      acronym: form.value.acronym.trim() || null,
      cognitiveFunctionId: form.value.cognitiveFunctionId,
      // F4: sem principal, as secundárias não são gravadas.
      secondaryFunctionIds:
        form.value.cognitiveFunctionId === null ? [] : form.value.secondaryFunctionIds,
      minAgeYears: form.value.minAgeYears,
      maxAgeYears: form.value.maxAgeYears,
      reference: form.value.reference.trim() || null,
      order: selected.value?.order ?? 0
    }

    if (isNew.value) {
      const created = await api('instruments:create', { input })
      await catalog.load(true)
      select(created.id)
      appStore.notify('success', 'Instrumento criado.')
    } else if (selectedId.value !== null) {
      await api('instruments:update', { id: selectedId.value, input })
      await catalog.load(true)
      appStore.notify('success', 'Instrumento atualizado.')
    }
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}

async function move(payload: {
  id: string
  parentId: string | null
  order: number
}): Promise<void> {
  try {
    await api('instruments:move', payload)
    await catalog.load(true)
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function openDelete(): Promise<void> {
  if (selectedId.value === null) return
  try {
    impact.value = await api('instruments:impact', { id: selectedId.value })
    deleteOpen.value = true
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmDelete(): Promise<void> {
  if (selectedId.value === null) return
  try {
    await api('instruments:delete', { id: selectedId.value })
    selectedId.value = null
    await catalog.load(true)
    appStore.notify('success', 'Instrumento excluído.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleteOpen.value = false
  }
}

// ─── Catálogo: exportar e importar ───────────────────────────────────────────

const transferring = ref(false)
const importOpen = ref(false)
const importToken = ref<string | null>(null)
const importFileName = ref('')
const importPlan = ref<CatalogImportPlan | null>(null)

async function exportCatalog(): Promise<void> {
  transferring.value = true
  try {
    const result = await api('catalog:export')
    if (result.cancelled) return
    appStore.notify('success', 'Catálogo exportado.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    transferring.value = false
  }
}

/**
 * Primeiro tempo da importação: o arquivo é lido e validado, mas nada é gravado.
 * O que volta é a prévia — e é sobre ela que o usuário decide.
 */
async function pickImport(): Promise<void> {
  transferring.value = true
  try {
    const picked = await api('catalog:pickImport')
    if (picked.cancelled || picked.token === null || picked.plan === null) return

    importToken.value = picked.token
    importFileName.value = picked.fileName
    importPlan.value = picked.plan
    importOpen.value = true
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    transferring.value = false
  }
}

async function confirmImport(): Promise<void> {
  if (importToken.value === null) return

  transferring.value = true
  try {
    const report = await api('catalog:applyImport', { token: importToken.value })
    await catalog.load(true)
    if (selectedId.value !== null) select(selectedId.value)

    appStore.notify(
      'success',
      `Catálogo importado: ${report.instruments.created} instrumento(s) novo(s), ` +
        `${report.instruments.updated} atualizado(s).`
    )
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    transferring.value = false
    importOpen.value = false
    importToken.value = null
    importPlan.value = null
  }
}

/** Só o que tem contagem: uma lista de zeros não informa nada. */
const importCounts = computed(() => {
  const plan = importPlan.value
  if (plan === null) return []

  return [
    { label: 'Instrumentos novos', value: plan.instruments.created },
    { label: 'Instrumentos atualizados', value: plan.instruments.updated },
    { label: 'Instrumentos sem mudança', value: plan.instruments.unchanged },
    { label: 'Conjuntos de faixas novos', value: plan.rangeSets.created },
    { label: 'Conjuntos de faixas substituídos', value: plan.rangeSets.updated },
    { label: 'Conjuntos de faixas sem mudança', value: plan.rangeSets.unchanged },
    { label: 'Cores acrescentadas à paleta', value: plan.colors.created }
  ].filter((entry) => entry.value > 0)
})

const importOrigin = computed(() => {
  const plan = importPlan.value
  if (plan === null) return ''
  return `Exportado em ${new Date(plan.exportedAt).toLocaleString('pt-BR')}, pelo Baremo ${plan.appVersion}.`
})

/**
 * Arquivo idêntico ao que já está no computador: nada a fazer, e vale dizer.
 * Conjunto "sem mudança" não conta como mudança — é justamente o contrário.
 */
const importChangesNothing = computed(() => {
  const plan = importPlan.value
  if (plan === null) return false

  return (
    plan.instruments.created === 0 &&
    plan.instruments.updated === 0 &&
    plan.rangeSets.created === 0 &&
    plan.rangeSets.updated === 0 &&
    plan.colors.created === 0
  )
})

// ─── Funções principal e secundárias ─────────────────────────────────────────

function functionName(id: string): string {
  return catalog.functionById.get(id)?.name ?? '—'
}

/** Funções que ainda podem virar secundária: nem a principal, nem as já escolhidas. */
const secondaryOptions = computed(() =>
  catalog.flatFunctions.filter(
    (entry) =>
      entry.node.id !== form.value.cognitiveFunctionId &&
      !form.value.secondaryFunctionIds.includes(entry.node.id)
  )
)

function addSecondary(id: string): void {
  if (id === '' || form.value.secondaryFunctionIds.includes(id)) return
  form.value.secondaryFunctionIds = [...form.value.secondaryFunctionIds, id]
}

function removeSecondary(index: number): void {
  form.value.secondaryFunctionIds = form.value.secondaryFunctionIds.filter((_, i) => i !== index)
}

function moveSecondary(index: number, delta: -1 | 1): void {
  const list = [...form.value.secondaryFunctionIds]
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target]!, list[index]!]
  form.value.secondaryFunctionIds = list
}

/** A principal escolhida não pode continuar na lista de secundárias (F1). */
function changePrimary(id: string | null): void {
  form.value.cognitiveFunctionId = id
  form.value.secondaryFunctionIds = form.value.secondaryFunctionIds.filter((item) => item !== id)
}

/**
 * Sem principal própria, o que viria do instrumento-pai (F3) — calculado com o
 * pai do FORMULÁRIO, para refletir a troca de pai antes de salvar.
 */
const inherited = computed(() => {
  if (form.value.cognitiveFunctionId !== null || form.value.parentId === null) return null
  const resolved = resolveFunctions(
    form.value.parentId,
    catalog.instruments,
    catalog.instruments.flatMap((node) =>
      node.secondaryFunctionIds.map((cognitiveFunctionId, order) => ({
        instrumentId: node.id,
        cognitiveFunctionId,
        order
      }))
    )
  )
  if (resolved.primaryId === null) return null
  const owner = catalog.instrumentById.get(resolved.inheritedFrom ?? form.value.parentId)
  return {
    from: owner?.name ?? '—',
    primary: functionName(resolved.primaryId),
    secondary: resolved.secondaryIds.map(functionName)
  }
})

const parentOptions = computed(() => {
  if (selectedId.value === null) return catalog.flatInstruments

  const blocked = new Set<string>([selectedId.value])
  let changed = true
  while (changed) {
    changed = false
    for (const node of catalog.instruments) {
      if (node.parentId !== null && blocked.has(node.parentId) && !blocked.has(node.id)) {
        blocked.add(node.id)
        changed = true
      }
    }
  }

  return catalog.flatInstruments.filter((entry) => !blocked.has(entry.node.id))
})
</script>

<template>
  <div class="p-6">
    <PageHeader
      title="Instrumentos"
      subtitle="Reflita aqui a estrutura psicométrica do instrumento — bateria, índices compostos e subtestes. Tanto nós folha quanto nós compostos podem receber resultado."
      class="mb-6"
    >
      <template #actions>
        <BaseButton size="sm" :disabled="transferring" @click="pickImport">
          Importar catálogo
        </BaseButton>
        <BaseButton size="sm" :disabled="transferring" @click="exportCatalog">
          Exportar catálogo
        </BaseButton>
      </template>
    </PageHeader>

    <div class="grid grid-cols-5 gap-6">
      <div class="col-span-2">
        <TreeManager
          :nodes="catalog.instruments"
          :tree="catalog.instrumentTree"
          :selected-id="selectedId"
          collapsed-by-default
          empty-message="Nenhum instrumento cadastrado. Cadastre os testes que você utiliza e as faixas de classificação correspondentes à normatização que possui."
          @select="select"
          @add-child="startNew"
          @move="move"
        />
      </div>

      <div class="col-span-3">
        <BaseEmptyState
          v-if="!isNew && selected === null"
          framed
          message="Selecione um instrumento para editar, ou adicione um novo."
        />

        <BaseCard v-else>
          <BaseTabs v-model="tab" :items="tabs" label="Ficha do instrumento" class="px-3 pt-1" />

          <div v-if="tab === 'details'" class="p-5">
            <form class="grid grid-cols-2 gap-4" @submit.prevent="save">
              <BaseField id="instrument-name" label="Nome" class="col-span-2">
                <BaseInput v-model="form.name" required />
              </BaseField>

              <BaseField id="instrument-acronym" label="Sigla">
                <BaseInput v-model="form.acronym" />
              </BaseField>

              <BaseField
                id="instrument-parent"
                label="Instrumento pai"
                hint="Subtestes sem faixas próprias usam as do pai. Trocar o pai troca também as faixas herdadas — resultados já lançados não mudam."
              >
                <BaseSelect v-model="form.parentId">
                  <option :value="null">Nenhum (raiz)</option>
                  <option
                    v-for="entry in parentOptions"
                    :key="entry.node.id"
                    :value="entry.node.id"
                  >
                    {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
                  </option>
                </BaseSelect>
              </BaseField>

              <BaseField
                id="instrument-function"
                label="Função principal"
                class="col-span-2"
                :hint="
                  inherited === null
                    ? 'É por esta função que a avaliação, a visão geral e o relatório agrupam os resultados. Sem função própria, o instrumento herda a do instrumento pai.'
                    : `Herdada de ${inherited.from}: ${inherited.primary}${inherited.secondary.length > 0 ? ` (também avalia: ${inherited.secondary.join(', ')})` : ''}. Escolha uma função para usar a própria.`
                "
              >
                <BaseSelect
                  :model-value="form.cognitiveFunctionId"
                  data-testid="instrument-primary-function"
                  @update:model-value="changePrimary($event as string | null)"
                >
                  <option :value="null">
                    {{ inherited === null ? 'Nenhuma' : `Herdada de ${inherited.from}` }}
                  </option>
                  <option
                    v-for="entry in catalog.flatFunctions"
                    :key="entry.node.id"
                    :value="entry.node.id"
                  >
                    {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
                  </option>
                </BaseSelect>
              </BaseField>

              <BaseField
                id="instrument-secondary-functions"
                label="Funções secundárias"
                class="col-span-2"
                :hint="
                  form.cognitiveFunctionId === null
                    ? 'Escolha antes a função principal.'
                    : 'Aparecem como etiqueta (“também avalia: …”) e não mudam o agrupamento dos resultados.'
                "
              >
                <ul
                  v-if="form.cognitiveFunctionId !== null && form.secondaryFunctionIds.length > 0"
                  class="mb-2 flex flex-col gap-1"
                  data-testid="instrument-secondary-list"
                >
                  <li
                    v-for="(functionId, index) in form.secondaryFunctionIds"
                    :key="functionId"
                    class="flex items-center gap-1 rounded-chip bg-surface-muted px-2 py-1 text-sm"
                  >
                    <span class="flex-1">{{ functionName(functionId) }}</span>
                    <BaseIconButton
                      :icon="ArrowUp"
                      label="Subir"
                      size="sm"
                      :disabled="index === 0"
                      @click="moveSecondary(index, -1)"
                    />
                    <BaseIconButton
                      :icon="ArrowDown"
                      label="Descer"
                      size="sm"
                      :disabled="index === form.secondaryFunctionIds.length - 1"
                      @click="moveSecondary(index, 1)"
                    />
                    <BaseIconButton
                      :icon="X"
                      :label="`Remover ${functionName(functionId)}`"
                      variant="danger"
                      size="sm"
                      @click="removeSecondary(index)"
                    />
                  </li>
                </ul>
                <BaseSelect
                  model-value=""
                  :disabled="form.cognitiveFunctionId === null"
                  data-testid="instrument-secondary-add"
                  @update:model-value="addSecondary(String($event ?? ''))"
                >
                  <option value="">Adicionar função secundária…</option>
                  <option
                    v-for="entry in secondaryOptions"
                    :key="entry.node.id"
                    :value="entry.node.id"
                  >
                    {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
                  </option>
                </BaseSelect>
              </BaseField>

              <BaseField id="instrument-min-age" label="Idade mínima (anos)">
                <BaseInput
                  :model-value="form.minAgeYears ?? ''"
                  type="number"
                  min="0"
                  max="120"
                  class="tabular"
                  @update:model-value="form.minAgeYears = $event === '' ? null : Number($event)"
                />
              </BaseField>

              <BaseField id="instrument-max-age" label="Idade máxima (anos)">
                <BaseInput
                  :model-value="form.maxAgeYears ?? ''"
                  type="number"
                  min="0"
                  max="120"
                  class="tabular"
                  @update:model-value="form.maxAgeYears = $event === '' ? null : Number($event)"
                />
              </BaseField>

              <BaseField
                id="instrument-reference"
                label="Referência bibliográfica"
                class="col-span-2"
              >
                <BaseTextarea
                  v-model="form.reference"
                  placeholder="Manual, edição e normatização utilizada"
                />
              </BaseField>

              <div class="col-span-2 flex items-center justify-between">
                <BaseButton
                  v-if="!isNew && selected !== null"
                  variant="danger"
                  size="sm"
                  @click="openDelete"
                >
                  Excluir
                </BaseButton>
                <span v-else />

                <BaseButton
                  variant="primary"
                  :loading="saving"
                  :disabled="form.name.trim() === ''"
                  @click="save"
                >
                  Salvar
                </BaseButton>
              </div>
            </form>
          </div>

          <RangeEditor v-else-if="selected !== null" :instrument="selected" class="p-5" />
        </BaseCard>
      </div>
    </div>

    <BaseDialog v-model:open="importOpen" title="Importar catálogo" wide>
      <p class="text-sm text-fg-secondary">
        Arquivo: <span class="font-medium">{{ importFileName }}</span>
      </p>
      <p v-if="importOrigin !== ''" class="mt-1 text-xs text-fg-subtle">{{ importOrigin }}</p>

      <p v-if="importChangesNothing" class="mt-4 text-sm text-fg-secondary">
        Este catálogo já está inteiramente neste computador. Importar não mudaria nada.
      </p>

      <BaseAlert v-else title="O que será feito" class="mt-4">
        <ul class="space-y-1">
          <li v-for="entry in importCounts" :key="entry.label" class="flex justify-between gap-4">
            <span>{{ entry.label }}</span>
            <span class="tabular font-semibold">{{ entry.value }}</span>
          </li>
        </ul>
      </BaseAlert>

      <BaseAlert
        v-if="importPlan !== null && importPlan.warnings.length > 0"
        tone="warn"
        title="Avisos"
        class="mt-4"
      >
        <ul class="space-y-2">
          <li v-for="(warning, index) in importPlan.warnings" :key="index">
            {{ warning.message }}
          </li>
        </ul>
      </BaseAlert>

      <p class="mt-4 text-xs text-fg-subtle">
        Importar não exclui nada: instrumentos e faixas que existem aqui e não estão no arquivo
        permanecem. Os conjuntos de faixas que estiverem no arquivo substituem os equivalentes, e as
        classificações já gravadas em avaliações não mudam.
      </p>

      <template #footer>
        <BaseButton variant="ghost" @click="importOpen = false">Cancelar</BaseButton>
        <BaseButton
          variant="primary"
          :loading="transferring"
          :disabled="importChangesNothing"
          @click="confirmImport"
        >
          Importar
        </BaseButton>
      </template>
    </BaseDialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Excluir instrumento"
      message="Os subtestes e as faixas de classificação serão excluídos junto. A exclusão é recusada se houver resultados já lançados em avaliações."
      :impact="impact"
      confirm-label="Excluir"
      @confirm="confirmDelete"
    />
  </div>
</template>
