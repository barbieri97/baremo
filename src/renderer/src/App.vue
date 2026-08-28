<script setup lang="ts">
/**
 * Raiz do renderer.
 *
 * Carrega o estado do app antes de mostrar a interface: a casca exibe o
 * indicador do módulo de IA e o aviso de criptografia de disco, e ambos
 * dependem desse estado — renderizar antes daria um pisca de informação errada.
 */
import { onMounted, ref } from 'vue'
import AppShell from './components/AppShell.vue'
import { useAppStore } from './stores/app'
import { errorMessage } from './api'

const appStore = useAppStore()
const bootError = ref<string | null>(null)

onMounted(async () => {
  try {
    await appStore.load()
  } catch (error) {
    bootError.value = errorMessage(error)
  }
})
</script>

<template>
  <div v-if="bootError !== null" class="flex h-full items-center justify-center p-8">
    <div class="card max-w-md p-6">
      <h1 class="text-base font-semibold text-danger-600">Não foi possível iniciar</h1>
      <p class="mt-2 text-sm text-ink-600">{{ bootError }}</p>
    </div>
  </div>

  <div v-else-if="appStore.state === null" class="flex h-full items-center justify-center">
    <p class="text-sm text-ink-500">Carregando…</p>
  </div>

  <AppShell v-else />
</template>
