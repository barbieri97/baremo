/**
 * Leitura do 429 do Gemini (spec §10.8 — mensagem específica, nunca genérica).
 *
 * O provedor tem limites POR MODELO e por janela (minuto e dia), além do teto
 * mensal que a tela de cota do projeto mostra. "Minha cota não acabou" e "a API
 * recusou por cota" convivem com frequência — e a única pista de qual limite
 * estourou está no corpo do erro, que o SDK repassa como JSON na mensagem.
 */

export interface QuotaViolation {
  readonly quotaId: string | null
  readonly quotaMetric: string | null
  readonly model: string | null
  /** Valor do limite, como o provedor informa; "0" = modelo fora do plano. */
  readonly limit: string | null
}

export interface RateLimitInfo {
  readonly violations: readonly QuotaViolation[]
  readonly retryAfterSeconds: number | null
  /** Mensagem original do provedor, para a auditoria. */
  readonly providerMessage: string | null
}

/** Extrai do texto do erro o que o provedor disse sobre o limite atingido. */
export function parseRateLimit(raw: string): RateLimitInfo {
  const body = parseJsonBody(raw)
  const error = (body?.['error'] ?? null) as Record<string, unknown> | null
  const details = Array.isArray(error?.['details']) ? (error['details'] as unknown[]) : []

  const violations: QuotaViolation[] = []
  let retryAfterSeconds: number | null = null

  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null) continue
    const record = detail as Record<string, unknown>

    if (Array.isArray(record['violations'])) {
      for (const violation of record['violations'] as Record<string, unknown>[]) {
        const dimensions = (violation['quotaDimensions'] ?? {}) as Record<string, unknown>
        violations.push({
          quotaId: stringOrNull(violation['quotaId']),
          quotaMetric: stringOrNull(violation['quotaMetric']),
          model: stringOrNull(dimensions['model']),
          limit: stringOrNull(violation['quotaValue'])
        })
      }
    }

    const delay = stringOrNull(record['retryDelay'])
    if (delay !== null) retryAfterSeconds = parseSeconds(delay)
  }

  const providerMessage = stringOrNull(error?.['message'])

  // Sem JSON estruturado, a mensagem em texto ainda costuma trazer a espera.
  if (retryAfterSeconds === null) {
    const match = /retry in ([\d.]+)\s*s/i.exec(providerMessage ?? raw)
    if (match) retryAfterSeconds = Math.ceil(Number(match[1]))
  }

  return { violations, retryAfterSeconds, providerMessage }
}

/** Texto para o profissional: qual limite, de qual modelo, e o que fazer. */
export function describeRateLimit(info: RateLimitInfo): string {
  const parts: string[] = []
  const violation = info.violations[0] ?? null

  if (violation === null) {
    parts.push('O provedor recusou por limite de uso (429), sem informar qual limite foi atingido.')
  } else {
    const model = violation.model === null ? '' : ` do modelo ${violation.model}`
    const freeTier = /free/i.test(`${violation.quotaId ?? ''} ${violation.quotaMetric ?? ''}`)

    if (violation.limit === '0') {
      parts.push(
        `O provedor recusou (429): o modelo ${violation.model ?? 'escolhido'} não tem cota disponível para esta chave${freeTier ? ' no nível gratuito' : ''}. Troque o modelo nas configurações ou habilite o faturamento no projeto.`
      )
    } else {
      const window = quotaWindow(violation)
      const kind = quotaKind(violation)
      const limit = violation.limit === null ? '' : ` (limite: ${violation.limit})`
      parts.push(
        `O provedor recusou (429): atingido o limite ${kind}${window}${model}${freeTier ? ', no nível gratuito' : ''}${limit}.`
      )
      if (window === ' por dia') {
        parts.push('Esse limite só volta no dia seguinte; até lá, troque o modelo nas configurações.')
      }
    }
  }

  if (info.retryAfterSeconds !== null) {
    parts.push(`O provedor sugere tentar de novo em ${info.retryAfterSeconds} s.`)
  }

  parts.push(
    'Os limites do Gemini são por modelo e por minuto/dia, independentes do teto mensal do projeto.'
  )
  return parts.join(' ')
}

function quotaWindow(violation: QuotaViolation): string {
  const id = violation.quotaId ?? ''
  if (/PerDay/i.test(id)) return ' por dia'
  if (/PerMinute/i.test(id)) return ' por minuto'
  return ''
}

function quotaKind(violation: QuotaViolation): string {
  const text = `${violation.quotaId ?? ''} ${violation.quotaMetric ?? ''}`
  if (/token/i.test(text)) return 'de tokens de entrada'
  if (/request/i.test(text)) return 'de requisições'
  return 'de uso'
}

function parseJsonBody(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  if (start === -1) return null
  try {
    const parsed: unknown = JSON.parse(raw.slice(start))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parseSeconds(value: string): number | null {
  const match = /^([\d.]+)s$/.exec(value.trim())
  return match ? Math.ceil(Number(match[1])) : null
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number') return String(value)
  return null
}
