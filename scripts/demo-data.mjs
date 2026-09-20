/**
 * Caso de exemplo para inspeção visual — NÃO é semente do app.
 *
 * O `db/seed.ts` semeia apenas a paleta e a árvore de funções; instrumentos e
 * faixas normativas nunca são distribuídos, porque são material dos manuais dos
 * testes. Isto aqui é outra coisa: um paciente fictício, num banco temporário,
 * usado por `preview-report.mjs` e pela conferência da tela de resultados.
 *
 * O caso foi montado para exercitar o que é difícil de acertar: um teste com
 * quatro subtestes (o gráfico de comparação), duas avaliações com um subteste
 * faltando na segunda (a lacuna da evolução), funções cognitivas em níveis
 * diferentes (a ordenação do panorama) e uma escala de sintoma invertida.
 */

import { openDatabase } from '../src/main/db/gateway'
import { runMigrations } from '../src/main/db/migrate'
import { seedIfEmpty } from '../src/main/db/seed'
import { seedTemplatesIfEmpty } from '../src/main/db/seed-templates'
import { cognitiveFunctions, colors } from '../src/main/db/schema'
import { createPatient } from '../src/main/repositories/patients'
import { createInstrument } from '../src/main/repositories/trees'
import { saveRanges } from '../src/main/repositories/classification-ranges'
import { createAssessment, saveResult } from '../src/main/repositories/assessments'
import { saveProfile } from '../src/main/repositories/config'

export function seedDemo(dbPath) {
  const handle = openDatabase(dbPath)
  runMigrations(handle)
  seedIfEmpty(handle)
  seedTemplatesIfEmpty(handle)

  const palette = handle.db.select().from(colors).all()
  const colorId = (name) => palette.find((color) => color.name === name)?.id ?? palette[0].id

  const tree = handle.db.select().from(cognitiveFunctions).all()
  const functionId = (name) => tree.find((node) => node.name === name)?.id ?? null

  saveProfile(handle, {
    name: 'Dra. Helena Prado',
    crp: '06/123456',
    specialty: 'Neuropsicologia',
    phone: '(11) 90000-0000',
    email: 'helena@exemplo.test',
    address: 'Rua das Acácias, 100 — São Paulo/SP',
    logoDataUrl: null
  })

  const patientId = createPatient(handle, {
    fullName: 'Joana Ribeiro de Almeida',
    birthDate: '1987-04-22',
    sex: 'female',
    education: 'Ensino superior completo',
    handedness: 'right',
    guardian: 'Marcos Ribeiro de Almeida (cônjuge)',
    contact: '(11) 98888-7777 · joana@exemplo.test',
    notes:
      'Acompanhamento endocrinológico por hipotireoidismo, em uso de levotiroxina.' +
      '\nSem histórico de trauma cranioencefálico ou internação psiquiátrica.'
  }).id

  const first = createAssessment(handle, {
    patientId,
    date: '2026-02-18',
    referralReason:
      'Encaminhada pela neurologista para investigação de queixa de memória com seis meses' +
      ' de evolução, após exames de imagem sem alterações.',
    complaint:
      'Refere perder o fio da meada em reuniões e esquecer compromissos recentes.' +
      '\nRelata piora no período da tarde e sono fragmentado há cerca de um ano.',
    notes:
      'Avaliação em duas sessões, ambas no período da manhã. Colaborativa e motivada;' +
      ' sem sinais de fadiga que comprometessem o desempenho.'
  }).id

  const second = createAssessment(handle, {
    patientId,
    date: '2026-08-12',
    referralReason: 'Reavaliação após seis meses de acompanhamento.',
    complaint: null,
    notes: null
  }).id

  const instrument = (name, acronym, parentId, cognitiveFunctionName, order) =>
    createInstrument(handle, {
      parentId,
      name,
      acronym,
      cognitiveFunctionId: cognitiveFunctionName === null ? null : functionId(cognitiveFunctionName),
      minAgeYears: null,
      maxAgeYears: null,
      reference: null,
      order
    }).id

  /** Cinco faixas de percentil, com nível — direto ou invertido. */
  function standardRanges(id, inverted = false) {
    const names = inverted
      ? ['Sem indicativo', 'Leve', 'Moderado', 'Acentuado', 'Grave']
      : ['Muito rebaixado', 'Rebaixado', 'Média', 'Média superior', 'Superior']
    const swatches = ['Vermelho', 'Laranja', 'Amarelo claro', 'Verde claro', 'Verde escuro']
    const levels = inverted ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5]

    saveRanges(
      handle,
      id,
      'percentile',
      names.map((classificationName, index) => ({
        classificationName,
        minValue: index * 20,
        maxValue: (index + 1) * 20,
        colorId: colorId(inverted ? swatches[4 - index] : swatches[index]),
        level: levels[index],
        inverted
      }))
    )
  }

  const wais = instrument('Escala Wechsler de Inteligência', 'WAIS-III', null, null, 0)
  const subtests = [
    ['Vocabulário', 'Linguagem', 78, 84],
    ['Dígitos', 'Memória de trabalho', 12, 34],
    ['Cubos', 'Habilidades visuoespaciais', 55, null],
    ['Códigos', 'Velocidade de processamento', 24, 46]
  ]

  const subtestIds = subtests.map(([name, fn], index) => {
    const id = instrument(name, null, wais, fn, index)
    standardRanges(id)
    return id
  })

  const wcst = instrument('Teste Wisconsin', 'WCST', null, 'Flexibilidade cognitiva', 1)
  standardRanges(wcst)

  const bdi = instrument('Inventário de Depressão', 'BDI-II', null, null, 2)
  standardRanges(bdi, true)

  // Memória com TRÊS filhas pontuadas. O corte do radar é de três eixos, e sem
  // isto a prévia nunca desenharia um radar por função — justamente o cartão
  // mais fácil de quebrar no detalhe, porque é o único gráfico que aparece
  // indentado sob um bloco.
  const ravlt = instrument('Teste de Aprendizagem Auditivo-Verbal', 'RAVLT', null, null, 3)
  const ravltSubtests = [
    ['Evocação imediata (A5)', 'Memória episódica verbal', 22, 41],
    ['Evocação tardia (A7)', 'Memória episódica verbal', 14, 33],
    ['Reconhecimento', 'Memória episódica verbal', 35, 52]
  ]
  const ravltIds = ravltSubtests.map(([name, fn], index) => {
    const id = instrument(name, null, ravlt, fn, index)
    standardRanges(id)
    return id
  })

  const rey = instrument('Figuras Complexas de Rey', 'FCR', null, null, 4)
  const reySubtests = [
    ['Cópia', 'Construção visuoespacial', 62, 68],
    ['Evocação', 'Memória episódica visual', 28, 44]
  ]
  const reyIds = reySubtests.map(([name, fn], index) => {
    const id = instrument(name, null, rey, fn, index)
    standardRanges(id)
    return id
  })

  const result = (assessmentId, instrumentId, value) =>
    saveResult(handle, null, {
      assessmentId,
      instrumentId,
      scoreType: 'percentile',
      value,
      status: 'applied',
      notes: null,
      override: null
    })

  subtestIds.forEach((id, index) => result(first, id, subtests[index][2]))
  result(first, wcst, 18)
  result(first, bdi, 72)
  ravltIds.forEach((id, index) => result(first, id, ravltSubtests[index][2]))
  reyIds.forEach((id, index) => result(first, id, reySubtests[index][2]))

  subtestIds.forEach((id, index) => {
    const value = subtests[index][3]
    if (value !== null) result(second, id, value)
  })
  result(second, wcst, 38)
  result(second, bdi, 55)
  ravltIds.forEach((id, index) => result(second, id, ravltSubtests[index][3]))
  reyIds.forEach((id, index) => result(second, id, reySubtests[index][3]))

  handle.close()
  return { patientId, first, second }
}
