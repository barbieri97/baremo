/**
 * Registro dos provedores de modelo. Um provedor novo entra aqui, com o seu
 * adaptador ao lado, e o seu ID em `AI_PROVIDERS` (contratos compartilhados).
 */

import type { AiProviderId } from '@shared/contracts/entities-ai'
import { anthropicProvider } from './anthropic'
import { geminiProvider } from './gemini'
import { openaiProvider } from './openai'
import type { AiProvider } from './types'

export const PROVIDERS: Readonly<Record<AiProviderId, AiProvider>> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider
}

export const DEFAULT_PROVIDER = geminiProvider

export function resolveProvider(id: AiProviderId): AiProvider {
  return PROVIDERS[id]
}

export type * from './types'
