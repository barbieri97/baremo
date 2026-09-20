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
 * §7.3 — o laudo desenhado como a tela de resultados.
 *
 * A versão anterior deste relatório era um empilhamento de tabelas: os mesmos
 * dados da tela, na forma que a tela justamente abandonara. Quem abria o PDF
 * depois de olhar o app via dois documentos diferentes sobre o mesmo paciente,
 * e o segundo era o pior — nenhuma leitura por cor, nenhum cartão, nenhum
 * relance.
 *
 * Agora a tela é a especificação, e a ordem é a dela: capa, panorama por função
 * em cartões, detalhe por função, por teste. Os títulos e as notas são os
 * MESMOS textos, palavra por palavra — quando um deles mudar na tela, a
 * divergência precisa ficar visível aqui.
 *
 * O que não é reproduzido é o que não existe no papel: os botões de PNG e SVG,
 * o seletor de tipo de gráfico e as caixas de comparação. Controle impresso é
 * ruído.
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
    ${coverPage(overview)}
    ${
      overview.totalResults === 0
        ? html`<p class="empty">Esta avaliação ainda não possui resultados registrados.</p>`
        : html`
            ${overview.missingLevels > 0 ? missingLevelsNotice(overview) : null}
            ${comparing ? comparisonNote(overview) : null} ${panoramaSection(overview, charts)}
            ${functionDetailSections(overview, charts)} ${testSections(overview, charts)}
            ${anyOverride ? OVERRIDE_NOTE : null}
          `
    }
    ${signature(overview)}
  `

  return toString(body)
}

// ─── Capa ────────────────────────────────────────────────────────────────────

/**
 * A primeira página: quem assina, sobre quem, e o que motivou a avaliação.
 *
 * Existe porque o relatório começava direto no panorama, e um laudo que abre
 * num gráfico obriga o leitor a procurar de quem ele fala. Aqui os campos do
 * prontuário e os da avaliação ficam juntos, numa página que se lê sozinha — e
 * as seguintes ficam livres para serem só os dados.
 *
 * Bloco de texto vazio não é impresso: uma capa com cinco títulos e nada
 * embaixo parece um formulário que ninguém preencheu.
 */
function coverPage(overview: ResultsOverview): SafeHtml {
  const { profile, patient } = overview

  const credentials = [profile.crp && `CRP ${profile.crp}`, profile.specialty]
    .filter(Boolean)
    .join(' · ')
  const contact = [profile.phone, profile.email, profile.address].filter(Boolean).join(' · ')
  const others = otherAssessments(overview)

  return html`
    <section class="cover">
      <header class="cover__letterhead">
        ${
          profile.logoDataUrl
            ? html`<img class="cover__logo" src="${profile.logoDataUrl}" alt="" />`
            : null
        }
        <div class="cover__identity">
          <p class="cover__professional">${profile.name || 'Profissional não identificado'}</p>
          ${credentials ? html`<p class="cover__contact">${credentials}</p>` : null}
          ${contact ? html`<p class="cover__contact">${contact}</p>` : null}
        </div>
      </header>

      <p class="cover__eyebrow">Relatório de resultados</p>
      <h1 class="cover__title">Resultados de ${patient.fullName}</h1>
      <p class="cover__meta">${coverMeta(overview)}</p>

      <section class="cover__block">
        <h2 class="cover__block-title">Paciente</h2>
        <dl class="data-grid">
          ${dataItem('Nome', patient.fullName)} ${dataItem('Data de nascimento', patient.birthDate)}
          ${dataItem('Idade na avaliação', patient.ageAtAssessment)}
          ${dataItem('Sexo', patient.sex)} ${dataItem('Lateralidade', patient.handedness)}
          ${dataItem('Escolaridade', patient.education)}
          ${dataItem('Responsável', patient.guardian)} ${dataItem('Contato', patient.contact)}
        </dl>
      </section>

      <section class="cover__block">
        <h2 class="cover__block-title">Avaliação</h2>
        <dl class="data-grid">
          ${dataItem('Data da avaliação', overview.assessmentDate)}
          ${dataItem('Resultados registrados', String(overview.totalResults))}
          ${others === '' ? null : dataItem('Comparada com', others)}
        </dl>
      </section>

      ${textBlock('Motivo do encaminhamento', overview.referralReason)}
      ${textBlock('Queixa', overview.complaint)}
      ${textBlock('Observações da avaliação', overview.notes)}
      ${textBlock('Observações do paciente', patient.notes)}
    </section>
  `
}

/** A mesma linha de resumo que a tela exibe sob o título (§7.3). */
function coverMeta(overview: ResultsOverview): string {
  const parts = [`Avaliação de ${overview.assessmentDate}`]
  if (overview.patient.ageAtAssessment !== null) parts.push(overview.patient.ageAtAssessment)
  parts.push(`${overview.totalResults} ${overview.totalResults === 1 ? 'resultado' : 'resultados'}`)
  return parts.join(' · ')
}

function otherAssessments(overview: ResultsOverview): string {
  return overview.assessments
    .filter((assessment) => !assessment.isPrimary)
    .map((assessment) => assessment.dateLabel)
    .join(', ')
}

function dataItem(term: string, value: string | null): SafeHtml {
  const filled = value !== null && value.trim() !== ''

  return html`
    <div class="data-grid__item">
      <dt>${term}</dt>
      <dd>${filled ? value : html`<span class="empty">Não informado</span>`}</dd>
    </div>
  `
}

/**
 * Um campo livre da avaliação ou do prontuário.
 *
 * O CSS deste bloco preserva as quebras de linha: o texto foi digitado num
 * `textarea`, e os parágrafos que o profissional separou ali são dele —
 * colapsá-los juntaria numa massa só o que ele escreveu apartado.
 */
function textBlock(title: string, value: string | null): SafeHtml | null {
  if (value === null || value.trim() === '') return null

  return html`
    <section class="cover__block">
      <h2 class="cover__block-title">${title}</h2>
      <p class="cover__text">${value}</p>
    </section>
  `
}

// ─── Panorama por função ─────────────────────────────────────────────────────

function missingLevelsNotice(overview: ResultsOverview): SafeHtml {
  const plural = overview.missingLevels === 1 ? 'resultado está' : 'resultados estão'

  return html`
    <aside class="notice notice--warn">
      <strong>
        ${String(overview.missingLevels)} de ${String(overview.totalResults)} ${plural} sem nível.
      </strong>
      Eles aparecem em cinza, e não entram na média das funções. Defina o nível das faixas em
      Instrumentos e use "Reprocessar classificações" na avaliação para aplicá-lo.
    </aside>
  `
}

function comparisonNote(overview: ResultsOverview): SafeHtml {
  return html`
    <p class="screen-section__note">
      As tabelas e os gráficos comparam a avaliação de ${overview.assessmentDate} com
      ${otherAssessments(overview)}. O panorama e o detalhe por função referem-se apenas à avaliação
      de ${overview.assessmentDate}.
    </p>
  `
}

/** O panorama: a grade de cartões, o radar geral e a legenda da escala. */
function panoramaSection(overview: ResultsOverview, charts: ResultsReportCharts): SafeHtml {
  return html`
    <section class="screen-section">
      <h2 class="screen-section__title">Panorama por função</h2>
      <p class="screen-section__note">
        Ordenado da função mais rebaixada para a mais preservada. O número é o nível médio, de 1
        (muito rebaixado) a 5 (muito acima do esperado).
      </p>

      <div class="card-grid">${overview.functions.map(functionCard)}</div>

      ${
        charts.radar === null
          ? null
          : chartCard('Perfil por função', 'Nível médio, de 1 a 5', charts.radar, true)
      }
      ${levelLegend()}
    </section>
  `
}

/**
 * O cartão de uma função — o mesmo desenho de `FunctionHeatCard.vue`.
 *
 * Três informações, na ordem em que são lidas: a cor do nível médio, que
 * responde antes de qualquer texto; a barra de calor, que diz se o rebaixamento
 * é geral ou de um resultado só; e a contagem do que ficou abaixo do esperado.
 */
function functionCard(summary: FunctionSummary): SafeHtml {
  const background = safeColor(levelColorContinuous(summary.averageLevel), LEVEL_UNKNOWN_HEX)
  const average =
    summary.averageLevel === null
      ? null
      : (Math.round(summary.averageLevel * 10) / 10).toFixed(1).replace('.', ',')

  return html`
    <article class="fn-card">
      <div class="fn-card__head">
        <div class="fn-card__identity">
          <p class="fn-card__name">${summary.name}</p>
          <p class="fn-card__count">
            ${String(summary.points.length)}
            ${summary.points.length === 1 ? 'resultado' : 'resultados'}
          </p>
        </div>
        <span
          class="fn-card__level"
          style="background-color:${raw(background)};color:${raw(readableTextColor(background))}"
          >${average ?? '—'}</span
        >
      </div>

      ${heatBar(summary.distribution)}

      <p class="fn-card__foot${raw(summary.belowExpected > 0 ? ' fn-card__foot--danger' : '')}">
        ${cardFootnote(summary, average)}
      </p>
    </article>
  `
}

function cardFootnote(summary: FunctionSummary, average: string | null): string {
  if (summary.belowExpected > 0) {
    return `${summary.belowExpected} de ${summary.points.length} abaixo do esperado`
  }
  if (average === null) {
    return 'Sem nível cadastrado nas faixas — defina para ver a leitura por cor'
  }
  return 'Nenhum resultado abaixo do esperado'
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
  if (total === 0) return html`<span class="heat-bar"></span>`

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
            safeColor(segment.hex, LEVEL_UNKNOWN_HEX)
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
 * A moldura de um gráfico — o `ChartCard.vue` sem os controles.
 *
 * O SVG vai num bloco próprio para que o `break-inside: avoid` do cartão valha
 * para o conjunto: um título numa página e o polígono na seguinte é pior do que
 * uma página com um vão no fim.
 */
function chartCard(title: string, subtitle: string, svg: string, wide = false): SafeHtml {
  return html`
    <figure class="chart-card${raw(wide ? ' chart-card--wide' : '')}">
      <figcaption class="chart-card__head">
        <p class="chart-card__title">${title}</p>
        <p class="chart-card__subtitle">${subtitle}</p>
      </figcaption>
      <div class="chart-card__canvas">${raw(svg)}</div>
    </figure>
  `
}

// ─── Detalhe por função ──────────────────────────────────────────────────────

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
    <section class="screen-section">
      <h2 class="screen-section__title">Detalhe por função</h2>

      ${overview.functionGroups.map(
        (group) => html`
          <div class="fn-group">
            <div class="fn-group__head">
              <h3 class="fn-group__name">${group.name}</h3>
              <span class="fn-group__bar">${heatBar(group.distribution)}</span>
              <span class="fn-group__count">
                ${String(group.resultCount)} ${group.resultCount === 1 ? 'resultado' : 'resultados'}
              </span>
            </div>

            ${group.radars.map((radar) => {
              const svg =
                radar.parentId === null ? undefined : charts.functionRadars[radar.parentId]
              return svg === undefined
                ? null
                : chartCard(radar.title, 'Nível médio por subfunção, de 1 a 5', svg)
            })}
            ${group.functions.map(functionDetail)}
          </div>
        `
      )}
    </section>
  `
}

function functionDetail(summary: FunctionSummary): SafeHtml {
  return html`
    <div class="fn-detail">
      <div class="fn-detail__head">
        <h4 class="fn-detail__name">${summary.name}</h4>
        <span class="fn-detail__bar">${heatBar(summary.distribution)}</span>
      </div>

      <div class="table-card">
        <table class="grid-table">
          <thead>
            <tr>
              <th>Instrumento</th>
              <th style="width:18mm">Escore</th>
              <th class="numeric" style="width:16mm">Valor</th>
              <th style="width:34mm">Classificação</th>
              <th style="width:32mm">Nível</th>
              <th style="width:20mm">Situação</th>
            </tr>
          </thead>
          <tbody>
            ${summary.points.map(
              (point) => html`
                <tr>
                  <td>${point.instrumentPath}</td>
                  <td class="muted">${point.scoreTypeLabel}</td>
                  <td class="numeric strong">${formatValue(point)}</td>
                  <td>${classificationBadge(point)}</td>
                  <td>${levelChip(point)}</td>
                  <td class="muted">${point.statusLabel}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function levelChip(point: ResultPoint): SafeHtml {
  return html`<span class="level-chip"
    ><span
      class="level-chip__swatch"
      style="background-color:${raw(
        safeColor(levelColor(point.classificationLevel), LEVEL_UNKNOWN_HEX)
      )}"
    ></span
    >${levelLabel(point.classificationLevel)}</span
  >`
}

// ─── Por teste ───────────────────────────────────────────────────────────────

/** Uma seção por teste: a tabela dos subtestes e os gráficos daquele teste. */
function testSections(overview: ResultsOverview, charts: ResultsReportCharts): SafeHtml {
  return html`
    <section class="screen-section page-break-before">
      <h2 class="screen-section__title">Por teste</h2>
      <p class="screen-section__note">
        Os subtestes na régua normalizada de 0 a 100, em que 100 é sempre o melhor desempenho — é o
        que torna comparáveis escores de escalas diferentes.
      </p>

      ${overview.tests.map((group) => {
        const comparison = charts.comparison[group.instrumentId]
        const evolution = charts.evolution[group.instrumentId]

        return html`
          <div class="test-group">
            <div class="table-card">
              <p class="table-card__caption">
                ${group.label}
                ${
                  group.inverted
                    ? html`<span class="table-card__flag">escore alto indica pior desempenho</span>`
                    : null
                }
              </p>
              ${testTable(group, overview)}
            </div>

            ${
              comparison === undefined
                ? null
                : chartCard(
                    `Comparação — ${group.label}`,
                    'Posição na escala, de 0 a 100',
                    comparison
                  )
            }
            ${
              evolution === undefined
                ? null
                : chartCard(
                    `Evolução — ${group.label}`,
                    'Uma linha por subteste, ao longo das avaliações',
                    evolution
                  )
            }
          </div>
        `
      })}
    </section>
  `
}

function testTable(group: TestGroup, overview: ResultsOverview): SafeHtml {
  const comparing = overview.assessments.length > 1

  return html`
    <table class="grid-table">
      <thead>
        <tr>
          <th>Subteste</th>
          <th style="width:18mm">Escore</th>
          ${overview.assessments.map(
            (assessment) =>
              html`<th class="numeric" style="width:24mm">${assessment.dateLabel}</th>`
          )}
          ${comparing ? null : html`<th style="width:36mm">Classificação</th>`}
        </tr>
      </thead>
      <tbody>
        ${group.entries.map(
          (entry) => html`
            <tr>
              <td>${entry.label}</td>
              <td class="muted">${entry.scoreTypeLabel}</td>
              ${entry.values.map(
                (point) =>
                  html`<td class="numeric strong">${point === null ? '—' : formatValue(point)}</td>`
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
