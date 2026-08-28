/**
 * Estado global do aplicativo.
 *
 * Carrega o estado do processo principal (versão, caminhos, se o módulo de IA
 * está ligado) e mantém a fila de avisos. O indicador permanente do estado da IA
 * (ADR-001) lê daqui.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api, errorMessage } from '../api'
import type { ChannelOutput } from '@shared/contracts'

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

  async function load(): Promise<void> {
    loading.value = true
    try {
      state.value = await api('config:getAppState')
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

  return { state, toasts, loading, load, refresh, acknowledgeDiskNotice, notify, notifyError, dismiss }
})
