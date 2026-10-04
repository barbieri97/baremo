<script setup lang="ts">
/**
 * Botão do aplicativo.
 *
 * `type="button"` é o padrão de propósito: dentro de um formulário, o padrão do
 * HTML é `submit`, e um botão de ação secundária que submete o formulário por
 * engano é a fonte mais comum de gravação acidental.
 *
 * As variantes `link*` são ações de texto (Editar, Excluir em linha de
 * tabela): sem preenchimento nem altura de controle, para caberem numa linha
 * densa sem disputar atenção com a ação principal da tela.
 */
import { computed, type Component } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'link' | 'link-muted' | 'link-danger'

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant
    size?: 'sm' | 'md'
    type?: 'button' | 'submit'
    disabled?: boolean
    loading?: boolean
    /** Ícone à esquerda do texto. */
    icon?: Component
    /** Estado ligado de um botão alternável (barra do editor). */
    pressed?: boolean
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    type: 'button',
    disabled: false,
    loading: false,
    icon: undefined,
    pressed: undefined
  }
)

const isLink = computed(() => props.variant.startsWith('link'))

const classes = computed(() => {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'

  if (isLink.value) {
    const links: Record<string, string> = {
      link: 'text-accent',
      'link-muted': 'text-fg-subtle',
      'link-danger': 'text-danger'
    }
    return [
      base,
      'hover:underline',
      props.size === 'sm' ? 'text-xs' : 'text-sm',
      links[props.variant]
    ]
  }

  const sizes = {
    sm: 'rounded-control px-2.5 py-1.5 text-xs',
    md: 'rounded-control px-3.5 py-2 text-sm'
  }

  const variants: Record<string, string> = {
    primary: 'bg-accent text-fg-inverse hover:bg-accent-hover',
    secondary: 'bg-surface text-fg-secondary border border-line-strong hover:bg-surface-muted',
    ghost: props.pressed
      ? 'bg-surface-strong text-fg-strong'
      : 'text-fg-muted hover:bg-surface-muted',
    danger: 'bg-danger text-fg-inverse hover:bg-danger-strong'
  }

  return [base, sizes[props.size], variants[props.variant]]
})

const iconSize = computed(() => (props.size === 'sm' ? 'size-3.5' : 'size-4'))
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading" :aria-pressed="pressed">
    <LoaderCircle v-if="loading" :class="[iconSize, 'animate-spin']" aria-hidden="true" />
    <component :is="icon" v-else-if="icon" :class="iconSize" aria-hidden="true" />
    <slot />
  </button>
</template>
