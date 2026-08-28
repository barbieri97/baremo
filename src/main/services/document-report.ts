/**
 * Montagem do documento para exportação (spec §9).
 *
 * Reúne o contexto do paciente, resolve os tokens e serializa o JSON do TipTap.
 * Os nós dinâmicos — `bloco-resultados` e `bloco-grafico` — são resolvidos AQUI,
 * lendo o banco no momento da renderização (§9.2): o JSON guarda só a referência
 * à avaliação, não os dados, então um documento reaberto meses depois mostra os
 * resultados como estão gravados, sem cópia paralela para divergir.
 */

import { eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { documents, patients } from '../db/schema'
import { notFound } from '../ipc/register'
import { getProfile } from '../repositories/config'
import { getAssessment, listResults } from '../repositories/assessments'
import type { ResultRow } from '../repositories/assessments'
import { listCognitiveFunctions } from '../repositories/trees'
import { serializeDocument } from '../pdf/serialize'
import type { SerializeContext } from '../pdf/serialize'
import { escapeHtml, html, raw, safeColor, toString } from '../pdf/html'
import { ageAt, formatAge, formatIsoDate } from '@shared/domain/dates'
import { readableTextColor } from '@shared/domain/color'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import {
  DOCUMENT_TYPE_LABELS,
  RESULT_STATUS_LABELS,
  SCORE_TYPE_SHORT_LABELS,
  SIGNATURE_NOTICE_TYPES
} from '@shared/labels'
import type { DocumentType } from '@shared/labels'

export interface DocumentReport {
  readonly title: string
  readonly typeLabel: string
  readonly requiresSignatureNotice: boolean
  readonly patient: { readonly fullName: string }
  readonly contentHtml: string
}

export function buildDocumentReport(
  handle: BaremoDatabase,
  documentId: string
): DocumentReport {
  const document = handle.db.select().from(documents).where(eq(documents.id, documentId)).get()
  if (!document) throw notFound('Documento não encontrado.')

  const patient = handle.db
    .select()
    .from(patients)
    .where(eq(patients.id, document.patientId))
    .get()
  if (!patient) throw notFound('Paciente do documento não encontrado.')

  const profile = getProfile(handle)
  const assessment =
    document.assessmentId !== null ? getAssessment(handle, document.assessmentId) : null

  const referenceDate = assessment?.date ?? null
  const age =
    patient.birthDate !== null && referenceDate !== null
      ? ageAt(patient.birthDate, referenceDate)
      : null

  const tokens: Readonly<Record<string, string | null>> = {
    'paciente.nome': patient.fullName,
    'paciente.data_nascimento':
      patient.birthDate !== null ? formatIsoDate(patient.birthDate) : null,
    'paciente.idade_na_avaliacao': age !== null ? formatAge(age) : null,
    'paciente.escolaridade': patient.education,
    'paciente.responsavel': patient.guardian,
    'avaliacao.data': referenceDate !== null ? formatIsoDate(referenceDate) : null,
    'avaliacao.motivo': assessment?.referralReason ?? null,
    'profissional.nome': profile.name || null,
    'profissional.crp': profile.crp || null,
    'profissional.especialidade': profile.specialty || null
  }

  const context: SerializeContext = {
    resolveToken: (token) => tokens[token] ?? null,

    renderResultsBlock: (attrs) => {
      const assessmentId =
        typeof attrs['assessmentId'] === 'string' ? attrs['assessmentId'] : document.assessmentId
      if (assessmentId === null) return toString(missingBlock('Nenhuma avaliação vinculada.'))

      const cognitiveFunctionId =
        typeof attrs['cognitiveFunctionId'] === 'string' ? attrs['cognitiveFunctionId'] : null

      return renderResultsTable(handle, assessmentId, cognitiveFunctionId)
    },

    renderChartBlock: (attrs) => {
      const assessmentId =
        typeof attrs['assessmentId'] === 'string' ? attrs['assessmentId'] : document.assessmentId
      if (assessmentId === null) return toString(missingBlock('Nenhuma avaliação vinculada.'))
      return renderProfileChart(handle, assessmentId)
    },

    renderSignature: () =>
      toString(html`
        <div class="signature">
          <div class="signature__line"></div>
          <p class="signature__name">${profile.name || ' '}</p>
          <p class="signature__meta">${profile.crp ? `CRP ${profile.crp}` : ''}</p>
        </div>
      `)
  }

  return {
    title: document.title,
    typeLabel: DOCUMENT_TYPE_LABELS[document.type as DocumentType] ?? 'Documento',
    requiresSignatureNotice: SIGNATURE_NOTICE_TYPES.includes(document.type as DocumentType),
    patient: { fullName: patient.fullName },
    contentHtml: serializeDocument(parseContent(document.contentJson), context)
  }
}

function parseContent(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function missingBlock(message: string): ReturnType<typeof html> {
  return html`<p class="empty">${message}</p>`
}

function formatValue(value: number | null, scoreType: ScoreType): string {
  if (value === null) return '—'
  return value.toFixed(SCORE_TYPE_DOMAINS[scoreType].decimals).replace('.', ',')
}

/** Tabela do `bloco-resultados`, com as cores das faixas (§9.2). */
function renderResultsTable(
  handle: BaremoDatabase,
  assessmentId: string,
  cognitiveFunctionId: string | null
): string {
  const all = listResults(handle, assessmentId)
  const rows =
    cognitiveFunctionId === null
      ? all
      : all.filter((result) => result.cognitiveFunctionId === cognitiveFunctionId)

  if (rows.length === 0) {
    return toString(missingBlock('Nenhum resultado registrado para este recorte.'))
  }

  return toString(html`
    <table class="results-block">
      <thead>
        <tr>
          <th>Instrumento</th>
          <th>Função cognitiva</th>
          <th>Escore</th>
          <th>Valor</th>
          <th>Classificação</th>
          <th>Situação</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((result) => {
          const background = safeColor(result.colorHex, '#e2e8f0')
          return html`
            <tr>
              <td>
                ${result.instrumentName}${result.instrumentAcronym
                  ? ` (${result.instrumentAcronym})`
                  : ''}
              </td>
              <td>${result.cognitiveFunctionName ?? '—'}</td>
              <td>${SCORE_TYPE_SHORT_LABELS[result.scoreType]}</td>
              <td class="numeric">${formatValue(result.value, result.scoreType)}</td>
              <td>
                ${result.classificationName === null
                  ? html`<span class="empty">—</span>`
                  : html`<span
                      class="classification"
                      style="background-color:${raw(background)};color:${raw(
                        readableTextColor(background)
                      )}"
                      >${result.classificationName}</span
                    >`}
              </td>
              <td>${RESULT_STATUS_LABELS[result.status]}</td>
            </tr>
          `
        })}
      </tbody>
    </table>
  `)
}

/**
 * Gráfico de perfil por função cognitiva (§9.2), como SVG gerado à mão.
 *
 * Sem biblioteca de charting: a janela de impressão roda com `default-src
 * 'none'` e sem JavaScript, então o gráfico precisa já chegar desenhado.
 */
function renderProfileChart(handle: BaremoDatabase, assessmentId: string): string {
  const points = computeProfile(handle, assessmentId)
  if (points.length === 0) {
    return toString(missingBlock('Sem resultados suficientes para o gráfico de perfil.'))
  }

  const barHeight = 18
  const gap = 8
  const labelWidth = 150
  const chartWidth = 320
  const height = points.length * (barHeight + gap) + 24
  const width = labelWidth + chartWidth + 40

  const bars = points
    .map((point, index) => {
      const y = index * (barHeight + gap) + 16
      const length = Math.max(2, Math.round((point.normalized / 100) * chartWidth))
      return `
        <text x="0" y="${y + barHeight * 0.72}" font-size="9" fill="#2d3748">${escapeHtml(
          truncate(point.cognitiveFunctionName, 28)
        )}</text>
        <rect x="${labelWidth}" y="${y}" width="${chartWidth}" height="${barHeight}" fill="#edf2f7" />
        <rect x="${labelWidth}" y="${y}" width="${length}" height="${barHeight}" fill="#2b6cb0" />
        <text x="${labelWidth + length + 6}" y="${y + barHeight * 0.72}" font-size="8.5" fill="#4a5568">${escapeHtml(
          `${point.normalized.toFixed(0)}`
        )}</text>`
    })
    .join('')

  // Escala de referência: as marcas de percentil que orientam a leitura.
  const guides = [25, 50, 75]
    .map((percent) => {
      const x = labelWidth + (percent / 100) * chartWidth
      return `<line x1="${x}" y1="8" x2="${x}" y2="${height - 8}" stroke="#cbd5e0" stroke-width="0.5" stroke-dasharray="2 2" />`
    })
    .join('')

  return `<svg class="profile-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img">
    ${guides}${bars}
  </svg>`
}

interface ProfilePoint {
  readonly cognitiveFunctionName: string
  readonly normalized: number
  readonly sampleCount: number
}

/**
 * Normaliza tipos de escore diferentes numa escala 0–100 para poderem aparecer
 * no mesmo gráfico.
 *
 * A conversão é posicional dentro do domínio de cada tipo, e não estatística:
 * não é equivalência psicométrica, e o gráfico serve para leitura de perfil, não
 * para comparação de magnitude entre instrumentos.
 */
export function computeProfile(
  handle: BaremoDatabase,
  assessmentId: string
): ProfilePoint[] {
  const results = listResults(handle, assessmentId)
  const functions = listCognitiveFunctions(handle)
  const nameById = new Map(functions.map((node) => [node.id, node.name]))

  const buckets = new Map<string, number[]>()

  for (const result of results) {
    if (result.value === null || result.cognitiveFunctionId === null) continue

    const normalized = normalize(result)
    if (normalized === null) continue

    const name = nameById.get(result.cognitiveFunctionId)
    if (name === undefined) continue

    const bucket = buckets.get(name)
    if (bucket) bucket.push(normalized)
    else buckets.set(name, [normalized])
  }

  return [...buckets.entries()]
    .map(([cognitiveFunctionName, values]) => ({
      cognitiveFunctionName,
      normalized: values.reduce((sum, value) => sum + value, 0) / values.length,
      sampleCount: values.length
    }))
    .sort((a, b) => a.cognitiveFunctionName.localeCompare(b.cognitiveFunctionName, 'pt-BR'))
}

function normalize(result: ResultRow): number | null {
  const domain = SCORE_TYPE_DOMAINS[result.scoreType]
  if (result.value === null || domain.min === null || domain.max === null) return null

  const span = domain.max - domain.min
  if (span <= 0) return null

  const ratio = (result.value - domain.min) / span
  return Math.min(100, Math.max(0, ratio * 100))
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
