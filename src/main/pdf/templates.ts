/**
 * Templates dos relatórios (spec §7).
 *
 * Funções puras: view-model entra, `SafeHtml` sai. Nenhum acesso a banco ou a
 * filesystem — o que torna cada template testável isoladamente e mantém o
 * escape concentrado em `pdf/html.ts`.
 */

import { html, raw, safeColor, toString } from './html'
import type { SafeHtml } from './html'
import type { ComparativeReport, ReportContext } from '../services/reports'
import type { ResultRow } from '../repositories/assessments'
import { SCORE_TYPE_SHORT_LABELS } from '@shared/labels'
import { readableTextColor } from '@shared/domain/color'
import { SCORE_TYPE_DOMAINS } from '@shared/domain/score-types'
import type { ScoreType } from '@shared/domain/score-types'
import {
  CLASSIFICATION_LEVELS,
  levelColor,
  levelColorContinuous,
  levelLabel,
  LEVEL_UNKNOWN_HEX
} from '@shared/domain/levels'
import type { LevelDistribution } from '@shared/domain/levels'
import type {
  FunctionSummary,
  ResultPoint,
  ResultsOverview,
  TestGroup
} from '@shared/contracts/results'

function documentHeader(context: ReportContext, title: string): SafeHtml {
  const { profile } = context

  return html`
    <header class="doc-header">
      ${
        profile.logoDataUrl
          ? html`<img class="doc-header__logo" src="${profile.logoDataUrl}" alt="" />`
          : null
      }
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
        <div>
          <dt>Paciente</dt>
          <dd>${context.patient.fullName}</dd>
        </div>
        <div>
          <dt>Data da avaliação</dt>
          <dd>${context.assessmentDate}</dd>
        </div>
        <div>
          <dt>Idade na avaliação</dt>
          <dd>${context.patient.ageAtAssessment ?? 'Não informada'}</dd>
        </div>
        <div>
          <dt>Data de nascimento</dt>
          <dd>${context.patient.birthDate ?? 'Não informada'}</dd>
        </div>
        <div>
          <dt>Sexo</dt>
          <dd>${context.patient.sex}</dd>
        </div>
        <div>
          <dt>Lateralidade</dt>
          <dd>${context.patient.handedness}</dd>
        </div>
        <div>
          <dt>Escolaridade</dt>
          <dd>${context.patient.education ?? 'Não informada'}</dd>
        </div>
      </dl>
    </section>

    ${
      context.referralReason
        ? html`<section class="section avoid-break">
            <h2 class="section__title">Motivo do encaminhamento</h2>
            <p>${context.referralReason}</p>
          </section>`
        : null
    }
    ${
      context.complaint
        ? html`<section class="section avoid-break">
            <h2 class="section__title">Queixa</h2>
            <p>${context.complaint}</p>
          </section>`
        : null
    }
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

/** A forma mínima de que o badge precisa — serve `ResultRow` e `ResultPoint`. */
interface ClassifiedLike {
  readonly classificationName: string | null
  readonly colorHex: string | null
  readonly manuallyOverridden: boolean
}

function classificationBadge(result: ClassifiedLike): SafeHtml {
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

function formatValue(result: { value: number | null; scoreType: ScoreType }): string {
  if (result.value === null) return '—'
  const decimals = SCORE_TYPE_DOMAINS[result.scoreType].decimals
  return result.value.toFixed(decimals).replace('.', ',')
}

const OVERRIDE_NOTE = html`
  <p class="section__note">
    * Classificação definida manualmente pelo profissional, sobrescrevendo a faixa cadastrada.
  </p>
`

/** §7.1.4 — duas avaliações lado a lado, com delta de classificação. */
export function renderComparativeReport(report: ComparativeReport): string {
  const body = html`
    ${documentHeader(report, 'Relatório Comparativo')}
    <p class="section__note">
      Comparação entre a avaliação de ${report.assessmentDate} (A) e a de ${report.assessmentDateB}
      (B).
    </p>
    ${
      report.rows.length === 0
        ? html`<p class="empty">Não há resultados comparáveis entre as duas avaliações.</p>`
        : null
    }
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
                      ${
                        SCORE_TYPE_SHORT_LABELS[
                          entry.scoreType as keyof typeof SCORE_TYPE_SHORT_LABELS
                        ] ?? entry.scoreType
                      }
                    </td>
                    <td class="numeric">${entry.a ? formatValue(entry.a) : '—'}</td>
                    <td>
                      ${entry.a ? classificationBadge(entry.a) : html`<span class="empty">—</span>`}
                    </td>
                    <td class="numeric">${entry.b ? formatValue(entry.b) : '—'}</td>
                    <td>
                      ${entry.b ? classificationBadge(entry.b) : html`<span class="empty">—</span>`}
                    </td>
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

// ─── Relatório de resultados (§7.3) ──────────────────────────────────────────

/**
 * Os gráficos já renderizados, em SVG.
 *
 * Chegam prontos porque este módulo é puro: quem desenha é `pdf/charts.ts`, com
 * o ECharts em modo SSR. Manter o template sem essa dependência é o que permite
 * testá-lo sem instanciar biblioteca de gráfico nenhuma.
 */
export interface ResultsReportCharts {
  /** O radar geral, comparando as funções raiz. */
  readonly radar: string | null
  /** Radar das filhas, por `parentId` da função pai. */
  readonly functionRadars: Readonly<Record<string, string>>
  /** Por `instrumentId` da raiz do teste. */
  readonly comparison: Readonly<Record<string, string>>
  readonly evolution: Readonly<Record<string, string>>
}

/**
 * §7.3 — o relatório que substituiu os dois anteriores.
 *
 * Os antigos eram a mesma tabela reorganizada, e nenhum dos dois respondia à
 * pergunta que se faz ao abrir um laudo: como está este paciente? Aqui as duas
 * organizações convivem — panorama e detalhe por função, depois por teste — e o
 * documento abre pela leitura de relance, não pela listagem.
 */
export function renderResultsReport(
  overview: ResultsOverview,
  charts: ResultsReportCharts
): string {
  const comparing = overview.assessments.length > 1
  const anyOverride = overview.functions.some((summary) =>
    summary.points.some((point) => point.manuallyOverridden)
  )

  const body = html`
    ${documentHeader(overview, 'Relatório de Resultados')}
    ${
      overview.totalResults === 0
        ? html`<p class="empty">Esta avaliação ainda não possui resultados registrados.</p>`
        : html`
            ${comparing ? comparisonNote(overview) : null}
            ${panoramaSection(overview, charts.radar)} ${functionDetailSections(overview, charts)}
            ${testSections(overview, charts)} ${anyOverride ? OVERRIDE_NOTE : null}
            ${overview.missingLevels > 0 ? missingLevelsNote(overview) : null}
          `
    }
    ${
      overview.notes
        ? html`<section class="section">
            <h2 class="section__title">Observações</h2>
            <p>${overview.notes}</p>
          </section>`
        : null
    }
    ${signature(overview)}
  `

  return toString(body)
}

function comparisonNote(overview: ResultsOverview): SafeHtml {
  const others = overview.assessments
    .filter((assessment) => !assessment.isPrimary)
    .map((assessment) => assessment.dateLabel)
    .join(', ')

  return html`
    <p class="section__note">
      As tabelas e os gráficos comparam a avaliação de ${overview.assessmentDate} com ${others}. O
      panorama e o detalhe por função referem-se apenas à avaliação de ${overview.assessmentDate}.
    </p>
  `
}

function missingLevelsNote(overview: ResultsOverview): SafeHtml {
  return html`
    <p class="section__note">
      ${String(overview.missingLevels)} de ${String(overview.totalResults)} resultados não têm nível
      definido na faixa de classificação. Eles aparecem em cinza e não entram na média das funções.
    </p>
  `
}

/** O panorama: a tabela-resumo e, ao lado, o radar. */
function panoramaSection(overview: ResultsOverview, radar: string | null): SafeHtml {
  return html`
    <section class="section avoid-break">
      <h2 class="section__title">Panorama por função</h2>
      <p class="section__note">
        Da função mais rebaixada para a mais preservada. O nível vai de 1 (muito rebaixado) a 5
        (muito acima do esperado).
      </p>

      <div class="panorama">
        <table class="panorama__table">
          <thead>
            <tr>
              <th>Função cognitiva</th>
              <th style="width:16mm">Resultados</th>
              <th style="width:28mm">Nível médio</th>
              <th style="width:30mm">Distribuição</th>
              <th style="width:18mm">Abaixo</th>
            </tr>
          </thead>
          <tbody>
            ${overview.functions.map(
              (summary) => html`
                <tr>
                  <td>${summary.name}</td>
                  <td class="numeric">${String(summary.points.length)}</td>
                  <td>${levelCell(summary)}</td>
                  <td>${heatBar(summary.distribution)}</td>
                  <td class="numeric">
                    ${
                      summary.belowExpected > 0
                        ? html`<strong>${String(summary.belowExpected)}</strong>`
                        : '—'
                    }
                  </td>
                </tr>
              `
            )}
          </tbody>
        </table>

        ${radar !== null ? html`<figure class="chart-figure">${raw(radar)}</figure>` : null}
      </div>

      ${levelLegend()}
    </section>
  `
}

function levelCell(summary: FunctionSummary): SafeHtml {
  if (summary.averageLevel === null) {
    return html`<span class="level-badge" style="background-color:${raw(LEVEL_UNKNOWN_HEX)}"
      >Sem nível</span
    >`
  }

  const background = safeColor(levelColorContinuous(summary.averageLevel), '#e2e8f0')
  const nearest = Math.round(summary.averageLevel) as 1 | 2 | 3 | 4 | 5
  const value = (Math.round(summary.averageLevel * 10) / 10).toFixed(1).replace('.', ',')

  return html`<span
    class="level-badge"
    style="background-color:${raw(background)};color:${raw(readableTextColor(background))}"
    >${value} · ${levelLabel(nearest)}</span
  >`
}

/**
 * Barra de calor em `span`s de largura proporcional.
 *
 * Não é um gráfico: são dezenas destas no documento, e cada uma como SVG do
 * ECharts custaria uma instância. Marcação com largura percentual imprime igual
 * e não depende de medição de texto.
 */
function heatBar(distribution: LevelDistribution): SafeHtml {
  const total =
    CLASSIFICATION_LEVELS.reduce((sum, entry) => sum + distribution[entry.level], 0) +
    distribution.unknown
  if (total === 0) return html`<span class="empty">—</span>`

  const segments = [
    ...CLASSIFICATION_LEVELS.map((entry) => ({
      count: distribution[entry.level],
      hex: entry.hex
    })),
    { count: distribution.unknown, hex: LEVEL_UNKNOWN_HEX }
  ].filter((segment) => segment.count > 0)

  return html`<span class="heat-bar"
    >${segments.map(
      (segment) =>
        html`<span
          class="heat-bar__part"
          style="width:${raw(((segment.count / total) * 100).toFixed(2))}%;background-color:${raw(
            safeColor(segment.hex, '#a0aec0')
          )}"
          >&nbsp;</span
        >`
    )}</span
  >`
}

function levelLegend(): SafeHtml {
  return html`<p class="legend">
    ${CLASSIFICATION_LEVELS.map(
      (entry) =>
        html`<span class="legend__item"
          ><span class="legend__swatch" style="background-color:${raw(entry.hex)}"></span
          >${String(entry.level)} · ${entry.label}</span
        >`
    )}
  </p>`
}

/**
 * O detalhe, agrupado por função raiz.
 *
 * A hierarquia é o ponto: o radar de uma função pai compara as filhas dela, e
 * só faz sentido lido junto das tabelas dessas filhas. Uma lista plana
 * obrigaria o leitor a reconstruir a árvore de cabeça para saber a que o
 * polígono se refere — e um pai sem instrumentos próprios não teria sequer onde
 * ser desenhado.
 */
function functionDetailSections(overview: ResultsOverview, charts: ResultsReportCharts): SafeHtml {
  return html`
    <h2 class="section__title">Detalhe por função</h2>
    ${overview.functionGroups.map(
      (group) => html`
        <div class="section">
          <h3 class="section__subtitle">${group.name}</h3>
          ${group.radars.map((radar) => {
            const svg = radar.parentId === null ? undefined : charts.functionRadars[radar.parentId]
            return svg === undefined
              ? null
              : html`<figure class="chart-figure avoid-break">
                  ${raw(svg)}
                  <figcaption class="chart-figure__caption">
                    ${radar.title} — nível médio por subfunção
                  </figcaption>
                </figure>`
          })}
          ${group.functions.map(
            (summary) => html`
              <div class="function-block avoid-break">
                <h4 class="function-block__title">${summary.name}</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Instrumento</th>
                      <th style="width:16mm">Escore</th>
                      <th style="width:14mm">Valor</th>
                      <th style="width:30mm">Classificação</th>
                      <th style="width:30mm">Nível</th>
                      <th style="width:20mm">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${summary.points.map(
                      (point) => html`
                        <tr>
                          <td>${point.instrumentPath}</td>
                          <td>${point.scoreTypeLabel}</td>
                          <td class="numeric">${formatValue(point)}</td>
                          <td>${classificationBadge(point)}</td>
                          <td>${levelInline(point)}</td>
                          <td>${point.statusLabel}</td>
                        </tr>
                      `
                    )}
                  </tbody>
                </table>
              </div>
            `
          )}
        </div>
      `
    )}
  `
}

function levelInline(point: ResultPoint): SafeHtml {
  return html`<span class="level-inline"
    ><span
      class="legend__swatch"
      style="background-color:${raw(safeColor(levelColor(point.classificationLevel), '#a0aec0'))}"
    ></span
    >${levelLabel(point.classificationLevel)}</span
  >`
}

/** Uma seção por teste: a tabela dos subtestes e os gráficos daquele teste. */
function testSections(overview: ResultsOverview, charts: ResultsReportCharts): SafeHtml {
  return html`
    <h2 class="section__title page-break-before">Por teste</h2>
    <p class="section__note">
      Os gráficos usam a régua normalizada de 0 a 100, em que 100 é sempre o melhor desempenho — é o
      que torna comparáveis escores de escalas diferentes.
    </p>
    ${overview.tests.map((group) => {
      const comparison = charts.comparison[group.instrumentId]
      const evolution = charts.evolution[group.instrumentId]

      return html`
        <div class="section">
          <h3 class="section__subtitle">
            ${group.label}${group.inverted ? ' — escore alto indica pior desempenho' : ''}
          </h3>
          ${testTable(group, overview)}
          ${
            comparison !== undefined
              ? html`<figure class="chart-figure avoid-break">
                  ${raw(comparison)}
                  <figcaption class="chart-figure__caption">
                    Comparação entre os subtestes, na posição da escala.
                  </figcaption>
                </figure>`
              : null
          }
          ${
            evolution !== undefined
              ? html`<figure class="chart-figure avoid-break">
                  ${raw(evolution)}
                  <figcaption class="chart-figure__caption">
                    Evolução de cada subteste ao longo das avaliações.
                  </figcaption>
                </figure>`
              : null
          }
        </div>
      `
    })}
  `
}

function testTable(group: TestGroup, overview: ResultsOverview): SafeHtml {
  const comparing = overview.assessments.length > 1

  return html`
    <table>
      <thead>
        <tr>
          <th>Subteste</th>
          <th style="width:16mm">Escore</th>
          ${overview.assessments.map(
            (assessment) => html`<th style="width:20mm">${assessment.dateLabel}</th>`
          )}
          ${comparing ? null : html`<th style="width:34mm">Classificação</th>`}
        </tr>
      </thead>
      <tbody>
        ${group.entries.map(
          (entry) => html`
            <tr>
              <td>${entry.label}</td>
              <td>${entry.scoreTypeLabel}</td>
              ${entry.values.map(
                (point) =>
                  html`<td class="numeric">${point === null ? '—' : formatValue(point)}</td>`
              )}
              ${
                comparing
                  ? null
                  : html`<td>
                      ${
                        entry.values[0] != null
                          ? classificationBadge(entry.values[0])
                          : html`<span class="empty">—</span>`
                      }
                    </td>`
              }
            </tr>
          `
        )}
      </tbody>
    </table>
  `
}
