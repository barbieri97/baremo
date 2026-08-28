<script setup lang="ts">
/**
 * Configurações: perfil profissional, paleta de cores e módulo de IA
 * (spec §4.1, §5, §10.2, §10.3).
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { checkContrast, normalizeHex } from '@shared/domain/color'
import { AI_MODELS, AI_MODEL_LABELS } from '@shared/contracts/entities-ai'
import type { AiConfig, AiModel } from '@shared/contracts/entities-ai'
import type { ProfessionalProfile } from '@shared/contracts/entities'

const appStore = useAppStore()
const catalog = useCatalogStore()

const tab = ref<'profile' | 'palette' | 'ai'>('profile')

// Literal em constante: chaves duplas dentro de uma interpolação quebram o
// parser de template do Vue.
const NAME_TOKEN = '{{paciente.nome}}'

const profile = ref<ProfessionalProfile | null>(null)
const savingProfile = ref(false)

const newColor = ref({ name: '', hex: '#2B6CB0' })
const deletingColorId = ref<string | null>(null)
const deleteColorOpen = ref(false)

const aiConfig = ref<AiConfig | null>(null)
const apiKey = ref('')
const persistKey = ref(true)
const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const pseudonymizeConfirmOpen = ref(false)

async function load(): Promise<void> {
  try {
    profile.value = await api('config:getProfile')
    aiConfig.value = await api('ai:getConfig')
    await catalog.load(true)
  } catch (error) {
    appStore.notifyError(error)
  }
}

onMounted(load)

async function saveProfile(): Promise<void> {
  if (profile.value === null) return
  savingProfile.value = true
  try {
    profile.value = await api('config:saveProfile', profile.value)
    appStore.notify('success', 'Perfil salvo.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    savingProfile.value = false
  }
}

/** Logo do cabeçalho de relatório, embutido como data URI. */
function onLogoSelected(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || profile.value === null) return

  if (file.size > 1_000_000) {
    appStore.notify('warning', 'A imagem deve ter no máximo 1 MB.')
    return
  }

  const reader = new FileReader()
  reader.onload = () => {
    if (profile.value !== null) profile.value.logoDataUrl = String(reader.result)
  }
  reader.readAsDataURL(file)
}

async function addColor(): Promise<void> {
  const hex = normalizeHex(newColor.value.hex)
  if (hex === null || newColor.value.name.trim() === '') return

  try {
    await api('config:saveColor', { id: null, name: newColor.value.name.trim(), hex })
    newColor.value = { name: '', hex: '#2B6CB0' }
    await catalog.load(true)
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function updateColor(id: string, name: string, hex: string): Promise<void> {
  const normalized = normalizeHex(hex)
  if (normalized === null) return
  try {
    await api('config:saveColor', { id, name, hex: normalized })
    await catalog.load(true)
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmDeleteColor(): Promise<void> {
  if (deletingColorId.value === null) return
  try {
    await api('config:deleteColor', { id: deletingColorId.value })
    await catalog.load(true)
    appStore.notify('success', 'Cor removida.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    deleteColorOpen.value = false
    deletingColorId.value = null
  }
}

function contrastOf(hex: string): ReturnType<typeof checkContrast> {
  return checkContrast(hex)
}

// ─── Módulo de IA ──────────────────────────────────────────────────────────

async function setEnabled(enabled: boolean): Promise<void> {
  try {
    aiConfig.value = await api('ai:setEnabled', { enabled })
    await appStore.refresh()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function setModel(model: AiModel): Promise<void> {
  try {
    aiConfig.value = await api('ai:setModel', { model })
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function setBudget(value: number): Promise<void> {
  try {
    aiConfig.value = await api('ai:setBudget', { monthlyTokenBudget: value })
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function togglePseudonymize(enabled: boolean): Promise<void> {
  if (!enabled) {
    pseudonymizeConfirmOpen.value = true
    return
  }
  try {
    aiConfig.value = await api('ai:setPseudonymize', { enabled: true, confirmed: true })
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function confirmDisablePseudonymize(): Promise<void> {
  try {
    aiConfig.value = await api('ai:setPseudonymize', { enabled: false, confirmed: true })
    appStore.notify('warning', 'Pseudonimização desligada. O registro ficou na auditoria da IA.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    pseudonymizeConfirmOpen.value = false
  }
}

async function testKey(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await api('ai:testKey', { key: apiKey.value })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    testing.value = false
  }
}

async function saveKey(): Promise<void> {
  try {
    aiConfig.value = await api('ai:saveKey', { key: apiKey.value, persist: persistKey.value })
    apiKey.value = ''
    testResult.value = null
    appStore.notify('success', 'Chave salva.')
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function clearKey(): Promise<void> {
  try {
    aiConfig.value = await api('ai:clearKey')
    appStore.notify('success', 'Chave removida.')
  } catch (error) {
    appStore.notifyError(error)
  }
}

const budgetPercent = computed(() => {
  if (aiConfig.value === null || aiConfig.value.monthlyTokenBudget === 0) return 0
  return Math.min(
    100,
    (aiConfig.value.tokensUsedThisMonth / aiConfig.value.monthlyTokenBudget) * 100
  )
})
</script>

<template>
  <div class="p-6">
    <header class="mb-5">
      <h1 class="text-xl font-bold text-ink-800">Configurações</h1>
    </header>

    <div class="mb-4 flex gap-1 border-b border-ink-200">
      <button
        v-for="entry in [
          { key: 'profile', label: 'Perfil profissional' },
          { key: 'palette', label: 'Paleta de cores' },
          { key: 'ai', label: 'Assistente de IA' }
        ] as const"
        :key="entry.key"
        class="px-4 py-2 text-sm font-medium"
        :class="
          tab === entry.key
            ? 'border-b-2 border-brand-500 text-brand-700'
            : 'text-ink-500 hover:text-ink-700'
        "
        @click="tab = entry.key"
      >
        {{ entry.label }}
      </button>
    </div>

    <!-- Perfil profissional -->
    <section v-if="tab === 'profile' && profile !== null" class="card max-w-3xl p-5">
      <form class="grid grid-cols-2 gap-4" @submit.prevent="saveProfile">
        <div>
          <label class="field-label" for="profile-name">Nome</label>
          <input id="profile-name" v-model="profile.name" class="field-input" />
        </div>
        <div>
          <label class="field-label" for="profile-crp">CRP</label>
          <input id="profile-crp" v-model="profile.crp" class="field-input" />
        </div>
        <div>
          <label class="field-label" for="profile-specialty">Especialidade</label>
          <input id="profile-specialty" v-model="profile.specialty" class="field-input" />
        </div>
        <div>
          <label class="field-label" for="profile-phone">Telefone</label>
          <input id="profile-phone" v-model="profile.phone" class="field-input" />
        </div>
        <div>
          <label class="field-label" for="profile-email">E-mail</label>
          <input id="profile-email" v-model="profile.email" class="field-input" />
        </div>
        <div>
          <label class="field-label" for="profile-address">Endereço de atendimento</label>
          <input id="profile-address" v-model="profile.address" class="field-input" />
        </div>

        <div class="col-span-2">
          <label class="field-label" for="profile-logo">Logotipo (cabeçalho dos relatórios)</label>
          <div class="flex items-center gap-4">
            <img
              v-if="profile.logoDataUrl"
              :src="profile.logoDataUrl"
              alt="Logotipo"
              class="h-16 w-auto rounded border border-ink-200 object-contain"
            />
            <input id="profile-logo" type="file" accept="image/*" @change="onLogoSelected" />
            <BaseButton
              v-if="profile.logoDataUrl"
              size="sm"
              @click="profile.logoDataUrl = null"
            >
              Remover
            </BaseButton>
          </div>
        </div>

        <div class="col-span-2 flex justify-end">
          <BaseButton variant="primary" :loading="savingProfile" @click="saveProfile">
            Salvar perfil
          </BaseButton>
        </div>
      </form>
    </section>

    <!-- Paleta -->
    <section v-else-if="tab === 'palette'" class="card max-w-3xl p-5">
      <p class="mb-4 text-sm text-ink-600">
        As cores são associadas livremente às faixas de classificação — o sistema não força
        vínculo entre cor e classificação. O aviso de contraste é informativo e não bloqueia.
      </p>

      <ul class="mb-5 divide-y divide-ink-200">
        <li v-for="color in catalog.colors" :key="color.id" class="flex items-center gap-3 py-2">
          <input
            type="color"
            :value="color.hex"
            class="h-8 w-12 rounded border border-ink-300"
            :aria-label="`Cor ${color.name}`"
            @change="updateColor(color.id, color.name, ($event.target as HTMLInputElement).value)"
          />
          <input
            :value="color.name"
            class="field-input max-w-xs py-1"
            :aria-label="`Nome da cor ${color.name}`"
            @change="updateColor(color.id, ($event.target as HTMLInputElement).value, color.hex)"
          />
          <span
            class="rounded px-2 py-0.5 text-xs font-semibold"
            :style="{
              backgroundColor: color.hex,
              color: contrastOf(color.hex)?.textColor ?? '#000'
            }"
          >
            Exemplo
          </span>
          <span
            v-if="contrastOf(color.hex) && !contrastOf(color.hex)!.passesAA"
            class="text-xs text-warn-700"
          >
            Contraste {{ contrastOf(color.hex)!.ratio.toFixed(2) }}:1 — abaixo de AA
          </span>
          <button
            class="ml-auto text-xs text-danger-500 hover:underline"
            @click="
              () => {
                deletingColorId = color.id
                deleteColorOpen = true
              }
            "
          >
            Remover
          </button>
        </li>
      </ul>

      <div class="flex items-end gap-3 border-t border-ink-200 pt-4">
        <div>
          <label class="field-label" for="new-color-name">Nova cor</label>
          <input
            id="new-color-name"
            v-model="newColor.name"
            class="field-input"
            placeholder="Nome"
          />
        </div>
        <input
          v-model="newColor.hex"
          type="color"
          class="h-9 w-12 rounded border border-ink-300"
          aria-label="Cor"
        />
        <BaseButton :disabled="newColor.name.trim() === ''" @click="addColor">Adicionar</BaseButton>
      </div>
    </section>

    <!-- Módulo de IA -->
    <section v-else-if="tab === 'ai' && aiConfig !== null" class="max-w-3xl space-y-4">
      <div class="rounded-md border border-warn-200 bg-warn-50 p-4 text-sm text-warn-700">
        <p class="font-semibold">Este módulo envia dados de saúde a um provedor externo.</p>
        <p class="mt-1 leading-snug">
          O Baremo é local-first, com processamento em nuvem opcional e consentido. Com o módulo
          ligado, consultas ao assistente enviam dados do prontuário à API do Google Gemini.
          Recomendamos fortemente usar uma chave de projeto com <strong>faturamento
          habilitado</strong>: chaves de nível gratuito historicamente têm política de retenção e
          uso para melhoria de produto distinta — o que é inadequado para dado sensível de saúde.
        </p>
      </div>

      <div class="card p-5">
        <label class="flex items-start gap-3">
          <input
            type="checkbox"
            :checked="aiConfig.enabled"
            class="mt-1 rounded border-ink-300"
            @change="setEnabled(($event.target as HTMLInputElement).checked)"
          />
          <span>
            <span class="text-sm font-medium text-ink-800">Ativar o assistente de IA</span>
            <span class="block text-xs text-ink-500">
              Desligado por padrão. Todo o restante do aplicativo funciona sem ele.
            </span>
          </span>
        </label>
      </div>

      <div class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-800">Chave de API</h2>

        <p v-if="!aiConfig.safeStorageAvailable" class="mb-3 rounded bg-warn-50 p-3 text-xs text-warn-700">
          A criptografia do sistema não está disponível neste computador (comum em Linux sem
          keyring configurado). Gravar a chave em disco aqui não teria proteção real — use a opção
          de não persistir e informe a chave a cada execução.
        </p>

        <p v-if="aiConfig.hasKey" class="mb-3 text-sm text-ink-600">
          Chave cadastrada, terminada em <span class="font-mono">…{{ aiConfig.keyHint }}</span>
          <span v-if="!aiConfig.keyPersisted"> (não persistida em disco)</span>.
        </p>

        <div class="flex items-end gap-3">
          <div class="flex-1">
            <label class="field-label" for="api-key">
              {{ aiConfig.hasKey ? 'Substituir chave' : 'Chave de API do Gemini' }}
            </label>
            <input
              id="api-key"
              v-model="apiKey"
              type="password"
              class="field-input font-mono"
              autocomplete="off"
              placeholder="AIza…"
            />
          </div>
          <BaseButton :disabled="apiKey === ''" :loading="testing" @click="testKey">
            Testar
          </BaseButton>
          <BaseButton
            variant="primary"
            :disabled="apiKey === '' || testResult?.ok !== true"
            @click="saveKey"
          >
            Salvar
          </BaseButton>
          <BaseButton v-if="aiConfig.hasKey" variant="danger" @click="clearKey">Remover</BaseButton>
        </div>

        <label class="mt-3 flex items-center gap-2 text-xs text-ink-600">
          <input
            v-model="persistKey"
            type="checkbox"
            class="rounded border-ink-300"
            :disabled="!aiConfig.safeStorageAvailable"
          />
          Guardar a chave criptografada neste computador
        </label>

        <p
          v-if="testResult !== null"
          class="mt-3 text-sm"
          :class="testResult.ok ? 'text-ok-500' : 'text-danger-500'"
        >
          {{ testResult.message }}
        </p>
      </div>

      <div class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-800">Modelo e custo</h2>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="ai-model">Modelo</label>
            <select
              id="ai-model"
              :value="aiConfig.model"
              class="field-input"
              @change="setModel(($event.target as HTMLSelectElement).value as AiModel)"
            >
              <option v-for="model in AI_MODELS" :key="model" :value="model">
                {{ AI_MODEL_LABELS[model] }}
              </option>
            </select>
          </div>

          <div>
            <label class="field-label" for="ai-budget">Teto mensal de tokens</label>
            <input
              id="ai-budget"
              :value="aiConfig.monthlyTokenBudget"
              type="number"
              min="0"
              step="100000"
              class="field-input tabular"
              @change="setBudget(Number(($event.target as HTMLInputElement).value))"
            />
          </div>
        </div>

        <div class="mt-4">
          <div class="mb-1 flex justify-between text-xs text-ink-500">
            <span>Consumo em {{ aiConfig.budgetPeriod || 'este mês' }}</span>
            <span class="tabular">
              {{ aiConfig.tokensUsedThisMonth.toLocaleString('pt-BR') }} /
              {{ aiConfig.monthlyTokenBudget.toLocaleString('pt-BR') }}
            </span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-ink-200">
            <div
              class="h-full rounded-full"
              :class="budgetPercent >= 100 ? 'bg-danger-500' : 'bg-brand-500'"
              :style="{ width: `${budgetPercent}%` }"
            />
          </div>
          <p v-if="budgetPercent >= 100" class="mt-1 text-xs text-danger-500">
            Teto atingido. Novas consultas serão recusadas até você aumentar o limite.
          </p>
        </div>
      </div>

      <div class="card p-5">
        <h2 class="mb-3 text-sm font-semibold text-ink-800">Pseudonimização</h2>

        <label class="flex items-start gap-3">
          <input
            type="checkbox"
            :checked="aiConfig.pseudonymize"
            class="mt-1 rounded border-ink-300"
            @change="togglePseudonymize(($event.target as HTMLInputElement).checked)"
          />
          <span>
            <span class="text-sm font-medium text-ink-800">
              Pseudonimizar antes de enviar (recomendado)
            </span>
            <span class="block text-xs leading-snug text-ink-500">
              Nome completo vira iniciais, data de nascimento vira idade, e responsável, escola,
              endereço e contatos são removidos. Ao redigir documentos, o assistente usa tokens
              como <span class="font-mono">{{ NAME_TOKEN }}</span>, que o editor resolve
              localmente — o documento final sai com o nome real sem que ele saia do computador.
            </span>
          </span>
        </label>
      </div>
    </section>

    <ConfirmDialog
      v-model:open="deleteColorOpen"
      title="Remover cor"
      message="A cor será removida da paleta. Faixas de classificação que a utilizam impedem a remoção."
      confirm-label="Remover"
      @confirm="confirmDeleteColor"
    />

    <ConfirmDialog
      v-model:open="pseudonymizeConfirmOpen"
      title="Desligar a pseudonimização"
      message="Com a pseudonimização desligada, o nome completo, a data de nascimento e os contatos do paciente passam a ser enviados ao provedor de IA. Esta escolha fica registrada na auditoria do módulo."
      confirm-label="Desligar mesmo assim"
      @confirm="confirmDisablePseudonymize"
    />
  </div>
</template>
