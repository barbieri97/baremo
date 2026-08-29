/**
 * Cliente tipado do IPC.
 *
 * O preload expõe um `invoke` genérico com allowlist; aqui ele ganha os tipos do
 * contrato, o payload é posto em forma clonável e o envelope é desembrulhado. O
 * resto do renderer chama `api('patients:list', { … })` e recebe o dado ou uma
 * exceção — sem `if (ok)` espalhado por cada componente.
 */

import type { ChannelInput, ChannelName, ChannelOutput, IpcError, IpcResult } from '@shared/contracts'
import type { AiStreamEvent } from '@shared/contracts/entities-ai'
import { toCloneablePayload } from '@shared/ipc-payload'

declare global {
  interface Window {
    baremo: {
      invoke(channel: string, payload: unknown): Promise<IpcResult<unknown>>
      onAiStream(listener: (event: AiStreamEvent) => void): () => void
      getPathForFile(file: File): string
    }
  }
}

/** Erro vindo do processo principal, já com o código do contrato. */
export class BaremoError extends Error {
  constructor(
    readonly code: IpcError['code'],
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'BaremoError'
  }
}

export async function api<C extends ChannelName>(
  channel: C,
  ...[payload]: ChannelInput<C> extends void ? [] : [ChannelInput<C>]
): Promise<ChannelOutput<C>> {
  const result = await window.baremo.invoke(channel, toCloneablePayload(payload))

  if (!result.ok) {
    throw new BaremoError(result.error.code, result.error.message, result.error.details)
  }

  return result.data as ChannelOutput<C>
}

/**
 * Variante que devolve `null` no lugar de lançar.
 *
 * Útil onde a ausência é um estado esperado da tela — abrir um paciente que
 * acabou de ser excluído em outra aba, por exemplo — e não um erro a reportar.
 */
export async function apiOrNull<C extends ChannelName>(
  channel: C,
  ...[payload]: ChannelInput<C> extends void ? [] : [ChannelInput<C>]
): Promise<ChannelOutput<C> | null> {
  try {
    return await api(channel, ...([payload] as never))
  } catch (error) {
    if (error instanceof BaremoError && error.code === 'not_found') return null
    throw error
  }
}

export function onAiStream(listener: (event: AiStreamEvent) => void): () => void {
  return window.baremo.onAiStream(listener)
}

export function pathForFile(file: File): string {
  return window.baremo.getPathForFile(file)
}

export function errorMessage(error: unknown): string {
  if (error instanceof BaremoError) return error.message
  if (error instanceof Error) return error.message
  return 'Ocorreu um erro inesperado.'
}

/** Problemas por campo, quando o erro veio da validação Zod na fronteira IPC. */
export function fieldIssues(error: unknown): { path: string; message: string }[] {
  if (!(error instanceof BaremoError) || error.code !== 'validation') return []
  return Array.isArray(error.details) ? (error.details as { path: string; message: string }[]) : []
}
