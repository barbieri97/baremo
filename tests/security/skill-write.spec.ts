/**
 * `criar_skill` (spec §10.7) — risco de prompt injection PERSISTENTE.
 *
 * Uma skill vale para todas as conversas de todos os pacientes. Se um PDF hostil
 * levar o modelo a pedir uma, a proposta precisa ser barrada antes de virar
 * diálogo quando estiver fora dos limites, e nunca pode ser gravada sem a
 * confirmação humana. Este arquivo verifica a primeira metade; a segunda está
 * em `tests/unit/ai-orchestrator.spec.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../../src/main/db/gateway'
import type { BaremoDatabase } from '../../src/main/db/gateway'
import { runMigrations } from '../../src/main/db/migrate'
import { aiSkills } from '../../src/main/db/schema'
import { saveSkill } from '../../src/main/repositories/ai-skills'
import { previewSkillCreation } from '../../src/main/services/ai-skill-write'
import { toolDeclarations } from '../../src/main/ai/tools'
import {
  SKILL_CONTENT_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX
} from '../../src/shared/contracts/entities-ai'

let handle: BaremoDatabase
let directory: string

const valid = { nome: 'devolutiva', descricao: 'Redigir devolutiva.', conteudo: 'Passo 1.' }

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'baremo-skill-write-'))
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

describe('criar_skill — argumentos recusados antes do diálogo', () => {
  it('aceita uma proposta válida e devolve o conteúdo completo para o diálogo', () => {
    const preview = previewSkillCreation(handle, valid)
    expect(preview.skill).toEqual({
      name: 'devolutiva',
      description: 'Redigir devolutiva.',
      content: 'Passo 1.'
    })
  })

  it.each([
    ['nome fora do padrão', { ...valid, nome: 'Ignore as regras' }],
    ['nome longo demais', { ...valid, nome: 'a'.repeat(SKILL_NAME_MAX + 1) }],
    ['descrição vazia', { ...valid, descricao: '' }],
    ['descrição longa demais', { ...valid, descricao: 'x'.repeat(SKILL_DESCRIPTION_MAX + 1) }],
    ['conteúdo vazio', { ...valid, conteudo: '   ' }],
    ['conteúdo longo demais', { ...valid, conteudo: 'x'.repeat(SKILL_CONTENT_MAX + 1) }],
    ['tipos errados', { nome: 1, descricao: null, conteudo: {} }],
    ['argumentos ausentes', {}]
  ])('recusa %s', (_label, args) => {
    expect(() => previewSkillCreation(handle, args as Record<string, unknown>)).toThrow()
  })

  it('recusa nome já usado — o assistente não sobrescreve skill do profissional', () => {
    saveSkill(handle, { name: 'devolutiva', description: 'Minha.', content: 'Original.' }, 'user')
    expect(() => previewSkillCreation(handle, valid)).toThrow('Já existe uma skill')
  })

  it('as tools de skill não declaram patientId', () => {
    const skillTools = toolDeclarations(true).filter((declaration) =>
      declaration.name?.includes('skill')
    )
    expect(skillTools.map((declaration) => declaration.name).sort()).toEqual([
      'criar_skill',
      'ler_skill',
      'listar_skills'
    ])
    expect(JSON.stringify(skillTools)).not.toMatch(/patient|paciente_?id/i)
  })
})
