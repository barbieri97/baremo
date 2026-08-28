/**
 * Ponte renderer ↔ main (spec §12, §13.1).
 *
 * O renderer roda com `contextIsolation`, `sandbox` e sem integração com Node.
 * Tudo o que ele pode fazer está neste arquivo — e a superfície é deliberadamente
 * pequena: uma lista fechada de canais, o assinante do streaming da IA, e o
 * `getPathForFile` do drag-and-drop.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { AI_STREAM_CHANNEL, CHANNEL_NAMES } from '@shared/contracts'
import type { ChannelName, IpcResult } from '@shared/contracts'
import type { AiStreamEvent } from '@shared/contracts/entities-ai'

/**
 * Allowlist fechada. Um `invoke` genérico deixaria o renderer chamar qualquer
 * canal registrado no processo — inclusive os internos do Electron.
 */
const ALLOWED = new Set<string>(CHANNEL_NAMES)

const api = {
  invoke<C extends ChannelName>(channel: C, payload: unknown): Promise<IpcResult<unknown>> {
    if (!ALLOWED.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'forbidden' as const, message: `Canal não permitido: ${channel}` }
      })
    }
    return ipcRenderer.invoke(channel, payload)
  },

  /** Streaming da IA, multiplexado por `requestId` no consumidor (§10.4). */
  onAiStream(listener: (event: AiStreamEvent) => void): () => void {
    const handler = (_event: unknown, payload: AiStreamEvent): void => listener(payload)
    ipcRenderer.on(AI_STREAM_CHANNEL, handler)
    return () => {
      ipcRenderer.off(AI_STREAM_CHANNEL, handler)
    }
  },

  /**
   * Caminho real de um arquivo arrastado para a janela.
   *
   * `File.path` não existe mais no Electron (§8.4). Este é o único ponto do app
   * em que um caminho de filesystem passa pelo renderer — e ele segue direto
   * para `attachments:addFromPaths`, que valida e copia no processo principal.
   * Depois disso, o renderer só trafega IDs.
   */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  }
}

export type BaremoBridge = typeof api

contextBridge.exposeInMainWorld('baremo', api)
