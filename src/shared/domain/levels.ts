/**
 * Nível de classificação — a ordem que a faixa não tinha (spec §4.6).
 *
 * `classification_name` é texto livre, escolhido por instrumento: "Média
 * inferior" num teste, "Rebaixado" em outro, "Risco clínico" num terceiro. Isso
 * é correto — o nome é o do manual —, mas deixa o app sem saber o que é bom e o
 * que é ruim, e sem isso não existe leitura por cor: nem panorama por função,
 * nem gráfico que mostre de relance onde o desempenho caiu.
 *
 * A ordem também não pode ser inferida de `min_value`. Em escala de sintoma,
 * valor alto é PIOR, e ordenar por valor inverteria a leitura exatamente nos
 * instrumentos em que o erro é mais grave.
 *
 * Daí o nível: um ordinal de 1 a 5 escolhido no cadastro da faixa, gravado no
 * snapshot do resultado como qualquer outra coluna da classificação (ADR-004).
 *
 * São CINCO níveis de propósito, e não um por faixa. Um instrumento com 7 faixas
 * e outro com 3 precisam ser comparáveis na mesma barra de calor — é o que
 * permite dizer "memória está mais rebaixada que linguagem" quando cada função
 * foi medida com testes de granularidade diferente.
 */

export type ClassificationLevel = 1 | 2 | 3 | 4 | 5

export interface LevelDefinition {
  readonly level: ClassificationLevel
  readonly label: string
  /** Rótulo curto, para caber em legenda de gráfico e cabeçalho de tabela. */
  readonly shortLabel: string
  readonly hex: string
}

/**
 * Os hexes são os mesmos da paleta semeada em `src/main/db/seed.ts`, para que a
 * escala converse visualmente com as cores das faixas — mas são constantes
 * próprias, e não uma leitura da tabela `colors`: a paleta é editável pelo
 * usuário, e o significado desta escala não pode depender disso.
 */
export const CLASSIFICATION_LEVELS: readonly LevelDefinition[] = [
  { level: 1, label: 'Muito rebaixado', shortLabel: 'Muito baixo', hex: '#C53030' },
  { level: 2, label: 'Rebaixado', shortLabel: 'Baixo', hex: '#DD6B20' },
  { level: 3, label: 'Dentro do esperado', shortLabel: 'Esperado', hex: '#ECC94B' },
  { level: 4, label: 'Acima do esperado', shortLabel: 'Acima', hex: '#48BB78' },
  { level: 5, label: 'Muito acima do esperado', shortLabel: 'Muito acima', hex: '#2F855A' }
] as const

/** Cor de um resultado ainda sem nível — cinza neutro, nunca verde nem vermelho. */
export const LEVEL_UNKNOWN_HEX = '#a0aec0'

const BY_LEVEL = new Map(CLASSIFICATION_LEVELS.map((entry) => [entry.level, entry]))

export function isClassificationLevel(value: unknown): value is ClassificationLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
}

/**
 * Estreita o INTEGER solto que vem do banco para o tipo do domínio.
 *
 * Qualquer valor fora de 1–5 vira `null` em vez de vazar como nível inválido:
 * um banco editado à mão não deve conseguir pintar uma função de verde.
 */
export function toClassificationLevel(value: unknown): ClassificationLevel | null {
  return isClassificationLevel(value) ? value : null
}

export function levelDefinition(level: ClassificationLevel): LevelDefinition {
  // O Map é construído da constante acima, então a chave sempre existe; o
  // fallback existe só para não precisar de `!` e sobreviver a um cast externo.
  return BY_LEVEL.get(level) ?? CLASSIFICATION_LEVELS[2]!
}

export function levelLabel(level: ClassificationLevel | null): string {
  return level === null ? 'Sem nível definido' : levelDefinition(level).label
}

export function levelColor(level: ClassificationLevel | null): string {
  return level === null ? LEVEL_UNKNOWN_HEX : levelDefinition(level).hex
}

/**
 * Cor de um nível médio, que é fracionário.
 *
 * Interpola entre as cores dos dois níveis vizinhos, para que a diferença entre
 * uma função com média 2,1 e outra com 2,9 apareça — arredondar as duas para 2
 * apagaria justamente a distinção que o panorama existe para mostrar.
 */
export function levelColorContinuous(average: number | null): string {
  if (average === null || Number.isNaN(average)) return LEVEL_UNKNOWN_HEX

  const clamped = Math.min(5, Math.max(1, average))
  const lower = Math.floor(clamped)
  const ratio = clamped - lower
  if (ratio === 0 || lower === 5) return levelColor(lower as ClassificationLevel)

  return mixHex(
    levelColor(lower as ClassificationLevel),
    levelColor((lower + 1) as ClassificationLevel),
    ratio
  )
}

/** Média dos níveis conhecidos. `null` quando nenhum resultado tem nível. */
export function aggregateLevel(levels: readonly (ClassificationLevel | null)[]): number | null {
  const known = levels.filter(isClassificationLevel)
  if (known.length === 0) return null
  return known.reduce((sum, level) => sum + level, 0) / known.length
}

export type LevelDistribution = Record<ClassificationLevel, number> & { unknown: number }

export function levelDistribution(
  levels: readonly (ClassificationLevel | null)[]
): LevelDistribution {
  const distribution: LevelDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 }
  for (const level of levels) {
    if (isClassificationLevel(level)) distribution[level] += 1
    else distribution.unknown += 1
  }
  return distribution
}

/** Quantos resultados caíram abaixo do esperado — o número que o clínico procura. */
export function countBelowExpected(levels: readonly (ClassificationLevel | null)[]): number {
  return levels.filter((level) => isClassificationLevel(level) && level <= 2).length
}

/**
 * Sugere os níveis de um conjunto de N faixas já ordenadas por `minValue`.
 *
 * Distribui 1–5 proporcionalmente, com as pontas nos extremos: 3 faixas viram
 * 1-3-5, 7 faixas viram 1-2-2-3-4-4-5. É sugestão, não regra — a UI preenche a
 * coluna e o usuário ajusta. Existe porque sem ela a funcionalidade nasceria
 * inerte: o nível teria de ser digitado faixa a faixa, instrumento a
 * instrumento, antes que qualquer visualização mostrasse alguma coisa.
 */
export function suggestLevels(rangeCount: number, inverted: boolean): ClassificationLevel[] {
  if (rangeCount <= 0) return []
  if (rangeCount === 1) return [3]

  const levels: ClassificationLevel[] = []
  for (let index = 0; index < rangeCount; index++) {
    const position = Math.round((index * 4) / (rangeCount - 1)) + 1
    levels.push(Math.min(5, Math.max(1, position)) as ClassificationLevel)
  }

  // Numa escala invertida, a faixa de maior valor é a pior: a mesma série, lida
  // de trás para frente.
  return inverted ? levels.reverse() : levels
}

function mixHex(from: string, to: string, ratio: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  if (a === null || b === null) return from

  const channel = (index: number): string =>
    Math.round(a[index]! + (b[index]! - a[index]!) * ratio)
      .toString(16)
      .padStart(2, '0')

  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function parseHex(hex: string): [number, number, number] | null {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return null
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16)
  ]
}
