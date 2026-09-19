/**
 * Estado global do aplicativo.
 *
 * Carrega o estado do processo principal (versão, caminhos, se o módulo de IA
 * está ligado, a atualização automática) e mantém a fila de avisos. O indicador
 * permanente do estado da IA (ADR-001) e o aviso de nova versão leem daqui.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, errorMessage, onUpdateStatus } from '../api'
import type { ChannelOutput } from '@shared/contracts'
import type { UpdateStatus } from '@shared/contracts/updates'

type AppState = ChannelOutput<'config:getAppState'>

export interface Toast {
  readonly id: number
  readonly kind: 'info' | 'success' | 'warning' | 'error'
  readonly message: string
}

let nextToastId = 1

export const useAppStore = defineStore('app', () => {
  const state = ref<AppState | null>(null)
  const toasts = ref<Toast[]>([])
  const loading = ref(false)
  const updateStatus = ref<UpdateStatus>({ kind: 'idle' })
  let listeningToUpdates = false

  async function load(): Promise<void> {
    loading.value = true
    try {
      // Assina antes de perguntar: uma mudança entre as duas coisas não se perde.
      if (!listeningToUpdates) {
        onUpdateStatus((status) => {
          updateStatus.value = status
        })
        listeningToUpdates = true
      }
      state.value = await api('config:getAppState')
      updateStatus.value = await api('updates:getStatus')
    } finally {
      loading.value = false
    }
  }

  /** Recarrega só o que muda com frequência — hoje, o estado do módulo de IA. */
  async function refresh(): Promise<void> {
    state.value = await api('config:getAppState')
  }

  async function acknowledgeDiskNotice(): Promise<void> {
    await api('config:acknowledgeDiskNotice')
    await refresh()
  }

  async function checkForUpdates(): Promise<void> {
    updateStatus.value = await api('updates:check')
  }

  /** O app fecha e reabre já na nova versão. */
  async function installUpdate(): Promise<void> {
    await api('updates:install')
  }

  function notify(kind: Toast['kind'], message: string): void {
    const toast: Toast = { id: nextToastId++, kind, message }
    toasts.value = [...toasts.value, toast]

    // Erro fica até o usuário dispensar: uma mensagem de falha que some sozinha
    // costuma sumir antes de ser lida.
    if (kind !== 'error') {
      setTimeout(() => dismiss(toast.id), 4000)
    }
  }

  function notifyError(error: unknown): void {
    notify('error', errorMessage(error))
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  return {
    state,
    toasts,
    loading,
    updateStatus,
    load,
    refresh,
    acknowledgeDiskNotice,
    checkForUpdates,
    installUpdate,
    notify,
    notifyError,
    dismiss
  }
})
