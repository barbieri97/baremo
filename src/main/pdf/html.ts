/**
 * Construção de HTML para os relatórios (spec §13.4).
 *
 * Campos livres do domínio — nome de paciente, queixa, observações — são
 * escapados, nunca interpolados como HTML. `html` é uma tagged template que
 * escapa por padrão: interpolar sem escapar exige envolver o valor em `raw()`,
 * o que torna cada exceção visível na revisão de código.
 */

/** Marca um trecho já sabidamente seguro (gerado por nós, não pelo usuário). */
export interface SafeHtml {
  readonly __safeHtml: string
}

export function raw(value: string): SafeHtml {
  return { __safeHtml: value }
}

function isSafe(value: unknown): value is SafeHtml {
  return typeof value === 'object' && value !== null && '__safeHtml' in value
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/** Escapa texto para conteúdo de elemento e para valor de atributo entre aspas. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char)
}

type Interpolable = SafeHtml | string | number | boolean | null | undefined | Interpolable[]

function render(value: Interpolable): string {
  if (value === null || value === undefined || value === false) return ''
  if (Array.isArray(value)) return value.map(render).join('')
  if (isSafe(value)) return value.__safeHtml
  return escapeHtml(value)
}

export function html(strings: TemplateStringsArray, ...values: Interpolable[]): SafeHtml {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    out += render(values[i] ?? null) + (strings[i + 1] ?? '')
  }
  return raw(out)
}

export function toString(value: SafeHtml): string {
  return value.__safeHtml
}

/**
 * Valida uma cor vinda do banco antes de entrar num atributo `style`.
 *
 * As cores nascem do cadastro validado, mas um valor que chegasse torto ao
 * banco viraria injeção em CSS. A checagem é barata e fecha o caminho.
 */
export function safeColor(hex: string | null | undefined, fallback = 'transparent'): string {
  if (typeof hex !== 'string') return fallback
  return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex : fallback
}
