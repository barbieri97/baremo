/**
 * Tools de catálogo do assistente — criar, editar e excluir instrumentos e
 * funções cognitivas. O assistente propõe, o profissional decide.
 *
 * O catálogo é compartilhado por todos os pacientes: um PDF hostil que levasse o
 * modelo a apagar um instrumento afetaria todos os prontuários (§10.7). Por isso,
 * como em `criar_skill`:
 *
 * - os argumentos são revalidados do zero com os MESMOS schemas do formulário
 *   (`instrumentInputSchema`, `cognitiveFunctionInputSchema`);
 * - toda proposta inviável (ID inexistente, ciclo na árvore, exclusão barrada
 *   por resultados lançados) lança já no preview: o erro volta ao modelo e
 *   nenhum diálogo abre;
 * - a gravação só acontece depois da confirmação e fica na auditoria, marcada
 *   como vinda do assistente.
 */

import type { BaremoDatabase } from '../db/gateway'
import {
  cognitiveFunctionImpact,
  createCognitiveFunction,
  createInstrument,
  deleteCognitiveFunction,
  deleteInstrument,
  getCognitiveFunction,
  getInstrument,
  instrumentImpact,
  listCognitiveFunctions,
  listInstruments,
  updateCognitiveFunction,
  updateInstrument
} from '../repositories/trees'
import { recordAudit } from './audit'
import { REPARENT_ERROR_MESSAGES, validateReparent } from '@shared/domain/tree'
import {
  cognitiveFunctionInputSchema,
  idSchema,
  instrumentInputSchema
} from '@shared/contracts/entities'
import type {
  CognitiveFunction,
  CognitiveFunctionInput,
  Instrument,
  InstrumentInput
} from '@shared/contracts/entities'
import type { AiCatalogPreview } from '@shared/contracts/entities-ai'
import type { CatalogToolName } from '../ai/tools'

const AUDIT_SUFFIX = ' (proposto pelo assistente de IA e autorizado pelo profissional)'

// ─── Leitura dos argumentos ──────────────────────────────────────────────────

/** Campo ausente = "não mexer"; string vazia ou `null` = "limpar". */
function has(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key) && args[key] !== undefined
}

function textOrNull(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === '') return null
  return typeof value === 'number' ? value : Number.NaN
}

function requireId(args: Record<string, unknown>, key: string, label: string): string {
  const parsed = idSchema.safeParse(args[key])
  if (!parsed.success) {
    throw new Error(`${label} inválido: use um ID obtido pela busca, sem inventar.`)
  }
  return parsed.data
}

function reasons(issues: readonly { message: string }[]): string {
  return issues.map((issue) => issue.message).join(' ')
}

function parseInstrument(
  args: Record<string, unknown>,
  current: Instrument | null
): InstrumentInput {
  const base: InstrumentInput = current
    ? {
        parentId: current.parentId,
        name: current.name,
        acronym: current.acronym,
        cognitiveFunctionId: current.cognitiveFunctionId,
        minAgeYears: current.minAgeYears,
        maxAgeYears: current.maxAgeYears,
        reference: current.reference,
        order: current.order
      }
    : {
        parentId: null,
        name: '',
        acronym: null,
        cognitiveFunctionId: null,
        minAgeYears: null,
        maxAgeYears: null,
        reference: null,
        order: 0
      }

  const candidate = {
    ...base,
    ...(has(args, 'nome') ? { name: typeof args['nome'] === 'string' ? args['nome'] : '' } : {}),
    ...(has(args, 'sigla') ? { acronym: textOrNull(args['sigla']) } : {}),
    ...(has(args, 'instrumentoPaiId') ? { parentId: textOrNull(args['instrumentoPaiId']) } : {}),
    ...(has(args, 'funcaoCognitivaId')
      ? { cognitiveFunctionId: textOrNull(args['funcaoCognitivaId']) }
      : {}),
    ...(has(args, 'idadeMin') ? { minAgeYears: intOrNull(args['idadeMin']) } : {}),
    ...(has(args, 'idadeMax') ? { maxAgeYears: intOrNull(args['idadeMax']) } : {}),
    ...(has(args, 'referencia') ? { reference: textOrNull(args['referencia']) } : {})
  }

  const parsed = instrumentInputSchema.safeParse(candidate)
  if (!parsed.success) throw new Error(`Instrumento inválido: ${reasons(parsed.error.issues)}`)
  return parsed.data
}

function parseFunction(
  args: Record<string, unknown>,
  current: CognitiveFunction | null
): CognitiveFunctionInput {
  const base: CognitiveFunctionInput = current
    ? {
        parentId: current.parentId,
        name: current.name,
        description: current.description,
        order: current.order
      }
    : { parentId: null, name: '', description: null, order: 0 }

  const candidate = {
    ...base,
    ...(has(args, 'nome') ? { name: typeof args['nome'] === 'string' ? args['nome'] : '' } : {}),
    ...(has(args, 'descricao') ? { description: textOrNull(args['descricao']) } : {}),
    ...(has(args, 'funcaoPaiId') ? { parentId: textOrNull(args['funcaoPaiId']) } : {})
  }

  const parsed = cognitiveFunctionInputSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(`Função cognitiva inválida: ${reasons(parsed.error.issues)}`)
  }
  return parsed.data
}

// ─── Validação de vínculos (antes de abrir o diálogo) ────────────────────────

function assertTreePlacement(
  nodes: readonly { id: string; parentId: string | null; order: number; name: string }[],
  id: string | null,
  parentId: string | null,
  parentLabel: string
): void {
  if (parentId === null) return
  if (!nodes.some((node) => node.id === parentId)) {
    throw new Error(`${parentLabel} informado não existe no catálogo.`)
  }
  if (id !== null) {
    const error = validateReparent(nodes, id, parentId)
    if (error !== null) throw new Error(REPARENT_ERROR_MESSAGES[error])
  }
}

function assertFunctionExists(handle: BaremoDatabase, functionId: string | null): void {
  if (functionId === null) return
  if (!listCognitiveFunctions(handle).some((node) => node.id === functionId)) {
    throw new Error('A função cognitiva informada não existe no catálogo.')
  }
}

/** Erros do repositório (`HandlerError`) viram mensagem simples para o modelo. */
function existing<T>(read: () => T, message: string): T {
  try {
    return read()
  } catch {
    throw new Error(message)
  }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

const INSTRUMENT_LABELS: Record<keyof Omit<InstrumentInput, 'order'>, string> = {
  name: 'Nome',
  acronym: 'Sigla',
  parentId: 'Instrumento-pai',
  cognitiveFunctionId: 'Função cognitiva',
  minAgeYears: 'Idade mínima',
  maxAgeYears: 'Idade máxima',
  reference: 'Referência'
}

const FUNCTION_LABELS: Record<keyof Omit<CognitiveFunctionInput, 'order'>, string> = {
  name: 'Nome',
  description: 'Descrição',
  parentId: 'Função-pai'
}

type Fields = AiCatalogPreview['fields']

function fieldRows<T extends Record<string, unknown>>(
  labels: Record<string, string>,
  before: T | null,
  after: T,
  display: (key: string, value: unknown) => string | null
): Fields {
  return Object.entries(labels).flatMap(([key, field]) => {
    const next = display(key, after[key])
    const previous = before === null ? null : display(key, before[key])
    if (before === null && next === null) return []
    if (before !== null && previous === next) return []
    return [{ field, before: previous, after: next }]
  })
}

function instrumentDisplay(handle: BaremoDatabase): (key: string, value: unknown) => string | null {
  const instrumentNames = new Map(listInstruments(handle).map((node) => [node.id, node.name]))
  const functionNames = new Map(listCognitiveFunctions(handle).map((node) => [node.id, node.name]))
  return (key, value) => {
    if (value === null || value === undefined || value === '') return null
    if (key === 'parentId') return instrumentNames.get(String(value)) ?? String(value)
    if (key === 'cognitiveFunctionId') return functionNames.get(String(value)) ?? String(value)
    if (key === 'minAgeYears' || key === 'maxAgeYears') return `${String(value)} anos`
    return String(value)
  }
}

function functionDisplay(handle: BaremoDatabase): (key: string, value: unknown) => string | null {
  const names = new Map(listCognitiveFunctions(handle).map((node) => [node.id, node.name]))
  return (key, value) => {
    if (value === null || value === undefined || value === '') return null
    if (key === 'parentId') return names.get(String(value)) ?? String(value)
    return String(value)
  }
}

/** Lança quando a proposta é inviável; senão, devolve o que o diálogo mostra. */
export function previewCatalogWrite(
  handle: BaremoDatabase,
  toolName: CatalogToolName,
  args: Record<string, unknown>
): { description: string; catalogPreview: AiCatalogPreview } {
  switch (toolName) {
    case 'criar_instrumento': {
      const input = parseInstrument(args, null)
      assertTreePlacement(listInstruments(handle), null, input.parentId, 'O instrumento-pai')
      assertFunctionExists(handle, input.cognitiveFunctionId)
      return {
        description: `Cadastrar o instrumento "${input.name}" no catálogo. Ele ficará disponível para todos os pacientes.`,
        catalogPreview: {
          action: 'create',
          entity: 'instrument',
          label: input.name,
          fields: fieldRows(INSTRUMENT_LABELS, null, input, instrumentDisplay(handle)),
          impact: []
        }
      }
    }

    case 'editar_instrumento': {
      const id = requireId(args, 'instrumentoId', 'instrumentoId')
      const current = existing(
        () => getInstrument(handle, id),
        'Instrumento não encontrado no catálogo.'
      )
      const input = parseInstrument(args, current)
      assertTreePlacement(listInstruments(handle), id, input.parentId, 'O instrumento-pai')
      assertFunctionExists(handle, input.cognitiveFunctionId)
      const fields = fieldRows(INSTRUMENT_LABELS, current, input, instrumentDisplay(handle))
      if (fields.length === 0)
        throw new Error('Nenhum campo do instrumento mudaria com essa edição.')
      return {
        description: `Alterar ${fields.length} campo(s) do instrumento "${current.name}". A mudança vale para todos os pacientes.`,
        catalogPreview: {
          action: 'update',
          entity: 'instrument',
          label: current.name,
          fields,
          impact: []
        }
      }
    }

    case 'excluir_instrumento': {
      const id = requireId(args, 'instrumentoId', 'instrumentoId')
      const impact = existing(
        () => instrumentImpact(handle, id),
        'Instrumento não encontrado no catálogo.'
      )
      const blocking = impact.counts.find((count) => count.entity.startsWith('Resultados'))
      if (blocking !== undefined && blocking.count > 0) {
        throw new Error(
          `Exclusão impossível: "${impact.label}" (ou um de seus subtestes) tem ${blocking.count} resultado(s) lançado(s) em avaliações. Informe isso ao profissional; resultados não são apagados pelo assistente.`
        )
      }
      return {
        description: `Excluir definitivamente o instrumento "${impact.label}" do catálogo. Justificativa: ${String(args['justificativa'] ?? '')}`,
        catalogPreview: {
          action: 'delete',
          entity: 'instrument',
          label: impact.label,
          fields: [],
          impact: impact.counts.filter((count) => !count.entity.startsWith('Resultados'))
        }
      }
    }

    case 'criar_funcao_cognitiva': {
      const input = parseFunction(args, null)
      assertTreePlacement(listCognitiveFunctions(handle), null, input.parentId, 'A função-pai')
      return {
        description: `Cadastrar a função cognitiva "${input.name}" no catálogo.`,
        catalogPreview: {
          action: 'create',
          entity: 'cognitive_function',
          label: input.name,
          fields: fieldRows(FUNCTION_LABELS, null, input, functionDisplay(handle)),
          impact: []
        }
      }
    }

    case 'editar_funcao_cognitiva': {
      const id = requireId(args, 'funcaoId', 'funcaoId')
      const current = existing(
        () => getCognitiveFunction(handle, id),
        'Função cognitiva não encontrada no catálogo.'
      )
      const input = parseFunction(args, current)
      assertTreePlacement(listCognitiveFunctions(handle), id, input.parentId, 'A função-pai')
      const fields = fieldRows(FUNCTION_LABELS, current, input, functionDisplay(handle))
      if (fields.length === 0) throw new Error('Nenhum campo da função mudaria com essa edição.')
      return {
        description: `Alterar ${fields.length} campo(s) da função cognitiva "${current.name}".`,
        catalogPreview: {
          action: 'update',
          entity: 'cognitive_function',
          label: current.name,
          fields,
          impact: []
        }
      }
    }

    case 'excluir_funcao_cognitiva': {
      const id = requireId(args, 'funcaoId', 'funcaoId')
      const impact = existing(
        () => cognitiveFunctionImpact(handle, id),
        'Função cognitiva não encontrada no catálogo.'
      )
      return {
        description: `Excluir definitivamente a função cognitiva "${impact.label}" do catálogo. Justificativa: ${String(args['justificativa'] ?? '')}`,
        catalogPreview: {
          action: 'delete',
          entity: 'cognitive_function',
          label: impact.label,
          fields: [],
          impact: impact.counts
        }
      }
    }
  }
}

// ─── Gravação (só depois da confirmação) ─────────────────────────────────────

export function applyCatalogWrite(
  handle: BaremoDatabase,
  toolName: CatalogToolName,
  args: Record<string, unknown>
): string {
  // Revalida tudo: entre o diálogo e o clique, o catálogo pode ter mudado.
  previewCatalogWrite(handle, toolName, args)

  switch (toolName) {
    case 'criar_instrumento': {
      const created = createInstrument(handle, parseInstrument(args, null))
      recordAudit(handle, {
        entity: 'instrument',
        entityId: created.id,
        action: 'create',
        summary: `Instrumento "${created.name}" criado${AUDIT_SUFFIX}.`
      })
      return `Instrumento "${created.name}" cadastrado. instrumentoId: ${created.id}. Faixas de classificação ainda precisam ser configuradas no catálogo.`
    }

    case 'editar_instrumento': {
      const id = requireId(args, 'instrumentoId', 'instrumentoId')
      const updated = updateInstrument(handle, id, parseInstrument(args, getInstrument(handle, id)))
      recordAudit(handle, {
        entity: 'instrument',
        entityId: id,
        action: 'update',
        summary: `Instrumento "${updated.name}" editado${AUDIT_SUFFIX}.`
      })
      return `Instrumento "${updated.name}" atualizado.`
    }

    case 'excluir_instrumento': {
      const id = requireId(args, 'instrumentoId', 'instrumentoId')
      const impact = instrumentImpact(handle, id)
      deleteInstrument(handle, id)
      recordAudit(handle, {
        entity: 'instrument',
        entityId: id,
        action: 'delete',
        summary: `Instrumento "${impact.label}" excluído${AUDIT_SUFFIX}.`
      })
      return `Instrumento "${impact.label}" excluído do catálogo.`
    }

    case 'criar_funcao_cognitiva': {
      const created = createCognitiveFunction(handle, parseFunction(args, null))
      recordAudit(handle, {
        entity: 'cognitive_function',
        entityId: created.id,
        action: 'create',
        summary: `Função cognitiva "${created.name}" criada${AUDIT_SUFFIX}.`
      })
      return `Função cognitiva "${created.name}" cadastrada. funcaoId: ${created.id}.`
    }

    case 'editar_funcao_cognitiva': {
      const id = requireId(args, 'funcaoId', 'funcaoId')
      const updated = updateCognitiveFunction(
        handle,
        id,
        parseFunction(args, getCognitiveFunction(handle, id))
      )
      recordAudit(handle, {
        entity: 'cognitive_function',
        entityId: id,
        action: 'update',
        summary: `Função cognitiva "${updated.name}" editada${AUDIT_SUFFIX}.`
      })
      return `Função cognitiva "${updated.name}" atualizada.`
    }

    case 'excluir_funcao_cognitiva': {
      const id = requireId(args, 'funcaoId', 'funcaoId')
      const impact = cognitiveFunctionImpact(handle, id)
      deleteCognitiveFunction(handle, id)
      recordAudit(handle, {
        entity: 'cognitive_function',
        entityId: id,
        action: 'delete',
        summary: `Função cognitiva "${impact.label}" excluída${AUDIT_SUFFIX}.`
      })
      return `Função cognitiva "${impact.label}" excluída do catálogo.`
    }
  }
}
