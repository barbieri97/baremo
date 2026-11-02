/**
 * Registro dos provedores de modelo. Hoje só o Gemini; um provedor novo entra
 * aqui e ganha o seu adaptador ao lado de `gemini.ts`.
 */

import { geminiProvider } from './gemini'
import type { AiProvider } from './types'

export const PROVIDERS: Readonly<Record<string, AiProvider>> = {
  [geminiProvider.id]: geminiProvider
}

export const DEFAULT_PROVIDER = geminiProvider

export function resolveProvider(id: string | null | undefined): AiProvider {
  return (id === null || id === undefined ? undefined : PROVIDERS[id]) ?? DEFAULT_PROVIDER
}

export type * from './types'
