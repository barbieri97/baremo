/**
 * Nós customizados do editor (spec §9.2).
 *
 * É aqui que está o valor específico do produto — o resto do editor é StarterKit.
 * Os nomes dos nós casam com a allowlist do serializador (`main/pdf/serialize.ts`):
 * um nó que exista aqui e não lá simplesmente não é renderizado no PDF, o que é
 * o comportamento seguro por construção.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ResultsBlockView from './ResultsBlockView.vue'
import ChartBlockView from './ChartBlockView.vue'

/** Tokens resolvidos LOCALMENTE na exportação (§9.2, §10.3). */
export const TOKENS = [
  { token: 'paciente.nome', label: 'Nome do paciente' },
  { token: 'paciente.data_nascimento', label: 'Data de nascimento' },
  { token: 'paciente.idade_na_avaliacao', label: 'Idade na avaliação' },
  { token: 'paciente.escolaridade', label: 'Escolaridade' },
  { token: 'paciente.responsavel', label: 'Responsável' },
  { token: 'avaliacao.data', label: 'Data da avaliação' },
  { token: 'avaliacao.motivo', label: 'Motivo do encaminhamento' },
  { token: 'profissional.nome', label: 'Nome do profissional' },
  { token: 'profissional.crp', label: 'CRP' },
  { token: 'profissional.especialidade', label: 'Especialidade' }
] as const

export const TOKEN_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  TOKENS.map((entry) => [entry.token, entry.label])
)

/**
 * Nó `variable`: um token inline, atômico.
 *
 * `atom: true` faz o cursor tratá-lo como um único caractere — sem isso, o
 * usuário conseguiria editar "{{paciente.nome}}" por dentro e produzir um token
 * quebrado que não resolve na exportação.
 */
export const VariableNode = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      token: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-token'),
        renderHTML: (attributes) => ({ 'data-token': attributes['token'] })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-token]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const token = String(node.attrs['token'] ?? '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'tiptap-token' }),
      TOKEN_LABELS[token] ?? `{{${token}}}`
    ]
  },

  addCommands() {
    return {
      insertVariable:
        (token: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { token } })
    }
  }
})

/** Quebra de página; vira `break-after: page` no CSS de impressão (§9.2). */
export const PageBreakNode = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML() {
    return ['div', { 'data-page-break': 'true', class: 'tiptap-page-break' }]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name })
    }
  }
})

/** Bloco de assinatura: nome, CRP e espaço para assinar (§9.2). */
export const SignatureNode = Node.create({
  name: 'signature',
  group: 'block',
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-signature]' }]
  },

  renderHTML() {
    return [
      'div',
      { 'data-signature': 'true', class: 'my-8 text-center text-sm text-ink-500' },
      'Bloco de assinatura — nome, CRP e espaço para assinatura'
    ]
  },

  addCommands() {
    return {
      insertSignature:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name })
    }
  }
})

/**
 * `bloco-resultados` (§9.2, fase 4).
 *
 * Guarda no JSON apenas a REFERÊNCIA à avaliação, não os dados. A tabela é lida
 * do banco no momento da renderização — na tela pelo NodeView, no PDF pelo
 * serializador — de modo que não existe cópia paralela dos resultados dentro do
 * documento para divergir do prontuário.
 */
export const ResultsBlockNode = Node.create({
  name: 'resultsBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      assessmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-assessment-id'),
        renderHTML: (attributes) => ({ 'data-assessment-id': attributes['assessmentId'] })
      },
      cognitiveFunctionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-function-id'),
        renderHTML: (attributes) => ({ 'data-function-id': attributes['cognitiveFunctionId'] })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-results-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-results-block': 'true' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(ResultsBlockView)
  },

  addCommands() {
    return {
      insertResultsBlock:
        (attrs: { assessmentId: string | null; cognitiveFunctionId: string | null }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs })
    }
  }
})

/** `bloco-grafico`: perfil por função cognitiva (§9.2, fase 4). */
export const ChartBlockNode = Node.create({
  name: 'chartBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      assessmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-assessment-id'),
        renderHTML: (attributes) => ({ 'data-assessment-id': attributes['assessmentId'] })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-chart-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-chart-block': 'true' })]
  },

  addNodeView() {
    return VueNodeViewRenderer(ChartBlockView)
  },

  addCommands() {
    return {
      insertChartBlock:
        (attrs: { assessmentId: string | null }) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs })
    }
  }
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    baremoNodes: {
      insertVariable: (token: string) => ReturnType
      insertPageBreak: () => ReturnType
      insertSignature: () => ReturnType
      insertResultsBlock: (attrs: {
        assessmentId: string | null
        cognitiveFunctionId: string | null
      }) => ReturnType
      insertChartBlock: (attrs: { assessmentId: string | null }) => ReturnType
    }
  }
}
