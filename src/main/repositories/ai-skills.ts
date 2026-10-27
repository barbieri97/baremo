/**
 * Skills do assistente de IA — prompts reutilizáveis (nome, descrição, conteúdo).
 *
 * São GLOBAIS: não pertencem a um paciente e ficam fora do
 * `AgentReadRepository`. Por isso este repositório nunca toca tabela clínica, e
 * o orquestrador pode importá-lo sem furar a camada 2 do §10.5.
 */

import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { aiSkills } from '../db/schema'
import { aiSkillInputSchema } from '@shared/contracts/entities-ai'
import type { AiSkill, AiSkillInput, AiSkillOrigin } from '@shared/contracts/entities-ai'
import { nowIso } from './helpers'

type Row = typeof aiSkills.$inferSelect

/** Nome já usado por outra skill — erro legível, não a constraint do SQLite. */
export class SkillNameTakenError extends Error {
  constructor(name: string) {
    super(`Já existe uma skill chamada "/${name}".`)
    this.name = 'SkillNameTakenError'
  }
}

export class SkillNotFoundError extends Error {
  constructor(message = 'Skill não encontrada.') {
    super(message)
    this.name = 'SkillNotFoundError'
  }
}

function toSkill(row: Row): AiSkill {
  return {
    ...row,
    origin: row.origin === 'agent' ? 'agent' : 'user'
  }
}

function readById(handle: BaremoDatabase, id: string): Row {
  const row = handle.db.select().from(aiSkills).where(eq(aiSkills.id, id)).get()
  if (!row) throw new SkillNotFoundError()
  return row
}

export function listSkills(handle: BaremoDatabase): AiSkill[] {
  return handle.db.select().from(aiSkills).orderBy(asc(aiSkills.name)).all().map(toSkill)
}

export function listEnabledSkills(handle: BaremoDatabase): AiSkill[] {
  return handle.db
    .select()
    .from(aiSkills)
    .where(eq(aiSkills.enabled, true))
    .orderBy(asc(aiSkills.name))
    .all()
    .map(toSkill)
}

export function getSkillByName(
  handle: BaremoDatabase,
  name: string,
  options: { enabledOnly: boolean }
): AiSkill | null {
  const row = handle.db.select().from(aiSkills).where(eq(aiSkills.name, name)).get()
  if (!row || (options.enabledOnly && !row.enabled)) return null
  return toSkill(row)
}

/** `true` quando o nome está livre (ignorando a própria skill, na edição). */
export function skillNameAvailable(
  handle: BaremoDatabase,
  name: string,
  exceptId: string | null = null
): boolean {
  const row = handle.db.select().from(aiSkills).where(eq(aiSkills.name, name)).get()
  return !row || row.id === exceptId
}

/**
 * Cria (sem `id`) ou atualiza (com `id`). Na atualização, a origem gravada é
 * preservada: editar uma skill do assistente não apaga o selo de quem a criou.
 */
export function saveSkill(
  handle: BaremoDatabase,
  input: AiSkillInput & { id?: string | undefined },
  origin: AiSkillOrigin
): AiSkill {
  const data = aiSkillInputSchema.parse(input)
  const id = input.id ?? null

  if (!skillNameAvailable(handle, data.name, id)) throw new SkillNameTakenError(data.name)

  const timestamp = nowIso()

  if (id === null) {
    const newId = randomUUID()
    handle.db
      .insert(aiSkills)
      .values({
        id: newId,
        ...data,
        enabled: true,
        origin,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run()
    return toSkill(readById(handle, newId))
  }

  readById(handle, id)
  handle.db
    .update(aiSkills)
    .set({ ...data, updatedAt: timestamp })
    .where(eq(aiSkills.id, id))
    .run()
  return toSkill(readById(handle, id))
}

export function deleteSkill(handle: BaremoDatabase, id: string): void {
  const result = handle.db.delete(aiSkills).where(eq(aiSkills.id, id)).run()
  if (result.changes === 0) throw new SkillNotFoundError()
}

export function setSkillEnabled(handle: BaremoDatabase, id: string, enabled: boolean): AiSkill {
  readById(handle, id)
  handle.db.update(aiSkills).set({ enabled, updatedAt: nowIso() }).where(eq(aiSkills.id, id)).run()
  return toSkill(readById(handle, id))
}
