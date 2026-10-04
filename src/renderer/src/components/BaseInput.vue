<script setup lang="ts" generic="T extends string | number | null | undefined">
/**
 * Campo de texto de uma linha.
 *
 * Dentro de um `BaseField`, herda dele `id`, descrição e estado inválido; fora,
 * aceita os mesmos atributos de um `<input>` comum.
 */
import { computed, ref } from 'vue'
import { controlClasses, useFieldContext, type ControlSize } from './form-field'

const props = withDefaults(defineProps<{ size?: ControlSize; invalid?: boolean }>(), {
  size: 'md',
  invalid: false
})

const [model, modifiers] = defineModel<T, 'number'>({
  set(value) {
    if (modifiers.number && typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      return (Number.isNaN(parsed) ? value : parsed) as T
    }
    return value
  }
})

const field = useFieldContext()
const isInvalid = computed(() => props.invalid || (field?.invalid.value ?? false))

const element = ref<HTMLInputElement | null>(null)
defineExpose({
  focus: () => element.value?.focus(),
  select: () => element.value?.select()
})
</script>

<template>
  <input
    :id="field?.id.value"
    ref="element"
    v-model="model"
    :class="controlClasses(size, isInvalid)"
    :aria-invalid="isInvalid || undefined"
    :aria-describedby="field?.describedBy.value"
  />
</template>
