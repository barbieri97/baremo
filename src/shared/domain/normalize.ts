/**
 * Normalização posicional de escores (spec §7.3).
 *
 * Instrumentos diferentes falam línguas diferentes: percentil vai de 0 a 100,
 * z-score de −5 a 5, escore ponderado de 1 a 19. Para desenhar um perfil — vários
 * subtestes na mesma barra, várias funções no mesmo radar — os valores precisam
 * cair numa régua só.
 *
 * A conversão é POSICIONAL dentro do domínio declarado de cada tipo, e não
 * estatística. Não é equivalência psicométrica, e o número resultante não deve
 * ser lido como percentil verdadeiro: serve para leitura de perfil, não para
 * comparação de magnitude entre instrumentos. Essa ressalva já valia para o
 * gráfico de perfil dos documentos, e continua valendo aqui — a diferença é que
 * agora ela mora num lugar só, usado pela tela e pelo PDF.
 *
 * A inversão é o que este módulo acrescenta ao cálculo antigo. Numa escala de
 * sintoma, T-score 80 é o pior resultado possível, e normalizar posicionalmente
 * o colocaria no topo do gráfico, ao lado dos melhores desempenhos. Com
 * `inverted`, o eixo é espelhado: 100 é sempre "melhor", em todo instrumento.
 */

import { SCORE_TYPE_DOMAINS } from './score-types'
import type { ScoreType } from './score-types'

/**
 * Faixa esperada, na régua normalizada.
 *
 * 25–75 é o intervalo interquartil da distribuição normativa — a região "dentro
 * do esperado" com que o clínico compara. É desenhada ao fundo dos gráficos
 * como referência, e é o que dá sentido a "contra a norma".
 */
export const EXPECTED_BAND = { min: 25, max: 75 } as const

/**
 * Converte um valor para 0–100, onde 100 é sempre o melhor desempenho.
 *
 * Devolve `null` quando o tipo de escore não tem domínio limitado (escore
 * bruto), porque aí não existe posição relativa a calcular.
 */
export function normalizeScore(
  value: number | null,
  scoreType: ScoreType,
  inverted: boolean
): number | null {
  if (value === null || !Number.isFinite(value)) return null

  const domain = SCORE_TYPE_DOMAINS[scoreType]
  if (domain.min === null || domain.max === null) return null

  const span = domain.max - domain.min
  if (span <= 0) return null

  // Trava no domínio ANTES de calcular a razão, e mede a partir do extremo que
  // corresponde ao pior desempenho. Calcular `1 - razão` para inverter parece
  // equivalente, mas introduz erro de float: um T-score 80 numa escala de
  // sintoma virava 19,999999999999996 em vez de 20.
  const clamped = Math.min(domain.max, Math.max(domain.min, value))
  const ratio = inverted ? (domain.max - clamped) / span : (clamped - domain.min) / span

  return ratio * 100
}

/** Média dos valores normalizados conhecidos. `null` quando não há nenhum. */
export function averageNormalized(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null)
  if (known.length === 0) return null
  return known.reduce((sum, value) => sum + value, 0) / known.length
}
