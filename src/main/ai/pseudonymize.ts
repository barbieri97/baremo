/**
 * Camada de pseudonimização (spec §10.3).
 *
 * Ligada por padrão. Antes de qualquer envio ao provedor:
 *
 *  - nome completo → iniciais;
 *  - data de nascimento → idade em anos e meses;
 *  - nome de responsável, escola, endereço e contatos → removidos.
 *
 * O conflito aparente com a redação de documentos se resolve pelos tokens do
 * §9.2: o agente escreve `{{paciente.nome}}`, e o editor resolve o token
 * localmente, no processo principal, na hora de exportar. O nome real nunca
 * precisa sair da máquina para o documento sair correto.
 */

import { ageAt, formatAge, today } from '@shared/domain/dates'

export interface PatientLike {
  readonly fullName: string
  readonly birthDate: string | null
  readonly sex: string
  readonly education: string | null
  readonly handedness: string
  readonly guardian: string | null
  readonly contact: string | null
  readonly notes: string | null
}

export interface PseudonymizedPatient {
  readonly initials: string
  readonly age: string | null
  readonly sex: string
  readonly education: string | null
  readonly handedness: string
  readonly notes: string | null
  readonly pseudonymized: true
}

export interface IdentifiedPatient extends Omit<PatientLike, never> {
  readonly pseudonymized: false
}

/**
 * Iniciais a partir do nome completo.
 *
 * Preposições ("de", "da", "dos") ficam de fora: em nome brasileiro elas são
 * ligação, não sobrenome, e incluí-las produziria iniciais que não identificam
 * nem ajudam.
 */
export function initialsOf(fullName: string): string {
  const particles = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'du', 'del', 'della'])

  const letters = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0 && !particles.has(part.toLocaleLowerCase('pt-BR')))
    .map((part) => part[0]?.toLocaleUpperCase('pt-BR') ?? '')
    .filter((letter) => letter.length > 0)

  return letters.length > 0 ? letters.join('.') + '.' : '—'
}

export function pseudonymizePatient(
  patient: PatientLike,
  referenceDate: string | null
): PseudonymizedPatient {
  const reference = referenceDate ?? today()
  const age = patient.birthDate !== null ? ageAt(patient.birthDate, reference) : null

  return {
    initials: initialsOf(patient.fullName),
    age: age !== null ? formatAge(age) : null,
    sex: patient.sex,
    education: patient.education,
    handedness: patient.handedness,
    // As observações clínicas seguem: são o dado que o assistente precisa
    // analisar. Mas passam pelo redator de identificadores abaixo.
    notes: patient.notes !== null ? redactIdentifiers(patient.notes) : null,
    pseudonymized: true
  }
}

export function identifiedPatient(patient: PatientLike): IdentifiedPatient {
  return { ...patient, pseudonymized: false }
}

/**
 * Remove identificadores diretos de texto livre.
 *
 * Campos de observação recebem de tudo — telefone, e-mail, CPF, endereço.
 * Uma redação por padrão não é perfeita, e não substitui o cuidado de quem
 * escreve, mas evita o vazamento mais comum: o dado colado sem pensar.
 */
export function redactIdentifiers(text: string): string {
  return text
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF removido]')
    .replace(/\b(?:\+55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone removido]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail removido]')
    .replace(/\b\d{5}-?\d{3}\b/g, '[CEP removido]')
}

/**
 * Aplica a pseudonimização a texto que já saiu de outra tool (nome de arquivo,
 * título de documento, corpo de documento).
 *
 * Sem isto, a pseudonimização do perfil seria contornada por um documento cujo
 * corpo repete o nome do paciente.
 */
export function scrubText(text: string, patientFullName: string): string {
  const redacted = redactIdentifiers(text)
  const initials = initialsOf(patientFullName)

  const parts = patientFullName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length >= 3)
    .sort((a, b) => b.length - a.length)

  let out = redacted

  // O nome completo primeiro, depois cada parte: substituir por partes antes
  // deixaria o nome inteiro quebrado em iniciais repetidas.
  if (patientFullName.trim().length >= 3) {
    out = replaceAllInsensitive(out, patientFullName.trim(), initials)
  }
  for (const part of parts) {
    out = replaceAllInsensitive(out, part, initials)
  }

  return out
}

function replaceAllInsensitive(haystack: string, needle: string, replacement: string): string {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return haystack.replace(new RegExp(escaped, 'gi'), replacement)
}
