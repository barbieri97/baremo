/**
 * Rótulos PT-BR dos enums do domínio.
 *
 * O código é em inglês e a interface é em português. Este é o único ponto de
 * tradução: a UI e os templates de PDF leem daqui, então um rótulo nunca
 * diverge entre a tela e o documento impresso.
 */

import type { ScoreType } from './domain/score-types'

export const SCORE_TYPE_LABELS: Readonly<Record<ScoreType, string>> = {
  percentile: 'Percentil',
  zScore: 'Escore Z',
  tScore: 'Escore T',
  standardScore: 'Escore padrão (M=100, DP=15)',
  scaledScore: 'Escore ponderado (M=10, DP=3)',
  stanine: 'Stanine',
  decile: 'Decil',
  raw: 'Escore bruto'
}

/** Forma curta, para caber nas colunas das tabelas de relatório. */
export const SCORE_TYPE_SHORT_LABELS: Readonly<Record<ScoreType, string>> = {
  percentile: 'Percentil',
  zScore: 'Z',
  tScore: 'T',
  standardScore: 'Padrão',
  scaledScore: 'Ponderado',
  stanine: 'Stanine',
  decile: 'Decil',
  raw: 'Bruto'
}

export const RESULT_STATUSES = ['applied', 'not_applied', 'interrupted', 'invalid'] as const
export type ResultStatus = (typeof RESULT_STATUSES)[number]

export const RESULT_STATUS_LABELS: Readonly<Record<ResultStatus, string>> = {
  applied: 'Aplicado',
  not_applied: 'Não aplicado',
  interrupted: 'Interrompido',
  invalid: 'Inválido'
}

/** Só `applied` exige valor (§4.8). */
export function requiresValue(status: ResultStatus): boolean {
  return status === 'applied'
}

export const SEXES = ['female', 'male', 'other', 'unspecified'] as const
export type Sex = (typeof SEXES)[number]

export const SEX_LABELS: Readonly<Record<Sex, string>> = {
  female: 'Feminino',
  male: 'Masculino',
  other: 'Outro',
  unspecified: 'Não informado'
}

export const HANDEDNESS = ['right', 'left', 'ambidextrous', 'unspecified'] as const
export type Handedness = (typeof HANDEDNESS)[number]

export const HANDEDNESS_LABELS: Readonly<Record<Handedness, string>> = {
  right: 'Destro',
  left: 'Canhoto',
  ambidextrous: 'Ambidestro',
  unspecified: 'Não informado'
}

/** Documentos previstos na Resolução CFP nº 06/2019, mais devolutiva e encaminhamento. */
export const DOCUMENT_TYPES = [
  'declaration',
  'certificate',
  'psychological_report',
  'technical_opinion',
  'feedback',
  'referral',
  'other'
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const DOCUMENT_TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  declaration: 'Declaração',
  certificate: 'Atestado psicológico',
  psychological_report: 'Relatório / laudo psicológico',
  technical_opinion: 'Parecer técnico',
  feedback: 'Devolutiva',
  referral: 'Encaminhamento',
  other: 'Outro documento'
}

/**
 * Tipos cuja exportação dispara o aviso de assinatura ICP-Brasil (§9.6):
 * são os documentos formais da Res. CFP nº 06/2019.
 */
export const SIGNATURE_NOTICE_TYPES: readonly DocumentType[] = [
  'declaration',
  'certificate',
  'psychological_report',
  'technical_opinion'
]

export const DOCUMENT_STATUSES = ['draft', 'in_review', 'finalized'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

export const DOCUMENT_STATUS_LABELS: Readonly<Record<DocumentStatus, string>> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  finalized: 'Finalizado'
}

export const DOCUMENT_ORIGINS = ['human', 'assisted_by_ai'] as const
export type DocumentOrigin = (typeof DOCUMENT_ORIGINS)[number]

export const DOCUMENT_ORIGIN_LABELS: Readonly<Record<DocumentOrigin, string>> = {
  human: 'Redigido pelo profissional',
  assisted_by_ai: 'Assistido por IA'
}

export const AUDIT_ACTIONS = ['create', 'update', 'archive', 'delete', 'export'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  create: 'Criação',
  update: 'Edição',
  archive: 'Arquivamento',
  delete: 'Exclusão definitiva',
  export: 'Exportação'
}

export const REPORT_KINDS = [
  'by_cognitive_function',
  'by_instrument_hierarchy',
  'document',
  'comparative'
] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const REPORT_KIND_LABELS: Readonly<Record<ReportKind, string>> = {
  by_cognitive_function: 'Relatório por função cognitiva',
  by_instrument_hierarchy: 'Relatório por hierarquia de testes',
  document: 'Documento',
  comparative: 'Relatório comparativo'
}
