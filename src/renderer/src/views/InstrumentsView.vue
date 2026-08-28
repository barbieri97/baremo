<script setup lang="ts">
/**
 * Instrumentos e faixas de classificação (spec §4.4, §4.6).
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import TreeManager from '../components/TreeManager.vue'
import RangeEditor from '../components/RangeEditor.vue'
import type { ChannelOutput } from '@shared/contracts'
import type { Instrument } from '@shared/contracts/entities'

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
    <header class="mb-5">
      <h1 class="text-xl font-bold text-ink-800">Instrumentos</h1>
      <p class="text-sm text-ink-500">
        Reflita aqui a estrutura psicométrica do instrumento — bateria, índices compostos e
        subtestes. Tanto nós folha quanto nós compostos podem receber resultado.
      </p>
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
