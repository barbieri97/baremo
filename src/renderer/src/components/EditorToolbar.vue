<script setup lang="ts">
/**
 * Barra de ferramentas do editor (spec §9.2).
 */
import { computed, ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'
import BaseField from './BaseField.vue'
import BaseInput from './BaseInput.vue'
import BaseSelect from './BaseSelect.vue'
import { TOKENS } from '../editor/nodes'

const props = defineProps<{
  editor: Editor
  assessmentId: string | null
}>()

const linkOpen = ref(false)
const linkUrl = ref('')

const characterCount = computed(() => {
  const storage = props.editor.storage['characterCount'] as
    { characters: () => number; words: () => number } | undefined
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

/** Todos os botões da barra: fantasmas, pequenos, com estado ligado. */
const toolProps = { variant: 'ghost', size: 'sm' } as const

function isActive(name: string, attrs?: Record<string, unknown>): boolean {
  return props.editor.isActive(name, attrs)
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1 border-b border-line bg-surface px-6 py-2">
    <BaseButton
      v-bind="toolProps"
      :pressed="isActive('bold')"
      @click="editor.chain().focus().toggleBold().run()"
    >
      Negrito
    </BaseButton>
    <BaseButton
      v-bind="toolProps"
      :pressed="isActive('italic')"
      @click="editor.chain().focus().toggleItalic().run()"
    >
      Itálico
    </BaseButton>
    <BaseButton
      v-bind="toolProps"
      :pressed="isActive('underline')"
      @click="editor.chain().focus().toggleUnderline().run()"
    >
      Sublinhado
    </BaseButton>

    <span class="mx-1 h-4 w-px bg-line" />

    <BaseButton
      v-for="level in [1, 2, 3] as const"
      :key="level"
      v-bind="toolProps"
      :pressed="isActive('heading', { level })"
      @click="toggleHeading(level)"
    >
      H{{ level }}
    </BaseButton>

    <span class="mx-1 h-4 w-px bg-line" />

    <BaseButton
      v-bind="toolProps"
      :pressed="isActive('bulletList')"
      @click="editor.chain().focus().toggleBulletList().run()"
    >
      Lista
    </BaseButton>
    <BaseButton
      v-bind="toolProps"
      :pressed="isActive('orderedList')"
      @click="editor.chain().focus().toggleOrderedList().run()"
    >
      Numerada
    </BaseButton>
    <BaseButton
      v-bind="toolProps"
      :pressed="isActive('blockquote')"
      @click="editor.chain().focus().toggleBlockquote().run()"
    >
      Citação
    </BaseButton>

    <span class="mx-1 h-4 w-px bg-line" />

    <BaseButton
      v-for="align in ['left', 'center', 'right', 'justify'] as const"
      :key="align"
      v-bind="toolProps"
      :pressed="isActive('paragraph', { textAlign: align })"
      @click="editor.chain().focus().setTextAlign(align).run()"
    >
      {{ { left: 'Esq.', center: 'Centro', right: 'Dir.', justify: 'Just.' }[align] }}
    </BaseButton>

    <span class="mx-1 h-4 w-px bg-line" />

    <BaseButton v-bind="toolProps" @click="insertTable">Tabela</BaseButton>
    <BaseButton v-bind="toolProps" @click="linkOpen = true">Link</BaseButton>
    <BaseButton v-bind="toolProps" @click="editor.chain().focus().insertPageBreak().run()">
      Quebra de página
    </BaseButton>
    <BaseButton v-bind="toolProps" @click="editor.chain().focus().insertSignature().run()">
      Assinatura
    </BaseButton>

    <span class="mx-1 h-4 w-px bg-line" />

    <BaseButton v-bind="toolProps" :disabled="assessmentId === null" @click="insertResultsBlock">
      Tabela de resultados
    </BaseButton>
    <BaseButton v-bind="toolProps" :disabled="assessmentId === null" @click="insertChartBlock">
      Gráfico de perfil
    </BaseButton>

    <span class="mx-1 h-4 w-px bg-line" />

    <BaseSelect
      model-value=""
      size="xs"
      class="w-auto"
      aria-label="Inserir token"
      @change="
        (event: Event) => {
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
    </BaseSelect>

    <p v-if="characterCount" class="ml-auto text-xs text-fg-faint">
      {{ characterCount.words }} palavras · {{ characterCount.characters }} caracteres
    </p>

    <BaseDialog v-model:open="linkOpen" title="Inserir link">
      <BaseField
        id="link-url"
        label="Endereço"
        hint="Apenas http, https e mailto são aceitos. Deixe em branco para remover o link da seleção."
      >
        <BaseInput
          v-model="linkUrl"
          placeholder="https://exemplo.com"
          @keydown.enter.prevent="applyLink"
        />
      </BaseField>

      <template #footer>
        <BaseButton variant="ghost" @click="linkOpen = false">Cancelar</BaseButton>
        <BaseButton variant="primary" @click="applyLink">Aplicar</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
