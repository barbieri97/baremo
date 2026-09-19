/**
 * Histórico das tools usadas pelo assistente em cada turno da conversa.
 *
 * Fica em `shared` e sem Vue para ser testável em node: a tela só decide onde
 * desenhar o accordion, e a regra de qual chamada pertence a qual pergunta mora
 * aqui.
 */

import type { AiMessage, AiToolCall } from '../contracts/entities-ai'

/** Rótulo legível de cada tool, no gerúndio de quem está fazendo. */
export const TOOL_LABELS: Readonly<Record<string, string>> = {
  obter_perfil_paciente: 'Consultando o perfil do paciente',
  listar_avaliacoes: 'Listando avaliações',
  obter_avaliacao: 'Consultando avaliação',
  listar_resultados: 'Listando resultados',
  comparar_avaliacoes: 'Comparando avaliações',
  listar_documentos: 'Listando documentos',
  ler_documento: 'Lendo documento',
  listar_arquivos: 'Listando arquivos anexados',
  ler_arquivo: 'Lendo arquivo',
  obter_faixas_classificacao: 'Consultando faixas de classificação',
  listar_instrumentos_utilizados: 'Listando instrumentos utilizados',
  buscar_instrumentos: 'Buscando instrumentos no catálogo',
  criar_rascunho_documento: 'Criando rascunho de documento',
  sugerir_edicao_documento: 'Sugerindo edição de documento',
  registrar_resultados: 'Registrando resultados'
}

export function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName
}

/**
 * Agrupa as chamadas pela mensagem do usuário que abriu o turno.
 *
 * O vínculo gravado (`messageId`) vale quando aponta para uma mensagem da
 * conversa. Chamadas antigas, gravadas antes desse vínculo existir, caem na
 * última mensagem do usuário anterior a elas — a ordem cronológica é a mesma
 * em que o turno aconteceu.
 */
export function groupToolCallsByMessage(
  messages: readonly Pick<AiMessage, 'id' | 'role' | 'createdAt'>[],
  calls: readonly AiToolCall[]
): Map<string, AiToolCall[]> {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const userIds = new Set(userMessages.map((message) => message.id))

  const groups = new Map<string, AiToolCall[]>()
  const ordered = calls.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const call of ordered) {
    let owner: string | null = null

    if (call.messageId !== null && userIds.has(call.messageId)) {
      owner = call.messageId
    } else {
      for (const message of userMessages) {
        if (message.createdAt <= call.createdAt) owner = message.id
        else break
      }
    }

    if (owner === null) continue
    const group = groups.get(owner) ?? []
    group.push(call)
    groups.set(owner, group)
  }

  return groups
}
