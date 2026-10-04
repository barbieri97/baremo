<script setup lang="ts" generic="T extends string | null | undefined">
/** Campo de texto de várias linhas. Mesmo contrato do `BaseInput`. */
import { computed } from 'vue'
import { controlClasses, useFieldContext } from './form-field'

const props = withDefaults(defineProps<{ invalid?: boolean }>(), { invalid: false })
const model = defineModel<T>()

const field = useFieldContext()
const isInvalid = computed(() => props.invalid || (field?.invalid.value ?? false))
</script>

<template>
  <textarea
    :id="field?.id.value"
    v-model="model"
    :class="[controlClasses('md', isInvalid), 'min-h-20']"
    :aria-invalid="isInvalid || undefined"
    :aria-describedby="field?.describedBy.value"
  />
</template>
