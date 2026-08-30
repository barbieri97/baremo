/**
 * Faixas de classificação (spec §4.6).
 *
 * Convenção de limites: `[valorMin, valorMax)` — mínimo inclusivo, máximo
 * exclusivo. A ÚLTIMA faixa da série (a de maior `valorMax`) é `[min, max]`,
 * com máximo inclusivo, para que o topo do domínio do tipo de escore seja
 * classificável.
 *
 * Faixas invertidas — escalas em que valor alto indica pior desempenho, como
 * escalas de sintomas em T-score — não mudam nada na RESOLUÇÃO: continuam sendo
 * as mesmas faixas numéricas com outros nomes. Mas mudam a LEITURA, e por isso
 * o conjunto carrega `inverted`: é o que impede o panorama por função de pintar
 * de verde um escore alto de sintoma. Quem usa a flag é a normalização
 * (`normalize.ts`) e a sugestão de níveis (`levels.ts`), não `resolveRange`.
 *
 * Tudo aqui é função pura, sem I/O: é o que permite que os testes de fronteira
 * do §15.1 rodem direto, sem banco.
 */

import { isBounded, SCORE_TYPE_DOMAINS, scaledStep, toScaled } from './score-types'
import type { ScoreType } from './score-types'
import type { ClassificationLevel } from './levels'

/** Uma faixa, no formato mínimo de que a resolução precisa. */
export interface RangeLike {
  readonly id: string
  readonly classificationName: string
  readonly minValue: number
  readonly maxValue: number
  readonly colorHex: string
  readonly version: number
  readonly level: ClassificationLevel | null
  readonly inverted: boolean
}

/**
 * Encontra a faixa que contém `value`, aplicando `[min, max)` com a última
 * faixa inclusiva no topo.
 *
 * Retorna `null` quando nenhuma faixa cobre o valor — o que só deve acontecer
 * se o conjunto estiver incompleto, já que `validateRangeSet` exige cobertura
 * total antes de permitir o cadastro.
 */
export function resolveRange<T extends RangeLike>(
  value: number,
  ranges: readonly T[],
  scoreType: ScoreType
): T | null {
  if (ranges.length === 0) return null

  const scaled = toScaled(value, scoreType)
  const topScaled = Math.max(...ranges.map((r) => toScaled(r.maxValue, scoreType)))

  for (const range of ranges) {
    const min = toScaled(range.minValue, scoreType)
    const max = toScaled(range.maxValue, scoreType)
    const isTopRange = max === topScaled

    if (scaled >= min && (scaled < max || (isTopRange && scaled === max))) {
      return range
    }
  }

  return null
}

export type RangeIssueCode =
  | 'empty'
  | 'inverted_bounds'
  | 'overlap'
  | 'gap'
  | 'below_domain'
  | 'above_domain'
  | 'uncovered_start'
  | 'uncovered_end'
  | 'not_classifiable'

export interface RangeIssue {
  readonly code: RangeIssueCode
  readonly message: string
  /** Faixas envolvidas, para a UI destacar as linhas problemáticas. */
  readonly rangeIds: readonly string[]
}

/**
 * Valida o conjunto completo de faixas de um par `instrumento + tipo de escore`
 * (§4.6): sem sobreposição, sem lacuna, e cobrindo as duas extremidades do
 * domínio do tipo de escore.
 */
export function validateRangeSet(ranges: readonly RangeLike[], scoreType: ScoreType): RangeIssue[] {
  const issues: RangeIssue[] = []
  const domain = SCORE_TYPE_DOMAINS[scoreType]

  if (!domain.autoClassify) {
    return [
      {
        code: 'not_classifiable',
        message: 'Escore bruto não recebe classificação automática e não aceita faixas.',
        rangeIds: ranges.map((r) => r.id)
      }
    ]
  }

  if (ranges.length === 0) {
    return [
      {
        code: 'empty',
        message: 'Nenhuma faixa cadastrada para este instrumento e tipo de escore.',
        rangeIds: []
      }
    ]
  }

  for (const range of ranges) {
    if (toScaled(range.minValue, scoreType) >= toScaled(range.maxValue, scoreType)) {
      issues.push({
        code: 'inverted_bounds',
        message: `A faixa "${range.classificationName}" tem mínimo maior ou igual ao máximo.`,
        rangeIds: [range.id]
      })
    }
  }

  if (isBounded(domain)) {
    const domainMin = toScaled(domain.min, scoreType)
    const domainMax = toScaled(domain.max, scoreType)

    for (const range of ranges) {
      if (toScaled(range.minValue, scoreType) < domainMin) {
        issues.push({
          code: 'below_domain',
          message: `A faixa "${range.classificationName}" começa abaixo do mínimo do tipo de escore.`,
          rangeIds: [range.id]
        })
      }
      if (toScaled(range.maxValue, scoreType) > domainMax) {
        issues.push({
          code: 'above_domain',
          message: `A faixa "${range.classificationName}" termina acima do máximo do tipo de escore.`,
          rangeIds: [range.id]
        })
      }
    }
  }

  // Sobreposição e lacuna só fazem sentido em faixas bem-formadas.
  const sorted = ranges
    .filter((r) => toScaled(r.minValue, scoreType) < toScaled(r.maxValue, scoreType))
    .slice()
    .sort((a, b) => toScaled(a.minValue, scoreType) - toScaled(b.minValue, scoreType))

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!
    const current = sorted[i]!
    const previousMax = toScaled(previous.maxValue, scoreType)
    const currentMin = toScaled(current.minValue, scoreType)

    if (currentMin < previousMax) {
      issues.push({
        code: 'overlap',
        message: `As faixas "${previous.classificationName}" e "${current.classificationName}" se sobrepõem.`,
        rangeIds: [previous.id, current.id]
      })
    } else if (currentMin > previousMax) {
      // Com `[min, max)`, faixas contíguas se encostam: max de uma == min da
      // seguinte. Qualquer distância acima disso deixa valores sem classificação.
      issues.push({
        code: 'gap',
        message: `Há valores sem classificação entre "${previous.classificationName}" e "${current.classificationName}".`,
        rangeIds: [previous.id, current.id]
      })
    }
  }

  if (isBounded(domain) && sorted.length > 0) {
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!

    if (toScaled(first.minValue, scoreType) > toScaled(domain.min, scoreType)) {
      issues.push({
        code: 'uncovered_start',
        message: `Valores a partir de ${formatValue(domain.min)} ficam sem classificação: a primeira faixa começa em ${formatValue(first.minValue)}.`,
        rangeIds: [first.id]
      })
    }

    if (toScaled(last.maxValue, scoreType) < toScaled(domain.max, scoreType)) {
      issues.push({
        code: 'uncovered_end',
        message: `Valores até ${formatValue(domain.max)} ficam sem classificação: a última faixa termina em ${formatValue(last.maxValue)}.`,
        rangeIds: [last.id]
      })
    }
  }

  return issues
}

/**
 * Sugere o próximo `minValue` ao acrescentar uma faixa — o cadastro fica
 * contíguo por construção, em vez de depender do usuário acertar o encaixe.
 */
export function suggestNextMin(ranges: readonly RangeLike[], scoreType: ScoreType): number {
  const domain = SCORE_TYPE_DOMAINS[scoreType]
  if (ranges.length === 0) return domain.min ?? 0
  return Math.max(...ranges.map((r) => r.maxValue))
}

/** Fim do domínio, escalado — usado pela UI para fechar a última faixa. */
export function domainEnd(scoreType: ScoreType): number | null {
  return SCORE_TYPE_DOMAINS[scoreType].max
}

/** Texto legível de uma faixa, respeitando a inclusividade do topo da série. */
export function describeRange(
  range: RangeLike,
  ranges: readonly RangeLike[],
  scoreType: ScoreType
): string {
  const max = toScaled(range.maxValue, scoreType)
  const topScaled = Math.max(...ranges.map((r) => toScaled(r.maxValue, scoreType)))
  const upperBracket = max === topScaled ? ']' : '['
  return `[${formatValue(range.minValue)}, ${formatValue(range.maxValue)}${upperBracket}`
}

function formatValue(value: number): string {
  return String(value).replace('.', ',')
}

/** Exposto para os testes de fronteira: passo mínimo do tipo de escore. */
export { scaledStep }
