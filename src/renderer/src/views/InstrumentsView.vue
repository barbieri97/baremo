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
import type { ChannelOutput } from '@shared/contracts'
import type { Instrument } from '@shared/contracts/entities'
import type { CatalogImportPlan } from '@shared/contracts/catalog'

const appStore = useAppStore()
const catalog = useCatalogStore()

const selectedId = ref<string | null>(null)
const isNew = ref(false)
const saving = ref(false)
const tab = ref<'details' | 'ranges'>('details')

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

async function move(payload: { id: string; parentId: string | null; order: number }): Promise<void> {
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
    <header class="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-xl font-bold text-ink-800">Instrumentos</h1>
        <p class="text-sm text-ink-500">
          Reflita aqui a estrutura psicométrica do instrumento — bateria, índices compostos e
          subtestes. Tanto nós folha quanto nós compostos podem receber resultado.
        </p>
      </div>

      <div class="flex shrink-0 gap-2">
        <BaseButton size="sm" :disabled="transferring" @click="pickImport">
          Importar catálogo
        </BaseButton>
        <BaseButton size="sm" :disabled="transferring" @click="exportCatalog">
          Exportar catálogo
        </BaseButton>
      </div>
    </header>

    <div class="grid grid-cols-5 gap-6">
      <div class="col-span-2">
        <TreeManager
          :nodes="catalog.instruments"
          :tree="catalog.instrumentTree"
          :selected-id="selectedId"
          empty-message="Nenhum instrumento cadastrado. Cadastre os testes que você utiliza e as faixas de classificação correspondentes à normatização que possui."
          @select="select"
          @add-child="startNew"
          @move="move"
        />
      </div>

      <div class="col-span-3">
        <div v-if="!isNew && selected === null" class="card p-8 text-center text-sm text-ink-400">
          Selecione um instrumento para editar, ou adicione um novo.
        </div>

        <div v-else class="card">
          <div class="flex gap-1 border-b border-ink-200 px-3 pt-3">
            <button
              class="rounded-t px-3 py-2 text-sm font-medium"
              :class="tab === 'details' ? 'bg-white text-brand-700' : 'text-ink-500 hover:text-ink-700'"
              @click="tab = 'details'"
            >
              Dados
            </button>
            <button
              v-if="!isNew && selected !== null"
              class="rounded-t px-3 py-2 text-sm font-medium"
              :class="tab === 'ranges' ? 'bg-white text-brand-700' : 'text-ink-500 hover:text-ink-700'"
              @click="tab = 'ranges'"
            >
              Faixas de classificação
            </button>
          </div>

          <div v-if="tab === 'details'" class="p-5">
            <form class="grid grid-cols-2 gap-4" @submit.prevent="save">
              <div class="col-span-2">
                <label class="field-label" for="instrument-name">Nome</label>
                <input id="instrument-name" v-model="form.name" class="field-input" required />
              </div>

              <div>
                <label class="field-label" for="instrument-acronym">Sigla</label>
                <input id="instrument-acronym" v-model="form.acronym" class="field-input" />
              </div>

              <div>
                <label class="field-label" for="instrument-parent">Instrumento pai</label>
                <select id="instrument-parent" v-model="form.parentId" class="field-input">
                  <option :value="null">Nenhum (raiz)</option>
                  <option v-for="entry in parentOptions" :key="entry.node.id" :value="entry.node.id">
                    {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
                  </option>
                </select>
              </div>

              <div class="col-span-2">
                <label class="field-label" for="instrument-function">Função cognitiva</label>
                <select
                  id="instrument-function"
                  v-model="form.cognitiveFunctionId"
                  class="field-input"
                >
                  <option :value="null">Nenhuma</option>
                  <option
                    v-for="entry in catalog.flatFunctions"
                    :key="entry.node.id"
                    :value="entry.node.id"
                  >
                    {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
                  </option>
                </select>
                <p class="mt-1 text-xs text-ink-500">
                  Vincule no nó que produz escore. É por este vínculo que o relatório por função
                  cognitiva organiza os resultados.
                </p>
              </div>

              <div>
                <label class="field-label" for="instrument-min-age">Idade mínima (anos)</label>
                <input
                  id="instrument-min-age"
                  :value="form.minAgeYears ?? ''"
                  type="number"
                  min="0"
                  max="120"
                  class="field-input tabular"
                  @input="
                    form.minAgeYears =
                      ($event.target as HTMLInputElement).value === ''
                        ? null
                        : Number(($event.target as HTMLInputElement).value)
                  "
                />
              </div>

              <div>
                <label class="field-label" for="instrument-max-age">Idade máxima (anos)</label>
                <input
                  id="instrument-max-age"
                  :value="form.maxAgeYears ?? ''"
                  type="number"
                  min="0"
                  max="120"
                  class="field-input tabular"
                  @input="
                    form.maxAgeYears =
                      ($event.target as HTMLInputElement).value === ''
                        ? null
                        : Number(($event.target as HTMLInputElement).value)
                  "
                />
              </div>

              <div class="col-span-2">
                <label class="field-label" for="instrument-reference">Referência bibliográfica</label>
                <textarea
                  id="instrument-reference"
                  v-model="form.reference"
                  class="field-input min-h-20"
                  placeholder="Manual, edição e normatização utilizada"
                />
              </div>

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
        </div>
      </div>
    </div>

    <BaseDialog v-model:open="importOpen" title="Importar catálogo" wide>
      <p class="text-sm text-ink-700">
        Arquivo: <span class="font-medium">{{ importFileName }}</span>
      </p>
      <p v-if="importOrigin !== ''" class="mt-1 text-xs text-ink-500">{{ importOrigin }}</p>

      <p v-if="importChangesNothing" class="mt-4 text-sm text-ink-700">
        Este catálogo já está inteiramente neste computador. Importar não mudaria nada.
      </p>

      <div v-else class="mt-4 rounded-md border border-ink-200 bg-ink-50 p-3">
        <p class="text-xs font-semibold uppercase tracking-wide text-ink-600">O que será feito</p>
        <ul class="mt-2 space-y-1 text-sm text-ink-700">
          <li v-for="entry in importCounts" :key="entry.label" class="flex justify-between gap-4">
            <span>{{ entry.label }}</span>
            <span class="tabular font-semibold">{{ entry.value }}</span>
          </li>
        </ul>
      </div>

      <div
        v-if="importPlan !== null && importPlan.warnings.length > 0"
        class="mt-4 rounded-md border border-warn-200 bg-warn-50 p-3"
      >
        <p class="text-xs font-semibold uppercase tracking-wide text-warn-700">Avisos</p>
        <ul class="mt-2 space-y-2 text-sm text-warn-700">
          <li v-for="(warning, index) in importPlan.warnings" :key="index">{{ warning.message }}</li>
        </ul>
      </div>

      <p class="mt-4 text-xs text-ink-500">
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
