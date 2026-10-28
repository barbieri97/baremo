/**
 * Repositório de skills do assistente: CRUD e os limites que valem tanto para as
 * configurações quanto para a tool `criar_skill`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { aiSkills } from '../../src/main/db/schema'
import {
  deleteSkill,
  getSkillByName,
  listEnabledSkills,
  listSkills,
  saveSkill,
  setSkillEnabled,
  SkillNameTakenError,
  SkillNotFoundError
} from '../../src/main/repositories/ai-skills'
import {
  SKILL_CONTENT_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX
} from '../../src/shared/contracts/entities-ai'

let handle: BaremoDatabase
let directory: string

const base = { name: 'devolutiva', description: 'Redigir devolutiva.', content: 'Passo 1.' }

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-skills-'))
  handle = openDatabase(join(directory, 'test.db'))
  runMigrations(handle)
})

beforeEach(() => {
  handle.db.delete(aiSkills).run()
})

afterAll(() => {
  handle.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('repositório de skills', () => {
  it('cria, lista, edita e exclui', () => {
    const created = saveSkill(handle, base, 'user')
    expect(created).toMatchObject({ ...base, enabled: true, origin: 'user' })
    expect(listSkills(handle)).toHaveLength(1)

    const updated = saveSkill(
      handle,
      { id: created.id, ...base, description: 'Outra descrição.' },
      'user'
    )
    expect(updated.description).toBe('Outra descrição.')
    expect(updated.id).toBe(created.id)

    deleteSkill(handle, created.id)
    expect(listSkills(handle)).toHaveLength(0)
    expect(() => deleteSkill(handle, created.id)).toThrow(SkillNotFoundError)
  })

  it('preserva a origem do assistente ao editar', () => {
    const created = saveSkill(handle, base, 'agent')
    const updated = saveSkill(handle, { id: created.id, ...base, content: 'Novo.' }, 'user')
    expect(updated.origin).toBe('agent')
  })

  it('recusa nome duplicado com erro legível', () => {
    saveSkill(handle, base, 'user')
    expect(() => saveSkill(handle, base, 'user')).toThrow(SkillNameTakenError)
    expect(() => saveSkill(handle, base, 'user')).toThrow(
      'Já existe uma skill chamada "/devolutiva".'
    )
  })

  it('aceita renomear para o próprio nome na edição', () => {
    const created = saveSkill(handle, base, 'user')
    expect(() => saveSkill(handle, { id: created.id, ...base }, 'user')).not.toThrow()
  })

  it.each([
    ['com espaço', 'minha skill'],
    ['com maiúscula', 'Devolutiva'],
    ['com acento', 'devolução'],
    ['com hífen no fim', 'devolutiva-'],
    ['com hífen duplo', 'a--b'],
    ['com barra', '/devolutiva'],
    ['longo demais', 'a'.repeat(SKILL_NAME_MAX + 1)]
  ])('recusa nome %s', (_label, name) => {
    expect(() => saveSkill(handle, { ...base, name }, 'user')).toThrow()
  })

  it('aplica os limites de tamanho', () => {
    expect(() =>
      saveSkill(handle, { ...base, description: 'x'.repeat(SKILL_DESCRIPTION_MAX + 1) }, 'user')
    ).toThrow()
    expect(() =>
      saveSkill(handle, { ...base, content: 'x'.repeat(SKILL_CONTENT_MAX + 1) }, 'user')
    ).toThrow()
    expect(() => saveSkill(handle, { ...base, description: '  ' }, 'user')).toThrow()
    expect(() => saveSkill(handle, { ...base, content: '' }, 'user')).toThrow()
    expect(() =>
      saveSkill(handle, { ...base, content: 'x'.repeat(SKILL_CONTENT_MAX) }, 'user')
    ).not.toThrow()
  })

  it('desativada some da lista de ativas e da leitura com enabledOnly', () => {
    const created = saveSkill(handle, base, 'user')
    saveSkill(handle, { ...base, name: 'outra' }, 'user')

    setSkillEnabled(handle, created.id, false)

    expect(listEnabledSkills(handle).map((skill) => skill.name)).toEqual(['outra'])
    expect(getSkillByName(handle, 'devolutiva', { enabledOnly: true })).toBeNull()
    expect(getSkillByName(handle, 'devolutiva', { enabledOnly: false })?.enabled).toBe(false)

    setSkillEnabled(handle, created.id, true)
    expect(listEnabledSkills(handle)).toHaveLength(2)
  })
})
