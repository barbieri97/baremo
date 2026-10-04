<script setup lang="ts">
/**
 * Tabela de dados.
 *
 * O cabeçalho sai de `columns`, e o espaçamento das células vem da
 * `density` — as linhas (`<tr>`) continuam nas telas, pelo slot, porque cada
 * tabela tem células próprias (selos, campos, ações). O que não pode variar de
 * tela para tela é o cabeçalho, o respiro e a linha entre registros.
 *
 * Não inclui a moldura: envolva em `BaseCard` quando a tabela for o conteúdo
 * principal do bloco.
 */
export interface TableColumn {
  key: string
  label?: string
  align?: 'left' | 'right'
  /** Largura e afins (`w-24`). */
  class?: string
}

withDefaults(
  defineProps<{
    columns: readonly TableColumn[]
    density?: 'comfortable' | 'default' | 'compact'
    size?: 'sm' | 'md'
    /** Cabeçalho fixo ao rolar dentro de um contêiner com altura máxima. */
    sticky?: boolean
    /** Quando presente, substitui as linhas por uma mensagem centralizada. */
    emptyText?: string | null
  }>(),
  { density: 'default', size: 'md', sticky: false, emptyText: null }
)
</script>

<template>
  <table
    class="base-table w-full"
    :class="[`base-table--${density}`, size === 'sm' ? 'text-xs' : 'text-sm']"
  >
    <caption
      v-if="$slots.caption"
      class="bg-canvas px-3 py-2 text-left text-sm font-semibold text-fg"
    >
      <slot name="caption" />
    </caption>
    <thead
      class="bg-surface-muted text-xs uppercase tracking-wide text-fg-subtle"
      :class="{ 'sticky top-0 z-10': sticky }"
    >
      <tr>
        <th
          v-for="column in columns"
          :key="column.key"
          scope="col"
          class="font-semibold"
          :class="[column.align === 'right' ? 'text-right' : 'text-left', column.class]"
        >
          {{ column.label }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-if="emptyText !== null">
        <td :colspan="columns.length" class="base-table__empty text-center text-fg-faint">
          {{ emptyText }}
        </td>
      </tr>
      <slot v-else />
    </tbody>
  </table>
</template>

<style scoped>
/* Seletores de célula com `:deep` porque as `<td>` chegam pelo slot, com o
   escopo da tela que as escreveu. */
.base-table :deep(tbody > tr) {
  border-top: 1px solid var(--color-line);
}

.base-table--comfortable th {
  padding: 0.5rem 1rem;
}
.base-table--comfortable :deep(td) {
  padding: 0.625rem 1rem;
}

.base-table--default th,
.base-table--default :deep(td) {
  padding: 0.5rem 0.75rem;
}

.base-table--compact th,
.base-table--compact :deep(td) {
  padding: 0.375rem 0.5rem;
}

.base-table .base-table__empty {
  padding: 2rem 1rem;
}
</style>
