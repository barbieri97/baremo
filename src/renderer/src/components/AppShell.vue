<script setup lang="ts">
/**
 * Casca do aplicativo: navegação lateral, avisos e o indicador do módulo de IA.
 *
 * O indicador de estado da IA é permanente por decisão registrada (ADR-001): o
 * produto deixou de ser "100% local", e o usuário precisa conseguir responder
 * "meus dados estão saindo daqui?" a qualquer momento, sem abrir configurações.
 */
import { computed, ref } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'
import BaseButton from './BaseButton.vue'
import BaseAlert from './BaseAlert.vue'

const appStore = useAppStore()
const route = useRoute()

interface NavItem {
  readonly to: string
  readonly label: string
  readonly hint: string
}

const NAV: readonly NavItem[] = [
  { to: '/pacientes', label: 'Pacientes', hint: 'Prontuários e avaliações' },
  { to: '/funcoes', label: 'Funções cognitivas', hint: 'Árvore de funções' },
  { to: '/instrumentos', label: 'Instrumentos', hint: 'Testes, subtestes e faixas' },
  { to: '/manutencao', label: 'Manutenção', hint: 'Backups, integridade e arquivos' },
  { to: '/configuracoes', label: 'Configurações', hint: 'Perfil, paleta e IA' }
]

const TOAST_TONES = {
  info: 'neutral',
  success: 'ok',
  warning: 'warn',
  error: 'danger'
} as const

const aiEnabled = computed(() => appStore.state?.aiEnabled ?? false)

const showDiskNotice = computed(
  () => appStore.state !== null && !appStore.state.diskEncryptionNoticeAcknowledged
)

const readyUpdate = computed(() =>
  appStore.updateStatus.kind === 'downloaded' ? appStore.updateStatus : null
)
const restarting = ref(false)

async function restartToUpdate(): Promise<void> {
  restarting.value = true
  try {
    await appStore.installUpdate()
  } catch (error) {
    restarting.value = false
    appStore.notifyError(error)
  }
}

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="flex h-full">
    <aside class="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div class="px-4 py-4">
        <p class="text-lg font-bold tracking-tight text-fg">Baremo</p>
        <p class="text-xs text-fg-subtle">Avaliação neuropsicológica</p>
      </div>

      <nav class="flex-1 px-2" aria-label="Navegação principal">
        <RouterLink
          v-for="item in NAV"
          :key="item.to"
          :to="item.to"
          class="mb-0.5 block rounded-control px-3 py-2 text-sm transition-colors"
          :class="
            isActive(item.to)
              ? 'bg-accent-soft font-semibold text-accent-strong'
              : 'text-fg-muted hover:bg-surface-muted'
          "
        >
          {{ item.label }}
          <span class="block text-xs font-normal text-fg-faint">{{ item.hint }}</span>
        </RouterLink>
      </nav>

      <!-- §15.3: a nova versão já foi baixada e só entra com o reinício. -->
      <BaseAlert
        v-if="readyUpdate !== null"
        tone="info"
        size="sm"
        :title="`Nova versão disponível (${readyUpdate.version})`"
        class="mx-2 mb-2"
        role="status"
      >
        <p class="text-fg-muted">Reinicie o Baremo para instalar a atualização.</p>
        <BaseButton
          variant="primary"
          size="sm"
          class="mt-2 w-full"
          :loading="restarting"
          @click="restartToUpdate"
        >
          Reiniciar
        </BaseButton>
      </BaseAlert>

      <!-- ADR-001: estado do módulo sempre visível. -->
      <div class="border-t border-line px-4 py-3">
        <div class="flex items-center gap-2">
          <span
            class="size-2 rounded-full"
            :class="aiEnabled ? 'bg-warn' : 'bg-line-strong'"
            aria-hidden="true"
          />
          <p class="text-xs font-semibold text-fg-secondary">
            IA {{ aiEnabled ? 'ativa' : 'desligada' }}
          </p>
        </div>
        <p class="mt-1 text-xs leading-snug text-fg-subtle">
          {{
            aiEnabled
              ? 'Consultas ao assistente enviam dados a um provedor externo.'
              : 'Nenhum dado sai deste computador.'
          }}
        </p>
      </div>
    </aside>

    <main class="flex-1 overflow-y-auto">
      <!-- §16.1: a criptografia de disco do sistema é requisito de instalação,
           e precisa ser comunicada na primeira execução. -->
      <BaseAlert
        v-if="showDiskNotice"
        tone="warn"
        banner
        title="Ative a criptografia de disco do seu sistema."
      >
        <p>
          O Baremo guarda o banco de dados e os arquivos anexados em claro no seu computador. A
          proteção desses dados depende do FileVault (macOS), BitLocker (Windows) ou LUKS (Linux).
          Backups e prontuários exportados herdam a mesma exposição.
        </p>
        <BaseButton size="sm" class="mt-2" @click="appStore.acknowledgeDiskNotice()">
          Entendi
        </BaseButton>
      </BaseAlert>

      <RouterView />
    </main>

    <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2">
      <BaseAlert
        v-for="toast in appStore.toasts"
        :key="toast.id"
        :tone="TOAST_TONES[toast.kind]"
        dismissible
        class="pointer-events-auto shadow-lg"
        role="status"
        @dismiss="appStore.dismiss(toast.id)"
      >
        {{ toast.message }}
      </BaseAlert>
    </div>
  </div>
</template>
