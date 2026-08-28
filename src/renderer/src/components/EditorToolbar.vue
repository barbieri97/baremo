<script setup lang="ts">
/**
 * Barra de ferramentas do editor (spec §9.2).
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'
import { TOKENS } from '../editor/nodes'

const props = defineProps<{
  editor: Editor
  assessmentId: string | null
}>()

const linkOpen = ref(false)
const linkUrl = ref('')

const characterCount = computed(() => {
  const storage = props.editor.storage['characterCount'] as
    | { characters: () => number; words: () => number }
    | undefined
  return storage ? { characters: storage.characters(), words: storage.words() } : null
})

function toggleHeading(level: 1 | 2 | 3): void {
  props.editor.chain().focus().toggleHeading({ level }).run()
}

function insertToken(token: string): void {
  props.editor.chain().focus().insertVariable(token).run()
}

function insertResultsBlock(): void {
  props.editor
    .chain()
    .focus()
    .insertResultsBlock({ assessmentId: props.assessmentId, cognitiveFunctionId: null })
    .run()
}

function insertChartBlock(): void {
  props.editor.chain().focus().insertChartBlock({ assessmentId: props.assessmentId }).run()
}

function insertTable(): void {
  props.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
}

/**
 * Aplica o link com validação de protocolo.
 *
 * O editor já configura a allowlist, mas validar aqui evita que o usuário
 * digite `javascript:…` e receba silêncio: ele vê a recusa.
 */
function applyLink(): void {
  const raw = linkUrl.value.trim()
  if (raw === '') {
    props.editor.chain().focus().unsetLink().run()
    linkOpen.value = false
    return
  }

  try {
    const url = new URL(raw)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return
    props.editor.chain().focus().setLink({ href: url.toString() }).run()
    linkOpen.value = false
    linkUrl.value = ''
  } catch {
    // URL inválida: o diálogo continua aberto para correção.
  }
}

const buttonClass =
  'rounded px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-200 disabled:opacity-40'

function activeClass(name: string, attrs?: Record<string, unknown>): string {
  return props.editor.isActive(name, attrs) ? 'bg-ink-200 text-ink-900' : ''
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1 border-b border-ink-200 bg-white px-6 py-2">
    <button :class="[buttonClass, activeClass('bold')]" @click="editor.chain().focus().toggleBold().run()">
      Negrito
    </button>
    <button :class="[buttonClass, activeClass('italic')]" @click="editor.chain().focus().toggleItalic().run()">
      Itálico
    </button>
    <button
      :class="[buttonClass, activeClass('underline')]"
      @click="editor.chain().focus().toggleUnderline().run()"
    >
      Sublinhado
    </button>

    <span class="mx-1 h-4 w-px bg-ink-200" />

    <button
      v-for="level in [1, 2, 3] as const"
      :key="level"
      :class="[buttonClass, activeClass('heading', { level })]"
      @click="toggleHeading(level)"
    >
      H{{ level }}
    </button>

    <span class="mx-1 h-4 w-px bg-ink-200" />

    <button
      :class="[buttonClass, activeClass('bulletList')]"
      @click="editor.chain().focus().toggleBulletList().run()"
    >
      Lista
    </button>
    <button
      :class="[buttonClass, activeClass('orderedList')]"
      @click="editor.chain().focus().toggleOrderedList().run()"
    >
      Numerada
    </button>
    <button
      :class="[buttonClass, activeClass('blockquote')]"
      @click="editor.chain().focus().toggleBlockquote().run()"
    >
      Citação
    </button>

    <span class="mx-1 h-4 w-px bg-ink-200" />

    <button
      v-for="align in ['left', 'center', 'right', 'justify'] as const"
      :key="align"
      :class="[buttonClass, activeClass('paragraph', { textAlign: align })]"
      @click="editor.chain().focus().setTextAlign(align).run()"
    >
      {{ { left: 'Esq.', center: 'Centro', right: 'Dir.', justify: 'Just.' }[align] }}
    </button>

    <span class="mx-1 h-4 w-px bg-ink-200" />

    <button :class="buttonClass" @click="insertTable">Tabela</button>
    <button :class="buttonClass" @click="linkOpen = true">Link</button>
    <button :class="buttonClass" @click="editor.chain().focus().insertPageBreak().run()">
      Quebra de página
    </button>
    <button :class="buttonClass" @click="editor.chain().focus().insertSignature().run()">
      Assinatura
    </button>

    <span class="mx-1 h-4 w-px bg-ink-200" />

    <button :class="buttonClass" :disabled="assessmentId === null" @click="insertResultsBlock">
      Tabela de resultados
    </button>
    <button :class="buttonClass" :disabled="assessmentId === null" @click="insertChartBlock">
      Gráfico de perfil
    </button>

    <span class="mx-1 h-4 w-px bg-ink-200" />

    <select
      class="rounded border border-ink-300 px-2 py-1 text-xs"
      aria-label="Inserir token"
      @change="
        (event) => {
          const value = (event.target as HTMLSelectElement).value
          if (value !== '') insertToken(value)
          ;(event.target as HTMLSelectElement).value = ''
        }
      "
    >
      <option value="">Inserir token…</option>
      <option v-for="entry in TOKENS" :key="entry.token" :value="entry.token">
        {{ entry.label }}
      </option>
    </select>

    <p v-if="characterCount" class="ml-auto text-xs text-ink-400">
      {{ characterCount.words }} palavras · {{ characterCount.characters }} caracteres
    </p>

    <BaseDialog v-model:open="linkOpen" title="Inserir link">
      <label class="field-label" for="link-url">Endereço</label>
      <input
        id="link-url"
        v-model="linkUrl"
        class="field-input"
        placeholder="https://exemplo.com"
        @keydown.enter.prevent="applyLink"
      />
      <p class="mt-2 text-xs text-ink-500">
        Apenas http, https e mailto são aceitos. Deixe em branco para remover o link da seleção.
      </p>

      <template #footer>
        <BaseButton variant="ghost" @click="linkOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" @click="applyLink">Aplicar</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
