/**
 * Catálogo: cores, funções cognitivas e instrumentos.
 *
 * São dados lidos por quase toda tela — a grade de resultados, o editor de
 * faixas, os relatórios — e mudam pouco. Ficam em store para que a árvore não
 * seja recarregada a cada navegação.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api'
import { buildTree, flatten } from '@shared/domain/tree'
import type { CognitiveFunction, Color, Instrument } from '@shared/contracts/entities'

export const useCatalogStore = defineStore('catalog', () => {
  const colors = ref<Color[]>([])
  const cognitiveFunctions = ref<CognitiveFunction[]>([])
  const instruments = ref<Instrument[]>([])
  const loaded = ref(false)

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return

    const [loadedColors, loadedFunctions, loadedInstruments] = await Promise.all([
      api('config:listColors'),
      api('cognitiveFunctions:list'),
      api('instruments:list')
    ])

    colors.value = loadedColors
    cognitiveFunctions.value = loadedFunctions
    instruments.value = loadedInstruments
    loaded.value = true
  }

  const functionTree = computed(() => buildTree(cognitiveFunctions.value))
  const instrumentTree = computed(() => buildTree(instruments.value))

  /** Lista plana com profundidade — o que os seletores em árvore consomem. */
  const flatFunctions = computed(() => flatten(cognitiveFunctions.value))
  const flatInstruments = computed(() => flatten(instruments.value))

  const colorById = computed(() => new Map(colors.value.map((color) => [color.id, color])))
  const functionById = computed(
    () => new Map(cognitiveFunctions.value.map((node) => [node.id, node]))
  )
  const instrumentById = computed(
    () => new Map(instruments.value.map((node) => [node.id, node]))
  )

  /**
   * Caminho completo do instrumento, com os ancestrais.
   * "Semelhanças" sozinho não diz de qual bateria veio.
   */
  function instrumentPath(id: string): string {
    const parts: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = id

    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor)
      const node: Instrument | undefined = instrumentById.value.get(cursor)
      if (!node) break
      parts.unshift(node.name)
      cursor = node.parentId
    }

    return parts.join(' › ')
  }

  return {
    colors,
    cognitiveFunctions,
    instruments,
    loaded,
    load,
    functionTree,
    instrumentTree,
    flatFunctions,
    flatInstruments,
    colorById,
    functionById,
    instrumentById,
    instrumentPath
  }
})
