<script setup lang="ts">
/**
 * Árvore de funções cognitivas (spec §4.3).
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import TreeManager from '../components/TreeManager.vue'
import type { ChannelOutput } from '@shared/contracts'
import type { CognitiveFunction } from '@shared/contracts/entities'

const appStore = useAppStore()
const catalog = useCatalogStore()

const selectedId = ref<string | null>(null)
const form = ref({ name: '', description: '', parentId: null as string | null })
const isNew = ref(false)
const saving = ref(false)

const deleteOpen = ref(false)
const impact = ref<ChannelOutput<'cognitiveFunctions:impact'> | null>(null)

onMounted(() => catalog.load(true))

const selected = computed<CognitiveFunction | null>(() =>
  selectedId.value === null ? null : (catalog.functionById.get(selectedId.value) ?? null)
)

function select(id: string): void {
  const node = catalog.functionById.get(id)
  if (!node) return

  isNew.value = false
  selectedId.value = id
  form.value = { name: node.name, description: node.description ?? '', parentId: node.parentId }
}

function startNew(parentId: string | null): void {
  isNew.value = true
  selectedId.value = null
  form.value = { name: '', description: '', parentId }
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const input = {
      parentId: form.value.parentId,
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      order: 0
    }

    if (isNew.value) {
      const created = await api('cognitiveFunctions:create', { input })
      await catalog.load(true)
      select(created.id)
      appStore.notify('success', 'Função cognitiva criada.')
    } else if (selectedId.value !== null) {
      await api('cognitiveFunctions:update', {
        id: selectedId.value,
        input: { ...input, order: selected.value?.order ?? 0 }
      })
      await catalog.load(true)
      appStore.notify('success', 'Função cognitiva atualizada.')
    }
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    saving.value = false
  }
}

async function move(payload: { id: string; parentId: string | null; order: number }): Promise<void> {
  try {
    await api('cognitiveFunctions:move', payload)
    await catalog.load(true)
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function openDelete(): Promise<void> {
  if (selectedId.value === null) return
  try {
    impact.value = await api('cognitiveFunctions:impact', { id: selectedId.value })
    deleteOpen.value = true
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmDelete(): Promise<void> {
  if (selectedId.value === null) return
  try {
    await api('cognitiveFunctions:delete', { id: selectedId.value })
    selectedId.value = null
    await catalog.load(true)
    appStore.notify('success', 'Função cognitiva excluída.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleteOpen.value = false
  }
}

/** Opções de pai, sem o próprio nó nem seus descendentes — evita ciclo. */
const parentOptions = computed(() => {
  if (selectedId.value === null) return catalog.flatFunctions

  const blocked = new Set<string>([selectedId.value])
  let changed = true
  while (changed) {
    changed = false
    for (const node of catalog.cognitiveFunctions) {
      if (node.parentId !== null && blocked.has(node.parentId) && !blocked.has(node.id)) {
        blocked.add(node.id)
        changed = true
      }
    }
  }

  return catalog.flatFunctions.filter((entry) => !blocked.has(entry.node.id))
})
</script>

<template>
  <div class="p-6">
    <header class="mb-5">
      <h1 class="text-xl font-bold text-ink-800">Funções cognitivas</h1>
      <p class="text-sm text-ink-500">
        Árvore de profundidade ilimitada. Os instrumentos são vinculados a estas funções, e o
        relatório por função segue exatamente esta estrutura.
      </p>
    </header>

    <div class="grid grid-cols-5 gap-6">
      <div class="col-span-2">
        <TreeManager
          :nodes="catalog.cognitiveFunctions"
          :tree="catalog.functionTree"
          :selected-id="selectedId"
          empty-message="Nenhuma função cadastrada."
          @select="select"
          @add-child="startNew"
          @move="move"
        />
      </div>

      <div class="col-span-3">
        <div v-if="!isNew && selected === null" class="card p-8 text-center text-sm text-ink-400">
          Selecione uma função para editar, ou adicione uma nova.
        </div>

        <div v-else class="card p-5">
          <h2 class="mb-4 text-base font-semibold text-ink-800">
            {{ isNew ? 'Nova função cognitiva' : selected?.name }}
          </h2>

          <form class="space-y-4" @submit.prevent="save">
            <div>
              <label class="field-label" for="function-name">Nome</label>
              <input id="function-name" v-model="form.name" class="field-input" required />
            </div>

            <div>
              <label class="field-label" for="function-parent">Função pai</label>
              <select id="function-parent" v-model="form.parentId" class="field-input">
                <option :value="null">Nenhuma (raiz)</option>
                <option v-for="entry in parentOptions" :key="entry.node.id" :value="entry.node.id">
                  {{ '— '.repeat(entry.depth) }}{{ entry.node.name }}
                </option>
              </select>
            </div>

            <div>
              <label class="field-label" for="function-description">Descrição</label>
              <textarea
                id="function-description"
                v-model="form.description"
                class="field-input min-h-24"
              />
            </div>

            <div class="flex items-center justify-between">
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
      </div>
    </div>

    <ConfirmDialog
      v-model:open="deleteOpen"
      title="Excluir função cognitiva"
      message="As subfunções serão excluídas junto. Os instrumentos vinculados permanecem cadastrados, mas perdem o vínculo com esta função."
      :impact="impact"
      confirm-label="Excluir"
      @confirm="confirmDelete"
    />
  </div>
</template>
