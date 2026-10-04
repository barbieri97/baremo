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
import { computed, ref, watch } from 'vue'
import BaseButton from './BaseButton.vue'
import BaseCard from './BaseCard.vue'
import BaseIconButton from './BaseIconButton.vue'
import BaseEmptyState from './BaseEmptyState.vue'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  IndentDecrease,
  IndentIncrease,
  Plus
} from 'lucide-vue-next'
import type { TreeNode, TreeNodeLike } from '@shared/domain/tree'

interface Props {
  nodes: readonly (TreeNodeLike & { name: string })[]
  tree: readonly TreeNode<TreeNodeLike & { name: string }>[]
  selectedId: string | null
  emptyMessage: string
  /**
   * Começa com todos os ramos recolhidos. Em catálogos grandes, a lista de
   * raízes é o que interessa à primeira vista; os filhos abrem sob demanda.
   */
  collapsedByDefault?: boolean
}

const props = withDefaults(defineProps<Props>(), { collapsedByDefault: false })
const emit = defineEmits<{
  select: [id: string]
  addChild: [parentId: string | null]
  move: [payload: { id: string; parentId: string | null; order: number }]
}>()

/**
 * Nós cujo estado difere do padrão — expandidos quando o padrão é recolhido, e
 * vice-versa. Guardar só a exceção faz nós novos nascerem no estado padrão.
 */
const toggled = ref(new Set<string>())

function isCollapsed(id: string): boolean {
  return props.collapsedByDefault !== toggled.value.has(id)
}

function setCollapsed(id: string, value: boolean): void {
  if (isCollapsed(id) === value) return
  const next = new Set(toggled.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  toggled.value = next
}

function toggle(id: string): void {
  setCollapsed(id, !isCollapsed(id))
}

/** Expande os ancestrais do nó, para que ele fique visível. */
function reveal(id: string): void {
  const byId = new Map(props.nodes.map((node) => [node.id, node]))
  let parentId = byId.get(id)?.parentId ?? null
  while (parentId !== null) {
    setCollapsed(parentId, false)
    parentId = byId.get(parentId)?.parentId ?? null
  }
}

// O nó selecionado nunca fica escondido — nem o recém-criado sob um pai
// recolhido.
watch(
  () => [props.selectedId, props.nodes] as const,
  ([id]) => {
    if (id !== null) reveal(id)
  },
  { immediate: true }
)

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
      if (!isCollapsed(branch.node.id)) walk(branch.children)
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

  setCollapsed(newParent.id, false)
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
  <BaseCard class="overflow-hidden">
    <div class="flex items-center justify-between border-b border-line px-3 py-2">
      <p class="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Estrutura</p>
      <BaseButton size="sm" :icon="Plus" @click="emit('addChild', null)">
        Adicionar na raiz
      </BaseButton>
    </div>

    <ul v-if="visible.length > 0" class="max-h-[60vh] overflow-y-auto py-1">
      <li v-for="row in visible" :key="row.node.id">
        <div
          class="group flex items-center gap-1 px-2 py-1 text-sm"
          :class="selectedId === row.node.id ? 'bg-accent-soft' : 'hover:bg-canvas'"
          :style="{ paddingLeft: `${row.depth * 1.25 + 0.5}rem` }"
        >
          <BaseIconButton
            v-if="row.hasChildren"
            :icon="isCollapsed(row.node.id) ? ChevronRight : ChevronDown"
            :label="
              isCollapsed(row.node.id) ? `Expandir ${row.node.name}` : `Recolher ${row.node.name}`
            "
            :aria-expanded="!isCollapsed(row.node.id)"
            size="sm"
            @click="toggle(row.node.id)"
          />
          <span v-else class="size-5 shrink-0" aria-hidden="true" />

          <button
            type="button"
            class="flex-1 truncate text-left"
            :class="
              selectedId === row.node.id ? 'font-semibold text-accent-strong' : 'text-fg-secondary'
            "
            @click="emit('select', row.node.id)"
          >
            {{ row.node.name }}
          </button>

          <div
            class="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          >
            <BaseIconButton
              :icon="ArrowUp"
              label="Mover para cima"
              size="sm"
              @click="moveWithinSiblings(row.node.id, -1)"
            />
            <BaseIconButton
              :icon="ArrowDown"
              label="Mover para baixo"
              size="sm"
              @click="moveWithinSiblings(row.node.id, 1)"
            />
            <BaseIconButton
              :icon="IndentIncrease"
              label="Aninhar sob o item anterior"
              size="sm"
              @click="indent(row.node.id)"
            />
            <BaseIconButton
              :icon="IndentDecrease"
              label="Promover um nível"
              size="sm"
              @click="outdent(row.node.id)"
            />
            <BaseIconButton
              :icon="Plus"
              label="Adicionar subitem"
              variant="accent"
              size="sm"
              @click="emit('addChild', row.node.id)"
            />
          </div>
        </div>
      </li>
    </ul>

    <BaseEmptyState v-else :message="emptyMessage" class="px-4" />
  </BaseCard>
</template>
