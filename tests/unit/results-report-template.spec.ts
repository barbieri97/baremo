/**
 * Template do relatório de resultados (spec §7.3).
 *
 * O relatório passou a reproduzir a tela — capa, cartões, barras de calor,
 * gráficos emoldurados — e isso trocou tabela por marcação. Uma tabela errada
 * salta aos olhos; um cartão que perde a cor de fundo, ou um bloco da capa que
 * some porque o campo chegou vazio, não salta. Daí estes testes.
 *
 * Dois deles não são sobre layout, e são os mais importantes:
 *
 *  - o do escape, porque nome de paciente e queixa são texto livre digitado por
 *    gente e vão para dentro de HTML;
 *  - o do `sanitizeBody`, porque o DOMPurify é a última coisa entre o template
 *    e a página impressa. Uma mudança de configuração que passasse a derrubar
 *    `figure` ou o atributo `style` esvaziaria o laudo em silêncio: o PDF
 *    continuaria saindo, só que sem gráfico e sem cor.
 */

import { describe, expect, it } from 'vitest'
import { renderResultsReport } from '../../src/main/pdf/templates'
import type { ResultsReportCharts } from '../../src/main/pdf/templates'
import { sanitizeBody } from '../../src/main/pdf/document-html'
import type {
  FunctionSummary,
  ResultPoint,
  ResultsOverview
} from '../../src/shared/contracts/results'

function point(overrides: Partial<ResultPoint> = {}): ResultPoint {
  return {
    resultId: '11111111-1111-4111-8111-111111111111',
    assessmentId: '22222222-2222-4222-8222-222222222222',
    instrumentId: '33333333-3333-4333-8333-333333333333',
    instrumentName: 'Dígitos',
    instrumentAcronym: null,
    instrumentPath: 'Escala Wechsler › Dígitos',
    scoreType: 'percentile',
    scoreTypeLabel: 'Pc',
    value: 12,
    normalized: 12,
    classificationName: 'Muito rebaixado',
    colorHex: '#C53030',
    classificationLevel: 1,
    status: 'applied',
    statusLabel: 'Aplicado',
    manuallyOverridden: false,
    notes: null,
    cognitiveFunctionId: '66666666-6666-4666-8666-666666666666',
    cognitiveFunctionName: 'Memória de trabalho',
    ...overrides
  }
}

const REBAIXADA: FunctionSummary = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Memória de trabalho',
  depth: 1,
  points: [point()],
  averageLevel: 1,
  averageNormalized: 12,
  distribution: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 },
  belowExpected: 1
}

const PRESERVADA: FunctionSummary = {
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Linguagem',
  depth: 0,
  points: [point({ classificationLevel: 4, classificationName: 'Média superior', value: 78 })],
  averageLevel: 4,
  averageNormalized: 78,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0, unknown: 0 },
  belowExpected: 0
}

/** Média fracionária: é ela que exerce a vírgula e a cor interpolada. */
const FRACIONARIA: FunctionSummary = {
  ...PRESERVADA,
  id: '88888888-8888-4888-8888-888888888888',
  name: 'Atenção',
  averageLevel: 1.66,
  belowExpected: 0
}

function overview(overrides: Partial<ResultsOverview> = {}): ResultsOverview {
  return {
    profile: {
      name: 'Dra. Helena Prado',
      crp: '06/123456',
      specialty: 'Neuropsicologia',
      phone: '(11) 90000-0000',
      email: 'helena@exemplo.test',
      address: 'Rua das Acácias, 100',
      logoDataUrl: null
    },
    patient: {
      fullName: 'Joana Ribeiro de Almeida',
      birthDate: '22/04/1987',
      ageAtAssessment: '38 anos e 9 meses',
      sex: 'Feminino',
      education: 'Ensino superior completo',
      handedness: 'Destro',
      guardian: 'Marcos Ribeiro de Almeida',
      contact: '(11) 98888-7777',
      notes: 'Hipotireoidismo em tratamento.'
    },
    assessmentId: '22222222-2222-4222-8222-222222222222',
    assessmentDate: '18/02/2026',
    referralReason: 'Encaminhada pela neurologista.',
    complaint: 'Refere esquecer compromissos recentes.',
    notes: 'Avaliação em duas sessões.',
    assessments: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        date: '2026-02-18',
        dateLabel: '18/02/2026',
        isPrimary: true
      }
    ],
    functions: [REBAIXADA, FRACIONARIA, PRESERVADA],
    overallRadar: null,
    functionGroups: [
      {
        rootId: '99999999-9999-4999-8999-999999999999',
        name: 'Memória',
        averageLevel: 1,
        distribution: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 },
        belowExpected: 1,
        resultCount: 1,
        radars: [],
        functions: [REBAIXADA]
      }
    ],
    tests: [],
    missingLevels: 0,
    totalResults: 3,
    ...overrides
  }
}

const NO_CHARTS: ResultsReportCharts = {
  radar: null,
  functionRadars: {},
  comparison: {},
  evolution: {}
}

describe('capa', () => {
  it('traz os dados do prontuário e da avaliação', () => {
    const html = renderResultsReport(overview(), NO_CHARTS)

    expect(html).toContain('Resultados de Joana Ribeiro de Almeida')
    expect(html).toContain('22/04/1987')
    expect(html).toContain('38 anos e 9 meses')
    expect(html).toContain('Ensino superior completo')
    // Os três campos que o relatório não recebia antes desta mudança.
    expect(html).toContain('Marcos Ribeiro de Almeida')
    expect(html).toContain('(11) 98888-7777')
    expect(html).toContain('Hipotireoidismo em tratamento.')
    // Texto livre da avaliação, que antes ficava espalhado pelo documento.
    expect(html).toContain('Encaminhada pela neurologista.')
    expect(html).toContain('Refere esquecer compromissos recentes.')
    expect(html).toContain('Avaliação em duas sessões.')
  })

  it('omite o bloco de um campo livre vazio em vez de imprimir o título sozinho', () => {
    const html = renderResultsReport(
      overview({ complaint: null, notes: '   ', referralReason: null }),
      NO_CHARTS
    )

    expect(html).not.toContain('Queixa')
    expect(html).not.toContain('Observações da avaliação')
    expect(html).not.toContain('Motivo do encaminhamento')
  })

  it('marca como não informado o campo do prontuário que ficou em branco', () => {
    const base = overview()
    const html = renderResultsReport(
      { ...base, patient: { ...base.patient, guardian: null, education: null } },
      NO_CHARTS
    )

    // O rótulo continua: a ausência de escolaridade é informação clínica.
    expect(html).toContain('Escolaridade')
    expect(html).toContain('Não informado')
  })
})

describe('panorama', () => {
  it('emite um cartão por função', () => {
    const html = renderResultsReport(overview(), NO_CHARTS)
    expect(html.match(/class="fn-card"/g)).toHaveLength(3)
  })

  it('escreve o nível médio com vírgula, como a tela', () => {
    const html = renderResultsReport(overview(), NO_CHARTS)
    expect(html).toContain('>1,7<')
  })

  it('só alarma o rodapé do cartão quando há resultado abaixo do esperado', () => {
    const html = renderResultsReport(overview(), NO_CHARTS)

    expect(html.match(/fn-card__foot--danger/g)).toHaveLength(1)
    expect(html).toContain('1 de 1 abaixo do esperado')
    expect(html).toContain('Nenhum resultado abaixo do esperado')
  })

  it('pinta a barra de calor com a cor do nível, em largura proporcional', () => {
    const html = renderResultsReport(overview(), NO_CHARTS)
    expect(html).toContain('width:100.00%;background-color:#C53030')
  })

  it('não promete leitura por cor quando a função não tem nível', () => {
    const semNivel: FunctionSummary = {
      ...PRESERVADA,
      averageLevel: null,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 1 },
      belowExpected: 0
    }
    const html = renderResultsReport(overview({ functions: [semNivel] }), NO_CHARTS)

    expect(html).toContain('Sem nível cadastrado nas faixas')
    expect(html).toContain('>—<')
  })

  it('passa o SVG do radar adiante sem escapar', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 360"></svg>'
    const html = renderResultsReport(overview(), { ...NO_CHARTS, radar: svg })

    expect(html).toContain(svg)
    // O radar do panorama ocupa a largura da página; os demais, não.
    expect(html).toContain('chart-card chart-card--wide')
  })
})

describe('relatório sem resultados', () => {
  it('ainda entrega capa, aviso e assinatura', () => {
    const html = renderResultsReport(
      overview({ totalResults: 0, functions: [], functionGroups: [] }),
      NO_CHARTS
    )

    expect(html).toContain('class="cover"')
    expect(html).toContain('ainda não possui resultados registrados')
    expect(html).toContain('class="signature"')
    expect(html).not.toContain('Panorama por função')
  })
})

describe('texto livre do usuário', () => {
  it('escapa marcação vinda dos campos do domínio', () => {
    const base = overview()
    const html = renderResultsReport(
      {
        ...base,
        patient: { ...base.patient, fullName: '<img src=x onerror=alert(1)>' },
        complaint: '</p><script>alert(2)</script>'
      },
      NO_CHARTS
    )

    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('sobrevivência ao sanitizador', () => {
  it('mantém a estrutura e as cores de que o layout depende', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 360"><g></g></svg>'
    const clean = sanitizeBody(renderResultsReport(overview(), { ...NO_CHARTS, radar: svg }))

    // A moldura do gráfico e a grade de dados da capa.
    expect(clean).toContain('<figure')
    expect(clean).toContain('<figcaption')
    expect(clean).toContain('<dl')
    expect(clean).toContain('<dt>')
    expect(clean).toContain('<dd>')
    // O SVG do ECharts entra inline e precisa atravessar inteiro.
    expect(clean).toContain('<svg')
    // Sem o atributo `style` o cartão perde a cor do nível e a barra de calor
    // vira um traço cinza — o laudo sairia inteiro, e mudo.
    expect(clean).toContain('background-color:#C53030')
    expect(clean).toMatch(/width:\d+\.\d+%/)
  })
})
