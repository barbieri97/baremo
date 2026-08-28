/**
 * Tipos de escore normativo (spec §4.5).
 *
 * Uma tabela dirigida por dados alimenta, ao mesmo tempo: a validação Zod do
 * valor digitado, as constraints do input na UI, a checagem de cobertura das
 * faixas de classificação e as mensagens de erro. Acrescentar um tipo de escore
 * é acrescentar uma entrada aqui.
 */

export const SCORE_TYPES = [
  'percentile',
  'zScore',
  'tScore',
  'standardScore',
  'scaledScore',
  'stanine',
  'decile',
  'raw'
] as const

export type ScoreType = (typeof SCORE_TYPES)[number]

export interface ScoreTypeDomain {
  /** Limite inferior do domínio; `null` para escore bruto, que é livre. */
  readonly min: number | null
  /** Limite superior do domínio; `null` para escore bruto. */
  readonly max: number | null
  /** Casas decimais aceitas. 0 = apenas inteiros. */
  readonly decimals: number
  /**
   * Escore bruto não recebe classificação automática (§4.5) — não faz sentido
   * cadastrar faixas normativas para ele.
   */
  readonly autoClassify: boolean
}

export const SCORE_TYPE_DOMAINS: Readonly<Record<ScoreType, ScoreTypeDomain>> = {
  percentile: { min: 0, max: 100, decimals: 1, autoClassify: true },
  zScore: { min: -5, max: 5, decimals: 2, autoClassify: true },
  tScore: { min: 0, max: 100, decimals: 1, autoClassify: true },
  standardScore: { min: 40, max: 160, decimals: 0, autoClassify: true },
  scaledScore: { min: 1, max: 19, decimals: 0, autoClassify: true },
  stanine: { min: 1, max: 9, decimals: 0, autoClassify: true },
  decile: { min: 1, max: 10, decimals: 0, autoClassify: true },
  raw: { min: null, max: null, decimals: 2, autoClassify: false }
}

/** Domínio limitado — permite estreitar o tipo antes de validar faixas. */
export interface BoundedScoreTypeDomain extends ScoreTypeDomain {
  readonly min: number
  readonly max: number
  readonly autoClassify: true
}

export function isBounded(domain: ScoreTypeDomain): domain is BoundedScoreTypeDomain {
  return domain.min !== null && domain.max !== null && domain.autoClassify
}

/**
 * Escala usada para comparar valores como inteiros.
 *
 * Comparar floats na fronteira de uma faixa (`valor < max`) é onde a aritmética
 * binária morde: `0.1 + 0.2 !== 0.3`, e um percentil 30,0 digitado poderia cair
 * na faixa errada. Todas as comparações de faixa passam por `toScaled`, que
 * arredonda para a precisão declarada do tipo de escore e converte para inteiro.
 * Duas casas cobrem o tipo mais preciso (z-score).
 */
const SCALE = 100

/** Converte um valor para o inteiro escalado usado nas comparações de faixa. */
export function toScaled(value: number, scoreType: ScoreType): number {
  const { decimals } = SCORE_TYPE_DOMAINS[scoreType]
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return Math.round(rounded * SCALE)
}

/** Menor incremento representável no tipo de escore, já escalado. */
export function scaledStep(scoreType: ScoreType): number {
  const { decimals } = SCORE_TYPE_DOMAINS[scoreType]
  return Math.round(SCALE / 10 ** decimals)
}

export interface ScoreValidationError {
  readonly code: 'out_of_range' | 'too_precise'
  readonly message: string
}

/**
 * Valida um valor contra o domínio do tipo de escore (§4.5).
 * Retorna `null` quando o valor é aceitável.
 */
export function validateScoreValue(
  value: number,
  scoreType: ScoreType
): ScoreValidationError | null {
  const domain = SCORE_TYPE_DOMAINS[scoreType]

  if (!Number.isFinite(value)) {
    return { code: 'out_of_range', message: 'O valor precisa ser um número.' }
  }

  if (domain.min !== null && value < domain.min) {
    return {
      code: 'out_of_range',
      message: `Valor abaixo do mínimo do tipo de escore (${formatBound(domain.min)}).`
    }
  }

  if (domain.max !== null && value > domain.max) {
    return {
      code: 'out_of_range',
      message: `Valor acima do máximo do tipo de escore (${formatBound(domain.max)}).`
    }
  }

  const factor = 10 ** domain.decimals
  if (Math.abs(value * factor - Math.round(value * factor)) > 1e-9) {
    return {
      code: 'too_precise',
      message:
        domain.decimals === 0
          ? 'Este tipo de escore aceita apenas números inteiros.'
          : `Este tipo de escore aceita no máximo ${domain.decimals} casa(s) decimal(is).`
    }
  }

  return null
}

function formatBound(value: number): string {
  return String(value).replace('.', ',')
}
