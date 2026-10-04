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
                label="Função cognitiva"
                class="col-span-2"
                hint="Vincule no nó que produz escore. É por este vínculo que o relatório por função cognitiva organiza os resultados."
              >
                <BaseSelect v-model="form.cognitiveFunctionId">
                  <option :value="null">Nenhuma</option>
                  <option
                    v-for="entry in catalog.flatFunctions"
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
