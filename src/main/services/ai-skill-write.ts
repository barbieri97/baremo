/**
 * `criar_skill` — o assistente propõe uma skill nova, o profissional decide.
 *
 * Uma skill vale para TODAS as conversas de todos os pacientes: se um PDF hostil
 * levasse o modelo a pedir uma, a contaminação seria persistente (§10.7). Por
 * isso os argumentos são revalidados do zero com o mesmo schema das
 * configurações, a proposta inválida volta ao modelo sem abrir diálogo, e a
 * gravação só acontece depois da confirmação, marcada com `origin = 'agent'`.
 */

import type { BaremoDatabase } from '../db/gateway'
import { saveSkill, skillNameAvailable, SkillNameTakenError } from '../repositories/ai-skills'
import { aiSkillInputSchema } from '@shared/contracts/entities-ai'
import type { AiSkillInput } from '@shared/contracts/entities-ai'

/** Os argumentos da tool chegam em português; o schema fala a língua do banco. */
function parseArgs(args: Record<string, unknown>): AiSkillInput {
  const parsed = aiSkillInputSchema.safeParse({
    name: args['nome'],
    description: args['descricao'],
    content: args['conteudo']
  })

  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join(' ')
    throw new Error(`Skill inválida: ${reasons}`)
  }

  return parsed.data
}

/** Lança quando a proposta é inviável; senão, devolve o que o diálogo mostra. */
export function previewSkillCreation(
  handle: BaremoDatabase,
  args: Record<string, unknown>
): { description: string; skill: AiSkillInput } {
  const skill = parseArgs(args)

  if (!skillNameAvailable(handle, skill.name)) throw new SkillNameTakenError(skill.name)

  return {
    description: `Criar a skill "/${skill.name}" — ${skill.description}. Ela ficará disponível em todas as conversas, de todos os pacientes.`,
    skill
  }
}

export function applySkillCreation(handle: BaremoDatabase, args: Record<string, unknown>): string {
  const skill = saveSkill(handle, parseArgs(args), 'agent')
  return `Skill "/${skill.name}" criada. O profissional pode editá-la ou desativá-la em Configurações → Assistente de IA.`
}
