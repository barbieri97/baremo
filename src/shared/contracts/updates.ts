/**
 * Estado da atualização automática (spec §15.3).
 *
 * O processo principal é a fonte do estado: o download pode terminar antes de a
 * janela montar, então a UI pede o estado atual ao iniciar e depois acompanha as
 * mudanças pelo canal de mão única `UPDATE_STATUS_CHANNEL`.
 */

import { z } from 'zod'

export const updateStatusSchema = z.discriminatedUnion('kind', [
  /** Em desenvolvimento não há release publicada para comparar. */
  z.object({ kind: z.literal('unsupported') }),
  z.object({ kind: z.literal('idle') }),
  z.object({ kind: z.literal('checking') }),
  z.object({ kind: z.literal('downloading'), version: z.string(), percent: z.number() }),
  z.object({ kind: z.literal('up-to-date') }),
  z.object({ kind: z.literal('downloaded'), version: z.string() }),
  z.object({ kind: z.literal('error'), message: z.string() })
])

export type UpdateStatus = z.infer<typeof updateStatusSchema>

/** Canal de mão única main → renderer com cada mudança de estado. */
export const UPDATE_STATUS_CHANNEL = 'updates:status'
