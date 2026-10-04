<script setup lang="ts">
/**
 * Rótulo, controle e mensagem de um campo de formulário.
 *
 * O erro substitui a dica quando presente: as duas juntas disputariam a mesma
 * linha, e o erro é o que precisa ser lido primeiro.
 */
import { computed, provide, useId } from 'vue'
import { FIELD_CONTEXT } from './form-field'

const props = defineProps<{
  label?: string
  /** Mantém um `id` conhecido; sem ele, um é gerado. */
  id?: string
  hint?: string | null
  error?: string | null
  /** Rótulo só para leitor de tela, quando o contexto visual já basta. */
  hideLabel?: boolean
}>()

const generatedId = useId()
const controlId = computed(() => props.id ?? `field-${generatedId}`)
const messageId = computed(() => `${controlId.value}-message`)
const hasError = computed(() => (props.error ?? '') !== '')
const hasMessage = computed(() => hasError.value || (props.hint ?? '') !== '')

provide(FIELD_CONTEXT, {
  id: controlId,
  describedBy: computed(() => (hasMessage.value ? messageId.value : undefined)),
  invalid: hasError
})
</script>

<template>
  <div>
    <label
      :for="controlId"
      :class="
        hideLabel
          ? 'sr-only'
          : 'mb-1 block text-xs font-semibold uppercase tracking-wide text-fg-subtle'
      "
    >
      <slot name="label">{{ label }}</slot>
    </label>

    <slot />

    <p
      v-if="hasMessage"
      :id="messageId"
      class="mt-1 text-xs"
      :class="hasError ? 'text-danger' : 'text-fg-subtle'"
    >
      {{ hasError ? error : hint }}
    </p>
  </div>
</template>
