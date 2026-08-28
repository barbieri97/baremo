/**
 * Slash menu (spec §9.2, fase 4).
 *
 * Construído sobre o utilitário `Suggestion` do TipTap — MIT, verificado. A lista
 * é filtrada por termo e navegada por teclado: setas movem, Enter escolhe, Esc
 * fecha. Sem isso, os nós do produto (tokens, tabela de resultados, gráfico)
 * ficariam acessíveis só pela barra de ferramentas, o que quebra o fluxo de quem
 * está escrevendo.
 */

import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { Editor, Range } from '@tiptap/core'
import { TOKENS } from './nodes'

export interface SlashItem {
  readonly title: string
  readonly hint: string
  readonly keywords: readonly string[]
  readonly run: (editor: Editor, range: Range) => void
}

export interface SlashContext {
  /** Avaliação vinculada ao documento; sem ela, os blocos dinâmicos não entram. */
  readonly assessmentId: string | null
}

function buildItems(context: SlashContext): SlashItem[] {
  const items: SlashItem[] = [
    {
      title: 'Título 1',
      hint: 'Seção principal',
      keywords: ['h1', 'titulo', 'cabecalho'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run()
    },
    {
      title: 'Título 2',
      hint: 'Subseção',
      keywords: ['h2', 'subtitulo'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run()
    },
    {
      title: 'Título 3',
      hint: 'Subseção menor',
      keywords: ['h3'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run()
    },
    {
      title: 'Lista com marcadores',
      hint: 'Itens sem ordem',
      keywords: ['lista', 'bullet', 'ul'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
    {
      title: 'Lista numerada',
      hint: 'Itens em sequência',
      keywords: ['numerada', 'ol', 'ordenada'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
    {
      title: 'Citação',
      hint: 'Trecho citado',
      keywords: ['citacao', 'quote', 'blockquote'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
    {
      title: 'Tabela',
      hint: '3×3 com cabeçalho',
      keywords: ['tabela', 'table'],
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
    },
    {
      title: 'Linha horizontal',
      hint: 'Separador',
      keywords: ['separador', 'linha', 'hr'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
    {
      title: 'Quebra de página',
      hint: 'Força nova página no PDF',
      keywords: ['quebra', 'pagina', 'page break'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertPageBreak().run()
    },
    {
      title: 'Bloco de assinatura',
      hint: 'Nome, CRP e espaço para assinar',
      keywords: ['assinatura', 'crp', 'rodape'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).insertSignature().run()
    }
  ]

  // Blocos dinâmicos só fazem sentido com uma avaliação vinculada: sem ela, o
  // nó entraria no documento já sem conseguir carregar nada.
  if (context.assessmentId !== null) {
    items.push(
      {
        title: 'Tabela de resultados',
        hint: 'Resultados da avaliação, lidos na renderização',
        keywords: ['resultados', 'escores', 'tabela de resultados'],
        run: (editor, range) =>
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertResultsBlock({
              assessmentId: context.assessmentId,
              cognitiveFunctionId: null
            })
            .run()
      },
      {
        title: 'Gráfico de perfil',
        hint: 'Perfil por função cognitiva',
        keywords: ['grafico', 'perfil', 'chart'],
        run: (editor, range) =>
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertChartBlock({ assessmentId: context.assessmentId })
            .run()
      }
    )
  }

  // Tokens (§9.2): resolvidos LOCALMENTE na exportação.
  for (const token of TOKENS) {
    items.push({
      title: token.label,
      hint: `Token {{${token.token}}}`,
      keywords: ['token', 'variavel', ...token.token.split('.')],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).insertVariable(token.token).run()
    })
  }

  return items
}

export function filterSlashItems(context: SlashContext, query: string): SlashItem[] {
  const term = query.trim().toLocaleLowerCase('pt-BR')
  const items = buildItems(context)

  if (term.length === 0) return items.slice(0, 10)

  return items
    .filter(
      (item) =>
        item.title.toLocaleLowerCase('pt-BR').includes(term) ||
        item.keywords.some((keyword) => keyword.includes(term))
    )
    .slice(0, 10)
}

/**
 * Contrato do popover.
 *
 * Deriva dos tipos do próprio `Suggestion` para não divergir dele — os campos
 * são opcionais lá, e declará-los obrigatórios aqui quebraria a compatibilidade.
 */
export interface SlashRenderer {
  onStart(props: SuggestionProps<SlashItem>): void
  onUpdate(props: SuggestionProps<SlashItem>): void
  onKeyDown(props: SuggestionKeyDownProps): boolean
  onExit(): void
}

/**
 * Extensão do slash menu.
 *
 * A renderização do popover é injetada pelo componente Vue: manter o desenho
 * fora daqui deixa esta extensão testável e livre do ciclo de vida do Vue.
 */
export function createSlashMenu(
  context: SlashContext,
  renderer: () => SlashRenderer
): Extension {
  return Extension.create({
    name: 'slashMenu',

    addProseMirrorPlugins() {
      const options: SuggestionOptions<SlashItem> = {
        editor: this.editor,
        char: '/',
        // Só no começo de um bloco vazio ou após espaço: uma barra no meio de
        // "e/ou" não deveria abrir menu nenhum.
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterSlashItems(context, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          const view = renderer()
          return {
            onStart: view.onStart,
            onUpdate: view.onUpdate,
            onKeyDown: view.onKeyDown,
            onExit: view.onExit
          }
        }
      }

      return [Suggestion(options)]
    }
  })
}
