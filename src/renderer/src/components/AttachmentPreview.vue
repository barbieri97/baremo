<script setup lang="ts">
/**
 * Visualizador de anexos (spec §8.5).
 *
 * O conteúdo chega pelo protocolo `baremo-file://<id>`: o renderer recebe um ID,
 * pede a URL ao processo principal e a usa como fonte. Nenhum caminho de disco
 * atravessa a fronteira, e o handler do protocolo só resolve dentro do diretório
 * de anexos.
 *
 * O PDF é renderizado pelo `pdf.js` embarcado, com o worker vindo do próprio
 * bundle — a CSP não permitiria buscá-lo em CDN, e não deveria mesmo: o app
 * funciona offline.
 */
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from './BaseButton.vue'
import type { Attachment } from '@shared/contracts/entities'

const props = defineProps<{ attachment: Attachment }>()
const emit = defineEmits<{ close: [] }>()

const appStore = useAppStore()

const url = ref<string | null>(null)
const pdfPage = ref(1)
const pdfPageCount = ref(0)
const canvas = ref<HTMLCanvasElement | null>(null)
const pdfDocument = shallowRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(
  null
)
const loading = ref(true)

const isImage = props.attachment.detectedMime.startsWith('image/')
const isAudio = props.attachment.detectedMime.startsWith('audio/')
const isPdf = props.attachment.detectedMime === 'application/pdf'

onMounted(async () => {
  try {
    const result = await api('attachments:url', { id: props.attachment.id })
    url.value = result.url
    if (isPdf) await openPdf(result.url)
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  void (pdfDocument.value as { destroy?: () => void } | null)?.destroy?.()
})

async function openPdf(source: string): Promise<void> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const task = pdfjs.getDocument({ url: source })
  const document = await task.promise

  pdfDocument.value = document as never
  pdfPageCount.value = document.numPages
  await renderPage(1)
}

async function renderPage(pageNumber: number): Promise<void> {
  const document = pdfDocument.value as {
    getPage: (n: number) => Promise<{
      getViewport: (options: { scale: number }) => { width: number; height: number }
      render: (options: unknown) => { promise: Promise<void> }
    }>
  } | null

  if (document === null || canvas.value === null) return

  const page = await document.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1.4 })
  const context = canvas.value.getContext('2d')
  if (context === null) return

  canvas.value.width = viewport.width
  canvas.value.height = viewport.height
  await page.render({ canvasContext: context, viewport, canvas: canvas.value }).promise

  pdfPage.value = pageNumber
}

async function goToPage(delta: number): Promise<void> {
  const next = pdfPage.value + delta
  if (next < 1 || next > pdfPageCount.value) return
  await renderPage(next)
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex flex-col bg-ink-900/80"
    role="dialog"
    aria-modal="true"
    @keydown.esc="emit('close')"
  >
    <header class="flex items-center justify-between gap-4 bg-white px-4 py-2">
      <p class="truncate text-sm font-medium text-ink-800">{{ attachment.originalName }}</p>

      <div class="flex items-center gap-2">
        <template v-if="isPdf && pdfPageCount > 0">
          <BaseButton size="sm" :disabled="pdfPage <= 1" @click="goToPage(-1)">Anterior</BaseButton>
          <span class="tabular text-xs text-ink-600">{{ pdfPage }} / {{ pdfPageCount }}</span>
          <BaseButton size="sm" :disabled="pdfPage >= pdfPageCount" @click="goToPage(1)">
            Próxima
          </BaseButton>
        </template>
        <BaseButton size="sm" @click="emit('close')">Fechar</BaseButton>
      </div>
    </header>

    <div class="flex flex-1 items-center justify-center overflow-auto p-6">
      <p v-if="loading" class="text-sm text-white">Carregando…</p>

      <img
        v-else-if="isImage && url !== null"
        :src="url"
        :alt="attachment.originalName"
        class="max-h-full max-w-full object-contain"
      />

      <audio v-else-if="isAudio && url !== null" :src="url" controls class="w-full max-w-2xl" />

      <canvas v-else-if="isPdf" ref="canvas" class="max-w-full bg-white shadow-lg" />

      <p v-else class="text-sm text-white">
        Este tipo de arquivo não tem visualização interna.
      </p>
    </div>
  </div>
</template>
