<script setup lang="ts">
/**
 * Gerenciador de árvore, compartilhado por funções cognitivas e instrumentos
 * (spec §4.3, §4.4).
 *
 * As duas árvores têm as mesmas regras — profundidade ilimitada, ordenação por
 * nível, nenhum ciclo — então têm o mesmo componente. A reordenação é por
 * botões e teclado, e não por arrastar: arrastar é impreciso em árvore profunda
 * e inacessível por teclado, e este app tem requisito explícito de teclado
 * (§16.4).
 */
import { computed, ref } from 'vue'
import BaseButton from './BaseButton.vue'
import type { TreeNode, TreeNodeLike } from '@shared/domain/tree'

interface Props {
  nodes: readonly (TreeNodeLike & { name: string })[]
  tree: readonly TreeNode<TreeNodeLike & { name: string }>[]
  selectedId: string | null
  emptyMessage: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [id: string]
  addChild: [parentId: string | null]
  move: [payload: { id: string; parentId: string | null; order: number }]
}>()

const collapsed = ref(new Set<string>())

function toggle(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

/** Linhas visíveis, respeitando os ramos recolhidos. */
const visible = computed(() => {
  const rows: { node: TreeNodeLike & { name: string }; depth: number; hasChildren: boolean }[] = []

  const walk = (branches: readonly TreeNode<TreeNodeLike & { name: string }>[]): void => {
    for (const branch of branches) {
      rows.push({
        node: branch.node,
        depth: branch.depth,
        hasChildren: branch.children.length > 0
      })
      if (!collapsed.value.has(branch.node.id)) walk(branch.children)
    }
  }

  walk(props.tree)
  return rows
})

/**
 * Move o nó entre irmãos.
 *
 * A nova ordem é a do irmão trocado — os dois só precisam terminar em posições
 * relativas invertidas, e o repositório reordena o restante na leitura.
 */
function moveWithinSiblings(id: string, direction: -1 | 1): void {
  const node = props.nodes.find((candidate) => candidate.id === id)
  if (!node) return

  const siblings = props.nodes
    .filter((candidate) => candidate.parentId === node.parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  const index = siblings.findIndex((candidate) => candidate.id === id)
  const target = siblings[index + direction]
  if (!target) return

  emit('move', { id, parentId: node.parentId, order: target.order })
  emit('move', { id: target.id, parentId: target.parentId, order: node.order })
}

/** Aninha o nó sob o irmão imediatamente anterior. */
function indent(id: string): void {
  const node = props.nodes.find((candidate) => candidate.id === id)
  if (!node) return

  const siblings = props.nodes
    .filter((candidate) => candidate.parentId === node.parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  const index = siblings.findIndex((candidate) => candidate.id === id)
  const newParent = siblings[index - 1]
  if (!newParent) return

  emit('move', { id, parentId: newParent.id, order: 999 })
}

/** Promove o nó para o nível do pai. */
function outdent(id: string): void {
  const node = props.nodes.find((candidate) => candidate.id === id)
  if (!node || node.parentId === null) return

  const parent = props.nodes.find((candidate) => candidate.id === node.parentId)
  emit('move', { id, parentId: parent?.parentId ?? null, order: (parent?.order ?? 0) + 1 })
}
</script>

<template>
  <div class="card overflow-hidden">
    <div class="flex items-center justify-between border-b border-ink-200 px-3 py-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-ink-500">Estrutura</p>
      <BaseButton size="sm" @click="emit('addChild', null)">Adicionar na raiz</BaseButton>
    </div>

    <ul v-if="visible.length > 0" class="max-h-[60vh] overflow-y-auto py-1">
      <li v-for="row in visible" :key="row.node.id">
        <div
          class="group flex items-center gap-1 px-2 py-1 text-sm"
          :class="selectedId === row.node.id ? 'bg-brand-50' : 'hover:bg-ink-50'"
          :style="{ paddingLeft: `${row.depth * 1.25 + 0.5}rem` }"
        >
          <button
            v-if="row.hasChildren"
            class="h-5 w-5 shrink-0 rounded text-ink-400 hover:bg-ink-200"
            :aria-label="collapsed.has(row.node.id) ? 'Expandir' : 'Recolher'"
            @click="toggle(row.node.id)"
          >
            {{ collapsed.has(row.node.id) ? '▸' : '▾' }}
          </button>
          <span v-else class="h-5 w-5 shrink-0" aria-hidden="true" />

          <button
            class="flex-1 truncate text-left"
            :class="selectedId === row.node.id ? 'font-semibold text-brand-700' : 'text-ink-700'"
            @click="emit('select', row.node.id)"
          >
            {{ row.node.name }}
          </button>

          <div class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <button
              class="rounded px-1 text-xs text-ink-500 hover:bg-ink-200"
              title="Mover para cima"
              @click="moveWithinSiblings(row.node.id, -1)"
            >
              ↑
            </button>
            <button
              class="rounded px-1 text-xs text-ink-500 hover:bg-ink-200"
              title="Mover para baixo"
              @click="moveWithinSiblings(row.node.id, 1)"
            >
              ↓
            </button>
            <button
              class="rounded px-1 text-xs text-ink-500 hover:bg-ink-200"
              title="Aninhar sob o item anterior"
              @click="indent(row.node.id)"
            >
              →
            </button>
            <button
              class="rounded px-1 text-xs text-ink-500 hover:bg-ink-200"
              title="Promover um nível"
              @click="outdent(row.node.id)"
            >
              ←
            </button>
            <button
              class="rounded px-1 text-xs text-brand-500 hover:bg-brand-100"
              title="Adicionar subitem"
              @click="emit('addChild', row.node.id)"
            >
              +
            </button>
          </div>
        </div>
      </li>
    </ul>

    <p v-else class="px-4 py-8 text-center text-sm text-ink-400">{{ emptyMessage }}</p>
  </div>
</template>
