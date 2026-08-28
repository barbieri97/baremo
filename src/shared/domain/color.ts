/**
 * Contraste de cor (spec §5).
 *
 * Toda cor exibida em relatório pode acabar como fundo de texto. A verificação
 * AA acontece no cadastro e é um aviso NÃO bloqueante: o usuário decide, mas
 * decide sabendo.
 */

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const HEX_PATTERN = /^#([0-9a-f]{6})$/i

/** Aceita apenas `#RRGGBB`. Forma curta é normalizada antes de chegar aqui. */
export function isValidHex(hex: string): boolean {
  return HEX_PATTERN.test(hex)
}

/** Normaliza `#abc` → `#AABBCC` e uniformiza a caixa. */
export function normalizeHex(input: string): string | null {
  const trimmed = input.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed)
  if (short) {
    const [r, g, b] = short[1]!.split('') as [string, string, string]
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  return HEX_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null
}

export function hexToRgb(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec(hex.trim())
  if (!match) return null
  const int = Number.parseInt(match[1]!, 16)
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff }
}

/** Luminância relativa conforme WCAG 2.1. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Razão de contraste WCAG entre duas cores; vai de 1 a 21. */
export function contrastRatio(a: string, b: string): number | null {
  const rgbA = hexToRgb(a)
  const rgbB = hexToRgb(b)
  if (!rgbA || !rgbB) return null

  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)

  return (lighter + 0.05) / (darker + 0.05)
}

export const WHITE = '#FFFFFF'
export const BLACK = '#111111'

/**
 * Escolhe preto ou branco para o texto sobre `background`, pegando o que der
 * mais contraste. É assim que as células coloridas dos relatórios continuam
 * legíveis sem o usuário ter de configurar cor de texto.
 */
export function readableTextColor(background: string): string {
  const onWhite = contrastRatio(background, WHITE) ?? 0
  const onBlack = contrastRatio(background, BLACK) ?? 0
  return onBlack >= onWhite ? BLACK : WHITE
}

export interface ContrastCheck {
  readonly ratio: number
  readonly textColor: string
  /** AA para texto normal exige 4.5:1. */
  readonly passesAA: boolean
  /** AA para texto grande (≥18pt, ou ≥14pt em negrito) exige 3:1. */
  readonly passesAALarge: boolean
}

export function checkContrast(background: string): ContrastCheck | null {
  const textColor = readableTextColor(background)
  const ratio = contrastRatio(background, textColor)
  if (ratio === null) return null

  return {
    ratio: Math.round(ratio * 100) / 100,
    textColor,
    passesAA: ratio >= 4.5,
    passesAALarge: ratio >= 3
  }
}
