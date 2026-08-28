/**
 * Extensões do editor (spec §9.2, ADR-005).
 *
 * Todas verificadas como MIT no registry: nenhuma exige TipTap Pro (P4). Ficam
 * de fora, por decorrência disso: comentários, edição colaborativa, exportação
 * DOCX nativa e o versionamento da TipTap — este último reimplementado em
 * `main/repositories/documents.ts`.
 */

import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { FontFamily } from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { Placeholder, CharacterCount, Focus, Dropcursor, Gapcursor } from '@tiptap/extensions'
import Typography from '@tiptap/extension-typography'
import { createLowlight, common } from 'lowlight'
import type { AnyExtension } from '@tiptap/core'
import {
  ChartBlockNode,
  PageBreakNode,
  ResultsBlockNode,
  SignatureNode,
  VariableNode
} from './nodes'

const lowlight = createLowlight(common)

export function buildExtensions(options: { placeholder: string }): AnyExtension[] {
  return [
    StarterKit.configure({
      // Substituídos pelas versões configuradas abaixo.
      codeBlock: false,
      link: false,
      dropcursor: false,
      gapcursor: false,
      underline: false
    }),

    Underline,
    Subscript,
    Superscript,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    FontFamily,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),

    /**
     * Allowlist de protocolo (§9.2).
     *
     * `javascript:` fica bloqueado aqui, no editor, E de novo no serializador do
     * PDF. A dupla checagem é intencional: o documento pode ser gravado por uma
     * tool de IA sem passar pelo editor, e a segunda barreira é a que vale.
     */
    Link.configure({
      protocols: ['http', 'https', 'mailto'],
      autolink: true,
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer' }
    }),

    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,

    Image.configure({ inline: false, allowBase64: true }),

    TaskList,
    TaskItem.configure({ nested: true }),

    CodeBlockLowlight.configure({ lowlight }),

    Placeholder.configure({
      placeholder: options.placeholder,
      emptyEditorClass: 'is-empty'
    }),
    CharacterCount,
    Focus.configure({ className: 'has-focus', mode: 'shallowest' }),
    Typography,
    Dropcursor,
    Gapcursor,

    // Nós do produto (§9.2).
    VariableNode,
    PageBreakNode,
    SignatureNode,
    ResultsBlockNode,
    ChartBlockNode
  ]
}
