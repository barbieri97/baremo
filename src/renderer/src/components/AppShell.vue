<script setup lang="ts">
/**
 * Casca do aplicativo: navegação lateral, avisos e o indicador do módulo de IA.
 *
 * O indicador de estado da IA é permanente por decisão registrada (ADR-001): o
 * produto deixou de ser "100% local", e o usuário precisa conseguir responder
 * "meus dados estão saindo daqui?" a qualquer momento, sem abrir configurações.
 */
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAppStore } from '../stores/app'

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

const aiEnabled = computed(() => appStore.state?.aiEnabled ?? false)

const showDiskNotice = computed(
  () => appStore.state !== null && !appStore.state.diskEncryptionNoticeAcknowledged
)

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <div class="flex h-full">
    <aside class="flex w-60 shrink-0 flex-col border-r border-ink-200 bg-white">
      <div class="px-4 py-4">
        <p class="text-lg font-bold tracking-tight text-ink-800">Baremo</p>
        <p class="text-xs text-ink-500">Avaliação neuropsicológica</p>
      </div>

      <nav class="flex-1 px-2" aria-label="Navegação principal">
        <RouterLink
          v-for="item in NAV"
          :key="item.to"
          :to="item.to"
          class="mb-0.5 block rounded-md px-3 py-2 text-sm transition-colors"
          :class="
            isActive(item.to)
              ? 'bg-brand-50 font-semibold text-brand-700'
              : 'text-ink-600 hover:bg-ink-100'
          "
        >
          {{ item.label }}
          <span class="block text-xs font-normal text-ink-400">{{ item.hint }}</span>
        </RouterLink>
      </nav>

      <!-- ADR-001: estado do módulo sempre visível. -->
      <div class="border-t border-ink-200 px-4 py-3">
        <div class="flex items-center gap-2">
          <span
            class="h-2 w-2 rounded-full"
            :class="aiEnabled ? 'bg-warn-500' : 'bg-ink-300'"
            aria-hidden="true"
          />
          <p class="text-xs font-semibold text-ink-700">
            IA {{ aiEnabled ? 'ativa' : 'desligada' }}
          </p>
        </div>
        <p class="mt-1 text-xs leading-snug text-ink-500">
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
      <div
        v-if="showDiskNotice"
        class="border-b border-warn-200 bg-warn-50 px-6 py-3 text-sm text-warn-700"
      >
        <p class="font-semibold">Ative a criptografia de disco do seu sistema.</p>
        <p class="mt-1 leading-snug">
          O Baremo guarda o banco de dados e os arquivos anexados em claro no seu computador.
          A proteção desses dados depende do FileVault (macOS), BitLocker (Windows) ou LUKS (Linux).
          Backups e prontuários exportados herdam a mesma exposição.
        </p>
        <button
          class="mt-2 rounded border border-warn-500 px-2.5 py-1 text-xs font-medium text-warn-700 hover:bg-warn-200"
          @click="appStore.acknowledgeDiskNotice()"
        >
          Entendi
        </button>
      </div>

      <RouterView />
    </main>

    <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2">
      <div
        v-for="toast in appStore.toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-lg"
        :class="{
          'border-ink-200 bg-white text-ink-700': toast.kind === 'info',
          'border-ok-500 bg-ok-50 text-ink-800': toast.kind === 'success',
          'border-warn-500 bg-warn-50 text-warn-700': toast.kind === 'warning',
          'border-danger-500 bg-danger-50 text-danger-600': toast.kind === 'error'
        }"
        role="status"
      >
        <span class="flex-1 leading-snug">{{ toast.message }}</span>
        <button
          class="text-current opacity-60 hover:opacity-100"
          aria-label="Dispensar"
          @click="appStore.dismiss(toast.id)"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>
