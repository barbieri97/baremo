<script setup lang="ts" generic="T">
/**
 * Lista de seleção nativa.
 *
 * Nativa de propósito: em formulários densos de lançamento, o `<select>` do
 * sistema é o que responde melhor ao teclado (digitar a inicial, setas).
 * As opções vêm pelo slot.
 */
import { computed, getCurrentInstance, nextTick, ref } from 'vue'
import { controlClasses, useFieldContext, type ControlSize } from './form-field'

const props = withDefaults(defineProps<{ size?: ControlSize; invalid?: boolean }>(), {
  size: 'md',
  invalid: false
})

const model = defineModel<T>()

const field = useFieldContext()
const isInvalid = computed(() => props.invalid || (field?.invalid.value ?? false))

const element = ref<HTMLSelectElement | null>(null)
defineExpose({ focus: () => element.value?.focus() })

/**
 * Componente controlado: quando o pai desfaz a escolha no mesmo tique (o
 * "aplicar a todos" do lançamento volta ao vazio), a prop termina igual ao que
 * era, este componente não re-renderiza e o `<select>` continuaria mostrando a
 * opção escolhida. Re-renderizar depois da troca ressincroniza o DOM.
 */
const instance = getCurrentInstance()
function resync(): void {
  void nextTick(() => instance?.proxy?.$forceUpdate())
}
</script>

<template>
  <select
    :id="field?.id.value"
    ref="element"
    v-model="model"
    :class="controlClasses(size, isInvalid)"
    :aria-invalid="isInvalid || undefined"
    :aria-describedby="field?.describedBy.value"
    @change="resync"
  >
    <slot />
  </select>
</template>
