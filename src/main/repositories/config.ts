/**
 * Perfil profissional, paleta de cores e preferências soltas (spec §4.1, §5).
 */

import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import {
  appSettings,
  classificationRanges,
  colors,
  professionalProfile,
  SINGLETON_ID
} from '../db/schema'
import type { Color, ProfessionalProfile } from '@shared/contracts/entities'
import { conflict, notFound } from '../ipc/register'
import { normalizeHex } from '@shared/domain/color'
import { normalizeLogo } from '../images/logo'

// ─── Perfil ──────────────────────────────────────────────────────────────────

export function getProfile(handle: BaremoDatabase): ProfessionalProfile {
  const row = handle.db
    .select()
    .from(professionalProfile)
    .where(eq(professionalProfile.id, SINGLETON_ID))
    .get()

  // O seed cria a linha; se ela sumiu, um perfil vazio é melhor que uma tela morta.
  return {
    name: row?.name ?? '',
    crp: row?.crp ?? '',
    specialty: row?.specialty ?? '',
    phone: row?.phone ?? '',
    email: row?.email ?? '',
    address: row?.address ?? '',
    logoDataUrl: row?.logoDataUrl ?? null
  }
}

export function saveProfile(
  handle: BaremoDatabase,
  input: ProfessionalProfile
): ProfessionalProfile {
  // A logo é reduzida à caixa de impressão ANTES de virar linha no banco: o
  // renderer já reduz, mas quem grava é quem tem de garantir. Sem isto, um
  // perfil salvo por outro caminho carregaria megabytes de base64 para dentro
  // de cada PDF gerado.
  const values = { ...input, logoDataUrl: normalizeLogo(input.logoDataUrl) }

  handle.db
    .insert(professionalProfile)
    .values({ id: SINGLETON_ID, ...values })
    .onConflictDoUpdate({ target: professionalProfile.id, set: values })
    .run()

  return getProfile(handle)
}

// ─── Cores ───────────────────────────────────────────────────────────────────

export function listColors(handle: BaremoDatabase): Color[] {
  return handle.db.select().from(colors).orderBy(asc(colors.order), asc(colors.name)).all()
}

export function saveColor(
  handle: BaremoDatabase,
  input: { id: string | null; name: string; hex: string }
): Color {
  const hex = normalizeHex(input.hex)
  if (hex === null) throw conflict('Cor inválida. Use o formato #RRGGBB.')

  if (input.id === null) {
    const maxOrder = handle.db
      .select({ value: sql<number>`coalesce(max("order"), -1)` })
      .from(colors)
      .get()

    const id = randomUUID()
    handle.db
      .insert(colors)
      .values({ id, name: input.name, hex, order: (maxOrder?.value ?? -1) + 1, isSeed: false })
      .run()

    return requireColor(handle, id)
  }

  const updated = handle.db
    .update(colors)
    .set({ name: input.name, hex })
    .where(eq(colors.id, input.id))
    .run()

  if (updated.changes === 0) throw notFound('Cor não encontrada.')
  return requireColor(handle, input.id)
}

/** Quantas faixas de classificação usam esta cor — alimenta o modal de impacto (§6.3). */
export function countRangesUsingColor(handle: BaremoDatabase, colorId: string): number {
  const row = handle.db
    .select({ total: sql<number>`count(*)` })
    .from(classificationRanges)
    .where(eq(classificationRanges.colorId, colorId))
    .get()
  return row?.total ?? 0
}

export function deleteColor(handle: BaremoDatabase, id: string): void {
  const inUse = countRangesUsingColor(handle, id)
  if (inUse > 0) {
    throw conflict(
      `Esta cor está em uso por ${inUse} faixa(s) de classificação. Troque a cor dessas faixas antes de excluí-la.`
    )
  }

  const result = handle.db.delete(colors).where(eq(colors.id, id)).run()
  if (result.changes === 0) throw notFound('Cor não encontrada.')
}

export function reorderColors(handle: BaremoDatabase, orderedIds: readonly string[]): void {
  const apply = handle.raw.transaction(() => {
    orderedIds.forEach((id, index) => {
      handle.db.update(colors).set({ order: index }).where(eq(colors.id, id)).run()
    })
  })
  apply()
}

function requireColor(handle: BaremoDatabase, id: string): Color {
  const row = handle.db.select().from(colors).where(eq(colors.id, id)).get()
  if (!row) throw notFound('Cor não encontrada.')
  return row
}

// ─── Preferências ────────────────────────────────────────────────────────────

export function getSetting(handle: BaremoDatabase, key: string): string | null {
  const row = handle.db.select().from(appSettings).where(eq(appSettings.key, key)).get()
  return row?.value ?? null
}

export function setSetting(handle: BaremoDatabase, key: string, value: string): void {
  handle.db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run()
}

export const SETTING_DISK_NOTICE = 'diskEncryptionNoticeAcknowledged'
