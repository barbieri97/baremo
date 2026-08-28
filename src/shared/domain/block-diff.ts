/**
 * Diff por bloco entre duas versões de um documento (spec §10.6, fase 6).
 *
 * Quando o assistente propõe uma edição, o profissional aceita ou rejeita
 * **por bloco**, e não o texto inteiro de uma vez. A granularidade importa: uma
 * proposta costuma acertar a redação de três parágrafos e errar o quarto, e um
 * "aceitar tudo ou nada" empurra o profissional a aceitar o que não revisou.
 *
 * O algoritmo é o LCS clássico sobre os blocos de primeiro nível, comparados
 * pelo texto normalizado. É proposital que ele NÃO desça dentro do bloco: um
 * diff por palavra dá diferença bonita e decisão ruim — a unidade que o
 * profissional revisa e assina é o parágrafo.
 *
 * Função pura, sem I/O: roda igual no processo principal e no renderer.
 */

export type BlockChangeKind = 'keep' | 'insert' | 'delete' | 'replace'

export interface BlockChange {
  /** Índice estável, usado para o usuário escolher o que aceitar. */
  readonly index: number
  readonly kind: BlockChangeKind
  /** Texto do bloco atual; `null` quando o bloco está sendo inserido. */
  readonly before: string | null
  /** Texto proposto; `null` quando o bloco está sendo removido. */
  readonly after: string | null
  /** Bloco do documento proposto, para aplicar a aceitação sem reprocessar. */
  readonly afterNode: unknown | null
  /** Bloco do documento atual, para preservar quando a mudança é rejeitada. */
  readonly beforeNode: unknown | null
}

interface DocLike {
  type?: string
  content?: unknown[]
}

function blocksOf(doc: unknown): unknown[] {
  if (typeof doc !== 'object' || doc === null) return []
  const typed = doc as DocLike
  return Array.isArray(typed.content) ? typed.content : []
}

/** Texto plano de um bloco, para comparação e para exibição no diff. */
export function blockText(node: unknown): string {
  const parts: string[] = []

  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return
    const typed = value as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }

    if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text)
    if (typed.type === 'variable' && typeof typed.attrs?.['token'] === 'string') {
      parts.push(`{{${String(typed.attrs['token'])}}}`)
    }
    // Nós atômicos do produto não têm texto, mas precisam aparecer no diff como
    // algo — senão o usuário vê um bloco vazio e não sabe o que está aceitando.
    if (typed.type === 'resultsBlock') parts.push('[tabela de resultados]')
    if (typed.type === 'chartBlock') parts.push('[gráfico de perfil]')
    if (typed.type === 'signature') parts.push('[bloco de assinatura]')
    if (typed.type === 'pageBreak') parts.push('[quebra de página]')

    for (const child of typed.content ?? []) walk(child)
  }

  walk(node)
  return parts.join('')
}

/** Normaliza para comparação: espaços colapsados, sem acento de caixa. */
function comparable(node: unknown): string {
  return blockText(node).replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')
}

/**
 * Compara os blocos de primeiro nível de dois documentos.
 *
 * Blocos idênticos viram `keep`; um par desalinhado que ocupa a mesma posição
 * relativa vira `replace` — mais legível que um `delete` seguido de `insert`
 * dizendo a mesma coisa.
 */
export function diffBlocks(current: unknown, proposed: unknown): BlockChange[] {
  const before = blocksOf(current)
  const after = blocksOf(proposed)

  const beforeKeys = before.map(comparable)
  const afterKeys = after.map(comparable)

  // Tabela de LCS.
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0)
  )

  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        beforeKeys[i] === afterKeys[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }

  const raw: Omit<BlockChange, 'index'>[] = []
  let i = 0
  let j = 0

  while (i < before.length && j < after.length) {
    if (beforeKeys[i] === afterKeys[j]) {
      raw.push({
        kind: 'keep',
        before: blockText(before[i]),
        after: blockText(after[j]),
        beforeNode: before[i] ?? null,
        afterNode: after[j] ?? null
      })
      i++
      j++
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      raw.push({
        kind: 'delete',
        before: blockText(before[i]),
        after: null,
        beforeNode: before[i] ?? null,
        afterNode: null
      })
      i++
    } else {
      raw.push({
        kind: 'insert',
        before: null,
        after: blockText(after[j]),
        beforeNode: null,
        afterNode: after[j] ?? null
      })
      j++
    }
  }

  while (i < before.length) {
    raw.push({
      kind: 'delete',
      before: blockText(before[i]),
      after: null,
      beforeNode: before[i] ?? null,
      afterNode: null
    })
    i++
  }

  while (j < after.length) {
    raw.push({
      kind: 'insert',
      before: null,
      after: blockText(after[j]),
      beforeNode: null,
      afterNode: after[j] ?? null
    })
    j++
  }

  return collapseReplacements(raw).map((change, index) => ({ ...change, index }))
}

/**
 * Casa uma sequência de remoções com a de inserções que vem logo depois,
 * transformando os pares em `replace`.
 *
 * O LCS produz "removeu A, removeu B, inseriu C, inseriu D" quando dois
 * parágrafos foram reescritos — tecnicamente correto e péssimo de ler. Parear
 * posicionalmente dentro da execução (A→C, B→D) reproduz o alinhamento que uma
 * pessoa faz ao comparar as duas versões lado a lado, e é a diferença entre um
 * diff que ajuda a decidir e um que só informa.
 *
 * O excedente da execução mais longa continua como remoção ou inserção pura.
 */
function collapseReplacements(
  changes: readonly Omit<BlockChange, 'index'>[]
): Omit<BlockChange, 'index'>[] {
  const out: Omit<BlockChange, 'index'>[] = []
  let cursor = 0

  while (cursor < changes.length) {
    const current = changes[cursor]!

    if (current.kind !== 'delete') {
      out.push(current)
      cursor++
      continue
    }

    // Coleta a execução de remoções e a de inserções imediatamente seguinte.
    const deletions: Omit<BlockChange, 'index'>[] = []
    while (changes[cursor]?.kind === 'delete') {
      deletions.push(changes[cursor]!)
      cursor++
    }

    const insertions: Omit<BlockChange, 'index'>[] = []
    while (changes[cursor]?.kind === 'insert') {
      insertions.push(changes[cursor]!)
      cursor++
    }

    const paired = Math.min(deletions.length, insertions.length)

    for (let index = 0; index < paired; index++) {
      out.push({
        kind: 'replace',
        before: deletions[index]!.before,
        after: insertions[index]!.after,
        beforeNode: deletions[index]!.beforeNode,
        afterNode: insertions[index]!.afterNode
      })
    }

    out.push(...deletions.slice(paired), ...insertions.slice(paired))
  }

  return out
}

/**
 * Monta o documento final a partir das mudanças ACEITAS.
 *
 * O que não foi aceito volta ao estado atual: rejeitar uma inserção é omiti-la,
 * rejeitar uma remoção é manter o bloco, rejeitar uma substituição é preservar
 * o texto original. É o comportamento que faz "rejeitar" significar "nada muda
 * aqui" — e não "some com isso".
 */
export function applyAcceptedChanges(
  changes: readonly BlockChange[],
  acceptedIndexes: readonly number[]
): { type: 'doc'; content: unknown[] } {
  const accepted = new Set(acceptedIndexes)
  const content: unknown[] = []

  for (const change of changes) {
    const isAccepted = accepted.has(change.index)

    switch (change.kind) {
      case 'keep':
        if (change.afterNode !== null) content.push(change.afterNode)
        break

      case 'insert':
        if (isAccepted && change.afterNode !== null) content.push(change.afterNode)
        break

      case 'delete':
        if (!isAccepted && change.beforeNode !== null) content.push(change.beforeNode)
        break

      case 'replace': {
        const node = isAccepted ? change.afterNode : change.beforeNode
        if (node !== null) content.push(node)
        break
      }
    }
  }

  // Um documento sem blocos quebra o editor; um parágrafo vazio é o mínimo válido.
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }]
  }
}

/** Quantas mudanças reais existem — `keep` não conta. */
export function countChanges(changes: readonly BlockChange[]): number {
  return changes.filter((change) => change.kind !== 'keep').length
}
