<script setup lang="ts">
/**
 * Configurações: perfil profissional, paleta de cores, módulo de IA e sobre o
 * sistema (spec §4.1, §5, §10.2, §10.3, §15.3).
 */
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useCatalogStore } from '../stores/catalog'
import BaseButton from '../components/BaseButton.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseTabs from '../components/BaseTabs.vue'
import BaseAlert from '../components/BaseAlert.vue'
import BaseField from '../components/BaseField.vue'
import BaseInput from '../components/BaseInput.vue'
import BaseSelect from '../components/BaseSelect.vue'
import BaseCheckbox from '../components/BaseCheckbox.vue'
import BaseProgress from '../components/BaseProgress.vue'
import ClassificationBadge from '../components/ClassificationBadge.vue'
import { checkContrast, normalizeHex } from '@shared/domain/color'
import { AI_MODELS, AI_MODEL_LABELS } from '@shared/contracts/entities-ai'
import type { AiConfig, AiModel } from '@shared/contracts/entities-ai'
import type { ProfessionalProfile } from '@shared/contracts/entities'
// O mesmo ícone do instalador, para a aba "Sobre" não divergir dele.
import appIconUrl from '../../../../build/icon.png'

const appStore = useAppStore()
const catalog = useCatalogStore()

const TABS = [
  { value: 'profile', label: 'Perfil profissional' },
  { value: 'palette', label: 'Paleta de cores' },
  { value: 'ai', label: 'Assistente de IA' },
  { value: 'about', label: 'Sobre o sistema' }
] as const

const tab = ref<(typeof TABS)[number]['value']>('profile')

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

/**
 * Caixa da logo no cabeçalho impresso: 40 × 22 mm a 300 dpi.
 *
 * O mesmo limite vale no processo principal (`main/images/logo.ts`), que é a
 * autoridade. Aqui a redução acontece porque o Chromium decodifica qualquer
 * formato que ele saiba exibir, e porque encolher antes de enviar evita
 * atravessar a fronteira IPC com megabytes de base64.
 */
const LOGO_MAX_WIDTH = 480
const LOGO_MAX_HEIGHT = 260

/** Logo do cabeçalho de relatório, reduzida e embutida como data URI. */
async function onLogoSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || profile.value === null) return

  if (file.size > 8_000_000) {
    appStore.notify('warning', 'A imagem deve ter no máximo 8 MB.')
    return
  }

  try {
    profile.value.logoDataUrl = await downscaleToPng(file)
  } catch {
    appStore.notify('warning', 'Não foi possível ler esta imagem. Tente um arquivo PNG ou JPEG.')
  } finally {
    // Sem isto, escolher o MESMO arquivo depois de remover a logo não dispara
    // `change` de novo, e o campo parece ter travado.
    input.value = ''
  }
}

/**
 * Reduz proporcionalmente e devolve PNG.
 *
 * PNG, e não JPEG, para preservar transparência — uma logo com fundo branco
 * sólido sobre o cabeçalho denuncia o recorte.
 */
async function downscaleToPng(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)

  try {
    const scale = Math.min(1, LOGO_MAX_WIDTH / bitmap.width, LOGO_MAX_HEIGHT / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas indisponível')
    context.drawImage(bitmap, 0, 0, width, height)

    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
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

// ─── Sobre o sistema ───────────────────────────────────────────────────────

const updateMessage = computed(() => {
  const status = appStore.updateStatus
  switch (status.kind) {
    case 'unsupported':
      return 'Atualização automática indisponível nesta versão de desenvolvimento.'
    case 'idle':
      return 'A verificação de atualizações ainda não foi feita.'
    case 'checking':
      return 'Verificando atualizações…'
    case 'downloading':
      return `Baixando a versão ${status.version} (${status.percent}%)…`
    case 'up-to-date':
      return 'Você está usando a versão mais recente.'
    case 'downloaded':
      return `A versão ${status.version} foi baixada. Reinicie para instalar.`
  }
  return status.message
})

const checkingUpdates = computed(
  () => appStore.updateStatus.kind === 'checking' || appStore.updateStatus.kind === 'downloading'
)
const restarting = ref(false)

async function checkUpdates(): Promise<void> {
  try {
    await appStore.checkForUpdates()
  } catch (error) {
    appStore.notifyError(error)
  }
}

async function restartToUpdate(): Promise<void> {
  restarting.value = true
  try {
    await appStore.installUpdate()
  } catch (error) {
    restarting.value = false
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
    <PageHeader title="Configurações" class="mb-6" />

    <BaseTabs v-model="tab" :items="TABS" label="Seções das configurações" class="mb-4" />

    <!-- Perfil profissional -->
    <BaseCard
      v-if="tab === 'profile' && profile !== null"
      as="section"
      padding="lg"
      class="max-w-3xl"
    >
      <form class="grid grid-cols-2 gap-4" @submit.prevent="saveProfile">
        <BaseField id="profile-name" label="Nome">
          <BaseInput v-model="profile.name" />
        </BaseField>
        <BaseField id="profile-crp" label="CRP">
          <BaseInput v-model="profile.crp" />
        </BaseField>
        <BaseField id="profile-specialty" label="Especialidade">
          <BaseInput v-model="profile.specialty" />
        </BaseField>
        <BaseField id="profile-phone" label="Telefone">
          <BaseInput v-model="profile.phone" />
        </BaseField>
        <BaseField id="profile-email" label="E-mail">
          <BaseInput v-model="profile.email" />
        </BaseField>
        <BaseField id="profile-address" label="Endereço de atendimento">
          <BaseInput v-model="profile.address" />
        </BaseField>

        <BaseField id="profile-logo" label="Logotipo (cabeçalho dos relatórios)" class="col-span-2">
          <div class="flex items-center gap-4">
            <img
              v-if="profile.logoDataUrl"
              :src="profile.logoDataUrl"
              alt="Logotipo"
              class="h-16 w-auto rounded-chip border border-line object-contain"
            />
            <input
              id="profile-logo"
              type="file"
              class="text-sm text-fg-muted"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              @change="onLogoSelected"
            />
            <BaseButton v-if="profile.logoDataUrl" size="sm" @click="profile.logoDataUrl = null">
              Remover
            </BaseButton>
          </div>
        </BaseField>

        <div class="col-span-2 flex justify-end">
          <BaseButton variant="primary" :loading="savingProfile" @click="saveProfile">
            Salvar perfil
          </BaseButton>
        </div>
      </form>
    </BaseCard>

    <!-- Paleta -->
    <BaseCard v-else-if="tab === 'palette'" as="section" padding="lg" class="max-w-3xl">
      <p class="mb-4 text-sm text-fg-muted">
        As cores são associadas livremente às faixas de classificação — o sistema não força vínculo
        entre cor e classificação. O aviso de contraste é informativo e não bloqueia.
      </p>

      <ul class="mb-5 divide-y divide-line">
        <li v-for="color in catalog.colors" :key="color.id" class="flex items-center gap-3 py-2">
          <input
            type="color"
            :value="color.hex"
            class="h-8 w-12 rounded-chip border border-line-strong"
            :aria-label="`Cor ${color.name}`"
            @change="updateColor(color.id, color.name, ($event.target as HTMLInputElement).value)"
          />
          <BaseInput
            :model-value="color.name"
            size="sm"
            class="max-w-xs"
            :aria-label="`Nome da cor ${color.name}`"
            @change="updateColor(color.id, ($event.target as HTMLInputElement).value, color.hex)"
          />
          <ClassificationBadge name="Exemplo" :color-hex="color.hex" />
          <span
            v-if="contrastOf(color.hex) && !contrastOf(color.hex)!.passesAA"
            class="text-xs text-warn-strong"
          >
            Contraste {{ contrastOf(color.hex)!.ratio.toFixed(2) }}:1 — abaixo de AA
          </span>
          <BaseButton
            variant="link-danger"
            size="sm"
            class="ml-auto"
            @click="
              () => {
                deletingColorId = color.id
                deleteColorOpen = true
              }
            "
          >
            Remover
          </BaseButton>
        </li>
      </ul>

      <div class="flex items-end gap-3 border-t border-line pt-4">
        <BaseField id="new-color-name" label="Nova cor">
          <BaseInput v-model="newColor.name" placeholder="Nome" />
        </BaseField>
        <input
          v-model="newColor.hex"
          type="color"
          class="h-9 w-12 rounded-chip border border-line-strong"
          aria-label="Cor"
        />
        <BaseButton :disabled="newColor.name.trim() === ''" @click="addColor">Adicionar</BaseButton>
      </div>
    </BaseCard>

    <!-- Módulo de IA -->
    <section v-else-if="tab === 'ai' && aiConfig !== null" class="max-w-3xl space-y-4">
      <BaseAlert tone="warn" title="Este módulo envia dados de saúde a um provedor externo.">
        <p>
          O Baremo é local-first, com processamento em nuvem opcional e consentido. Com o módulo
          ligado, consultas ao assistente enviam dados do prontuário à API do Google Gemini.
          Recomendamos fortemente usar uma chave de projeto com
          <strong>faturamento habilitado</strong>: chaves de nível gratuito historicamente têm
          política de retenção e uso para melhoria de produto distinta — o que é inadequado para
          dado sensível de saúde.
        </p>
      </BaseAlert>

      <BaseCard padding="lg">
        <BaseCheckbox
          :model-value="aiConfig.enabled"
          label="Ativar o assistente de IA"
          description="Desligado por padrão. Todo o restante do aplicativo funciona sem ele."
          @update:model-value="setEnabled($event === true)"
        />
      </BaseCard>

      <BaseCard padding="lg">
        <SectionHeader title="Chave de API" size="sm" class="mb-3" />

        <BaseAlert v-if="!aiConfig.safeStorageAvailable" tone="warn" size="sm" class="mb-3">
          A criptografia do sistema não está disponível neste computador (comum em Linux sem keyring
          configurado). Gravar a chave em disco aqui não teria proteção real — use a opção de não
          persistir e informe a chave a cada execução.
        </BaseAlert>

        <p v-if="aiConfig.hasKey" class="mb-3 text-sm text-fg-muted">
          Chave cadastrada, terminada em <span class="font-mono">…{{ aiConfig.keyHint }}</span>
          <span v-if="!aiConfig.keyPersisted"> (não persistida em disco)</span>.
        </p>

        <div class="flex items-end gap-3">
          <BaseField
            id="api-key"
            :label="aiConfig.hasKey ? 'Substituir chave' : 'Chave de API do Gemini'"
            class="flex-1"
          >
            <BaseInput
              v-model="apiKey"
              type="password"
              class="font-mono"
              autocomplete="off"
              placeholder="AIza…"
            />
          </BaseField>
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

        <BaseCheckbox
          v-model="persistKey"
          size="sm"
          class="mt-3"
          :disabled="!aiConfig.safeStorageAvailable"
          label="Guardar a chave criptografada neste computador"
        />

        <p
          v-if="testResult !== null"
          class="mt-3 text-sm"
          :class="testResult.ok ? 'text-ok' : 'text-danger'"
        >
          {{ testResult.message }}
        </p>
      </BaseCard>

      <BaseCard padding="lg">
        <SectionHeader title="Modelo e custo" size="sm" class="mb-3" />

        <div class="grid grid-cols-2 gap-4">
          <BaseField id="ai-model" label="Modelo">
            <BaseSelect
              :model-value="aiConfig.model"
              @update:model-value="setModel($event as AiModel)"
            >
              <option v-for="model in AI_MODELS" :key="model" :value="model">
                {{ AI_MODEL_LABELS[model] }}
              </option>
            </BaseSelect>
          </BaseField>

          <BaseField id="ai-budget" label="Teto mensal de tokens">
            <BaseInput
              :model-value="aiConfig.monthlyTokenBudget"
              type="number"
              min="0"
              step="100000"
              class="tabular"
              @change="setBudget(Number(($event.target as HTMLInputElement).value))"
            />
          </BaseField>
        </div>

        <div class="mt-4">
          <div class="mb-1 flex justify-between text-xs text-fg-subtle">
            <span>Consumo em {{ aiConfig.budgetPeriod || 'este mês' }}</span>
            <span class="tabular">
              {{ aiConfig.tokensUsedThisMonth.toLocaleString('pt-BR') }} /
              {{ aiConfig.monthlyTokenBudget.toLocaleString('pt-BR') }}
            </span>
          </div>
          <BaseProgress
            :value="budgetPercent"
            :tone="budgetPercent >= 100 ? 'danger' : 'accent'"
            label="Consumo do teto mensal de tokens"
          />
          <p v-if="budgetPercent >= 100" class="mt-1 text-xs text-danger">
            Teto atingido. Novas consultas serão recusadas até você aumentar o limite.
          </p>
        </div>
      </BaseCard>

      <BaseCard padding="lg">
        <SectionHeader title="Pseudonimização" size="sm" class="mb-3" />

        <BaseCheckbox
          :model-value="aiConfig.pseudonymize"
          label="Pseudonimizar antes de enviar (recomendado)"
          @update:model-value="togglePseudonymize($event === true)"
        >
          <template #description>
            Nome completo vira iniciais, data de nascimento vira idade, e responsável, escola,
            endereço e contatos são removidos. Ao redigir documentos, o assistente usa tokens como
            <span class="font-mono">{{ NAME_TOKEN }}</span
            >, que o editor resolve localmente — o documento final sai com o nome real sem que ele
            saia do computador.
          </template>
        </BaseCheckbox>
      </BaseCard>
    </section>

    <!-- Sobre o sistema -->
    <BaseCard v-else-if="tab === 'about'" as="section" padding="lg" class="max-w-3xl">
      <div class="flex items-center gap-4">
        <img :src="appIconUrl" alt="" class="size-16 shrink-0" />
        <div>
          <p class="text-lg font-bold tracking-tight text-fg">Baremo</p>
          <p class="text-sm text-fg-subtle">Avaliação neuropsicológica</p>
          <p class="mt-1 text-sm text-fg-secondary">
            Versão
            <span class="tabular font-semibold">{{ appStore.state?.appVersion ?? '—' }}</span>
          </p>
        </div>
      </div>

      <div class="mt-5 flex items-center gap-3 border-t border-line pt-4">
        <p
          class="flex-1 text-sm"
          :class="appStore.updateStatus.kind === 'error' ? 'text-danger' : 'text-fg-muted'"
        >
          {{ updateMessage }}
        </p>
        <BaseButton
          v-if="appStore.updateStatus.kind === 'downloaded'"
          variant="primary"
          :loading="restarting"
          @click="restartToUpdate"
        >
          Reiniciar
        </BaseButton>
        <BaseButton
          v-else-if="appStore.updateStatus.kind !== 'unsupported'"
          :loading="checkingUpdates"
          @click="checkUpdates"
        >
          Verificar atualizações
        </BaseButton>
      </div>
    </BaseCard>

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
