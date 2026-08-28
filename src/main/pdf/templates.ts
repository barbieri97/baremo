/**
 * Templates dos relatórios (spec §7).
 *
 * Funções puras: view-model entra, `SafeHtml` sai. Nenhum acesso a banco ou a
 * filesystem — o que torna cada template testável isoladamente e mantém o
 * escape concentrado em `pdf/html.ts`.
 */

import { html, raw, safeColor, toString } from './html'
import type { SafeHtml } from './html'
import type {
  ComparativeReport,
  FunctionReport,
  InstrumentReport,
  ReportContext,
  ReportTreeRow
} from '../services/reports'
import type { ResultRow } from '../repositories/assessments'
import { RESULT_STATUS_LABELS, SCORE_TYPE_SHORT_LABELS } from '@shared/labels'
import { readableTextColor } from '@shared/domain/color'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'

function documentHeader(context: ReportContext, title: string): SafeHtml {
  const { profile } = context

  return html`
    <header class="doc-header">
      ${profile.logoDataUrl
        ? html`<img class="doc-header__logo" src="${profile.logoDataUrl}" alt="" />`
        : null}
      <div class="doc-header__identity">
        <p class="doc-header__name">${profile.name || 'Profissional não identificado'}</p>
        <p class="doc-header__meta">
          ${[profile.crp && `CRP ${profile.crp}`, profile.specialty].filter(Boolean).join(' · ')}
        </p>
        <p class="doc-header__meta">
          ${[profile.phone, profile.email, profile.address].filter(Boolean).join(' · ')}
        </p>
      </div>
    </header>

    <h1 class="doc-title">${title}</h1>

    <section class="patient-card avoid-break">
      <dl>
        <div><dt>Paciente</dt><dd>${context.patient.fullName}</dd></div>
        <div><dt>Data da avaliação</dt><dd>${context.assessmentDate}</dd></div>
        <div>
          <dt>Idade na avaliação</dt>
          <dd>${context.patient.ageAtAssessment ?? 'Não informada'}</dd>
        </div>
        <div>
          <dt>Data de nascimento</dt>
          <dd>${context.patient.birthDate ?? 'Não informada'}</dd>
        </div>
        <div><dt>Sexo</dt><dd>${context.patient.sex}</dd></div>
        <div><dt>Lateralidade</dt><dd>${context.patient.handedness}</dd></div>
        <div><dt>Escolaridade</dt><dd>${context.patient.education ?? 'Não informada'}</dd></div>
      </dl>
    </section>

    ${context.referralReason
      ? html`<section class="section avoid-break">
          <h2 class="section__title">Motivo do encaminhamento</h2>
          <p>${context.referralReason}</p>
        </section>`
      : null}
    ${context.complaint
      ? html`<section class="section avoid-break">
          <h2 class="section__title">Queixa</h2>
          <p>${context.complaint}</p>
        </section>`
      : null}
  `
}

function signature(context: ReportContext): SafeHtml {
  return html`
    <div class="signature">
      <div class="signature__line"></div>
      <p class="signature__name">${context.profile.name || ' '}</p>
      <p class="signature__meta">${context.profile.crp ? `CRP ${context.profile.crp}` : ''}</p>
    </div>
  `
}

function classificationBadge(result: ResultRow): SafeHtml {
  if (result.classificationName === null) {
    return html`<span class="empty">—</span>`
  }

  const background = safeColor(result.colorHex, '#e2e8f0')
  // O texto escolhe preto ou branco pelo contraste (§5), para a célula colorida
  // continuar legível qualquer que seja a cor cadastrada.
  const color = readableTextColor(background)

  return html`<span
    class="classification"
    style="background-color:${raw(background)};color:${raw(color)}"
    >${result.classificationName}${result.manuallyOverridden ? ' *' : ''}</span
  >`
}

function formatValue(result: ResultRow): string {
  if (result.value === null) return '—'
  const decimals = SCORE_TYPE_DOMAINS[result.scoreType].decimals
  return result.value.toFixed(decimals).replace('.', ',')
}

function resultRows(results: readonly ResultRow[], showInstrument: boolean): SafeHtml {
  return html`${results.map(
    (result) => html`
      <tr>
        ${showInstrument
          ? html`<td>
              ${result.instrumentName}${result.instrumentAcronym
                ? ` (${result.instrumentAcronym})`
                : ''}
            </td>`
          : null}
        <td>${SCORE_TYPE_SHORT_LABELS[result.scoreType]}</td>
        <td class="numeric">${formatValue(result)}</td>
        <td>${classificationBadge(result)}</td>
        <td>${RESULT_STATUS_LABELS[result.status]}</td>
        <td>${result.notes ?? ''}</td>
      </tr>
    `
  )}`
}

const RESULT_TABLE_HEAD = html`
  <thead>
    <tr>
      <th>Instrumento</th>
      <th>Escore</th>
      <th style="width:14mm">Valor</th>
      <th style="width:32mm">Classificação</th>
      <th style="width:22mm">Situação</th>
      <th>Observação</th>
    </tr>
  </thead>
`

function treeSection(rows: readonly ReportTreeRow[]): SafeHtml {
  return html`${rows.map((row) => {
    const indent = Math.min(row.depth, 4)
    return html`
      <div class="section">
        <h2 class="section__title ${raw(`indent-${indent}`)}">${row.label}</h2>
        ${row.results.length === 0
          ? html`<p class="section__note">Sem resultados diretamente associados.</p>`
          : html`<table>
              ${RESULT_TABLE_HEAD}
              <tbody>
                ${resultRows(row.results, true)}
              </tbody>
            </table>`}
      </div>
    `
  })}`
}

const OVERRIDE_NOTE = html`
  <p class="section__note">
    * Classificação definida manualmente pelo profissional, sobrescrevendo a faixa cadastrada.
  </p>
`

function hasOverride(rows: readonly ReportTreeRow[]): boolean {
  return rows.some((row) => row.results.some((result) => result.manuallyOverridden))
}

/** §7.1.1 — organiza pela árvore de funções e subfunções. */
export function renderFunctionReport(report: FunctionReport): string {
  const body = html`
    ${documentHeader(report, 'Relatório por Função Cognitiva')}
    ${report.rows.length === 0 && report.unassigned.length === 0
      ? html`<p class="empty">Esta avaliação ainda não possui resultados registrados.</p>`
      : null}
    ${treeSection(report.rows)}
    ${report.unassigned.length > 0
      ? html`<div class="section">
          <h2 class="section__title">Sem função cognitiva associada</h2>
          <p class="section__note">
            Instrumentos ainda não vinculados a uma função cognitiva no cadastro.
          </p>
          <table>
            ${RESULT_TABLE_HEAD}
            <tbody>
              ${resultRows(report.unassigned, true)}
            </tbody>
          </table>
        </div>`
      : null}
    ${hasOverride(report.rows) ||
    report.unassigned.some((result) => result.manuallyOverridden)
      ? OVERRIDE_NOTE
      : null}
    ${report.notes
      ? html`<section class="section">
          <h2 class="section__title">Observações</h2>
          <p>${report.notes}</p>
        </section>`
      : null}
    ${signature(report)}
  `

  return toString(body)
}

/** §7.1.2 — agrupa pela estrutura psicométrica original. */
export function renderInstrumentReport(report: InstrumentReport): string {
  const body = html`
    ${documentHeader(report, 'Relatório por Hierarquia de Testes')}
    ${report.rows.length === 0
      ? html`<p class="empty">Esta avaliação ainda não possui resultados registrados.</p>`
      : null}
    ${report.rows.map((row) => {
      const indent = Math.min(row.depth, 4)
      return html`
        <div class="section">
          <h2 class="section__title ${raw(`indent-${indent}`)}">${row.label}</h2>
          ${row.results.length === 0
            ? html`<p class="section__note">Nó de agrupamento, sem escore próprio.</p>`
            : html`<table>
                <thead>
                  <tr>
                    <th>Escore</th>
                    <th style="width:14mm">Valor</th>
                    <th style="width:32mm">Classificação</th>
                    <th style="width:22mm">Situação</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  ${resultRows(row.results, false)}
                </tbody>
              </table>`}
        </div>
      `
    })}
    ${hasOverride(report.rows) ? OVERRIDE_NOTE : null}
    ${report.notes
      ? html`<section class="section">
          <h2 class="section__title">Observações</h2>
          <p>${report.notes}</p>
        </section>`
      : null}
    ${signature(report)}
  `

  return toString(body)
}

/** §7.1.4 — duas avaliações lado a lado, com delta de classificação. */
export function renderComparativeReport(report: ComparativeReport): string {
  const body = html`
    ${documentHeader(report, 'Relatório Comparativo')}
    <p class="section__note">
      Comparação entre a avaliação de ${report.assessmentDate} (A) e a de
      ${report.assessmentDateB} (B).
    </p>
    ${report.rows.length === 0
      ? html`<p class="empty">Não há resultados comparáveis entre as duas avaliações.</p>`
      : null}
    ${report.rows.map((row) => {
      const indent = Math.min(row.depth, 4)
      return html`
        <div class="section">
          <h2 class="section__title ${raw(`indent-${indent}`)}">${row.label}</h2>
          <table>
            <thead>
              <tr>
                <th>Instrumento</th>
                <th style="width:18mm">Escore</th>
                <th style="width:14mm">A</th>
                <th style="width:32mm">Classificação A</th>
                <th style="width:14mm">B</th>
                <th style="width:32mm">Classificação B</th>
                <th style="width:20mm">Variação</th>
              </tr>
            </thead>
            <tbody>
              ${row.entries.map(
                (entry) => html`
                  <tr>
                    <td>${entry.instrumentName}</td>
                    <td>
                      ${SCORE_TYPE_SHORT_LABELS[
                        entry.scoreType as keyof typeof SCORE_TYPE_SHORT_LABELS
                      ] ?? entry.scoreType}
                    </td>
                    <td class="numeric">${entry.a ? formatValue(entry.a) : '—'}</td>
                    <td>${entry.a ? classificationBadge(entry.a) : html`<span class="empty">—</span>`}</td>
                    <td class="numeric">${entry.b ? formatValue(entry.b) : '—'}</td>
                    <td>${entry.b ? classificationBadge(entry.b) : html`<span class="empty">—</span>`}</td>
                    <td>${deltaCell(entry.a, entry.b)}</td>
                  </tr>
                `
              )}
            </tbody>
          </table>
        </div>
      `
    })}
    ${signature(report)}
  `

  return toString(body)
}

/**
 * Variação entre duas medidas do mesmo instrumento e tipo de escore.
 *
 * Reporta a diferença numérica bruta e diz se a classificação mudou. Não afirma
 * "melhorou" nem "piorou": a direção depende da escala — em escala de sintomas,
 * subir é piorar — e essa leitura é do profissional, não do app.
 */
function deltaCell(a: ResultRow | null, b: ResultRow | null): SafeHtml {
  if (a === null || b === null || a.value === null || b.value === null) {
    return html`<span class="empty">—</span>`
  }

  const decimals = SCORE_TYPE_DOMAINS[a.scoreType].decimals
  const difference = b.value - a.value
  const formatted = `${difference > 0 ? '+' : ''}${difference.toFixed(decimals).replace('.', ',')}`
  const changed = a.classificationName !== b.classificationName

  return html`<span class="${raw(changed ? 'delta-worse' : 'delta-same')}"
    >${formatted}${changed ? ' (classificação alterada)' : ''}</span
  >`
}
