/**
 * Datas do domínio.
 *
 * Datas de nascimento e de avaliação são datas civis, não instantes: guardá-las
 * como `YYYY-MM-DD` em texto evita que o fuso do sistema empurre um aniversário
 * um dia para trás na exportação. Nenhuma conversão para `Date` com hora.
 */

export type IsoDate = string // YYYY-MM-DD

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false

  return day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export interface Age {
  readonly years: number
  readonly months: number
  readonly days: number
}

/**
 * Idade em anos, meses e dias na data de referência.
 *
 * É o que a pseudonimização (§10.3) envia no lugar da data de nascimento, e o
 * que o token `{{paciente.idade_na_avaliacao}}` resolve — por isso vive no
 * domínio compartilhado, e não em cada consumidor.
 */
export function ageAt(birthDate: IsoDate, referenceDate: IsoDate): Age | null {
  if (!isIsoDate(birthDate) || !isIsoDate(referenceDate)) return null

  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number]
  const [ry, rm, rd] = referenceDate.split('-').map(Number) as [number, number, number]

  if (ry < by || (ry === by && (rm < bm || (rm === bm && rd < bd)))) return null

  let years = ry - by
  let months = rm - bm
  let days = rd - bd

  if (days < 0) {
    months -= 1
    // Dias do mês anterior ao de referência.
    days += daysInMonth(rm === 1 ? ry - 1 : ry, rm === 1 ? 12 : rm - 1)
  }
  if (months < 0) {
    years -= 1
    months += 12
  }

  return { years, months, days }
}

/** "34 anos e 2 meses" — o formato usado em laudo e no envio pseudonimizado. */
export function formatAge(age: Age): string {
  const years = `${age.years} ${age.years === 1 ? 'ano' : 'anos'}`
  if (age.months === 0) return years
  return `${years} e ${age.months} ${age.months === 1 ? 'mês' : 'meses'}`
}

/** `2026-08-28` → `28/08/2026`. */
export function formatIsoDate(date: IsoDate): string {
  if (!isIsoDate(date)) return date
  const [year, month, day] = date.split('-') as [string, string, string]
  return `${day}/${month}/${year}`
}

/** Data civil de hoje no fuso local, em ISO. */
export function today(): IsoDate {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
