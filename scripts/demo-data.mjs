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
    guardian: null,
    contact: null,
    notes: null
  }).id

  const first = createAssessment(handle, {
    patientId,
    date: '2026-02-18',
    referralReason: 'Queixa de esquecimentos e dificuldade de concentração no trabalho.',
    complaint: 'Refere perder o fio da meada em reuniões e esquecer compromissos recentes.',
    notes: null
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

  subtestIds.forEach((id, index) => {
    const value = subtests[index][3]
    if (value !== null) result(second, id, value)
  })
  result(second, wcst, 38)
  result(second, bdi, 55)

  handle.close()
  return { patientId, first, second }
}
