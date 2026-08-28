<script setup lang="ts">
/**
 * Confirmação de operação destrutiva (spec §6.2, §6.3).
 *
 * Duas coisas que a spec exige e que ficam concentradas aqui:
 *
 *  - a contagem de impacto ("removerá o vínculo com 4 subtestes associados"),
 *    para a decisão ser informada e não uma aposta;
 *  - a confirmação por DIGITAÇÃO quando a operação é exclusão definitiva de
 *    prontuário. Digitar o nome é o atrito que separa arquivar de destruir.
 */
import { computed, ref, watch } from 'vue'
import BaseDialog from './BaseDialog.vue'
import BaseButton from './BaseButton.vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    /** Contagem de vínculos, vinda de um endpoint `*:impact`. */
    impact?: { label: string; counts: { entity: string; count: number }[] } | null
    /** Quando presente, exige digitar exatamente este texto para liberar. */
    requireTyping?: string | null
    busy?: boolean
  }>(),
  { confirmLabel: 'Confirmar', impact: null, requireTyping: null, busy: false }
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const open = defineModel<boolean>('open', { required: true })
const typed = ref('')

watch(open, (isOpen) => {
  if (isOpen) typed.value = ''
})

/** Comparação tolerante a espaço e caixa — a mesma regra aplicada no main. */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

const canConfirm = computed(() => {
  if (props.requireTyping === null) return true
  return normalize(typed.value) === normalize(props.requireTyping)
})

const relevantCounts = computed(() =>
  (props.impact?.counts ?? []).filter((entry) => entry.count > 0)
)

function confirm(): void {
  if (!canConfirm.value) return
  emit('confirm')
}

function cancel(): void {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="title">
    <p class="text-sm text-ink-700">{{ message }}</p>

    <div v-if="relevantCounts.length > 0" class="mt-4 rounded-md bg-warn-50 border border-warn-200 p-3">
      <p class="text-xs font-semibold uppercase tracking-wide text-warn-700">Impacto</p>
      <ul class="mt-2 space-y-1 text-sm text-warn-700">
        <li v-for="entry in relevantCounts" :key="entry.entity" class="flex justify-between gap-4">
          <span>{{ entry.entity }}</span>
          <span class="tabular font-semibold">{{ entry.count }}</span>
        </li>
      </ul>
    </div>

    <div v-if="requireTyping !== null" class="mt-4">
      <label class="field-label" for="confirm-typing">
        Para confirmar, digite: <span class="font-normal normal-case text-ink-700">{{ requireTyping }}</span>
      </label>
      <input
        id="confirm-typing"
        v-model="typed"
        class="field-input"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.prevent="confirm"
      />
      <p class="mt-1 text-xs text-ink-500">
        Esta ação é irreversível e remove os arquivos associados do disco.
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="cancel">Cancelar</BaseButton>
      <BaseButton variant="danger" :disabled="!canConfirm" :loading="busy" @click="confirm">
        {{ confirmLabel }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
