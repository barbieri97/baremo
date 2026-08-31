/**
 * Carga de dados clínicos fictícios no banco REAL do app.
 *
 * Diferente de `demo-data.mjs`, que monta um banco temporário para a prévia do
 * laudo: isto escreve no banco de verdade, para dar o que testar na máquina do
 * usuário. Por isso é idempotente — instrumento e paciente já existentes são
 * pulados, e rodar duas vezes não duplica nada.
 *
 *   npx vite-node --config vitest.config.ts scripts/dados-mock-clinicos.mjs
 *   npx vite-node --config vitest.config.ts scripts/dados-mock-clinicos.mjs -- caminho/do.db
 *
 * FECHE O APP ANTES DE RODAR. O SQLite aguenta o acesso concorrente, mas a tela
 * já aberta continuaria mostrando o estado antigo.
 *
 * A árvore de funções foi escolhida para exercitar os radares hierárquicos:
 * Atenção e Memória ficam com três filhas pontuadas cada (radar próprio),
 * Funções executivas com duas (deliberadamente sem radar, para conferir a
 * regra), e a Atenção recebe também um resultado DIRETO — o caso em que o pai
 * tem escore próprio além das filhas.
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

import { openDatabase } from '../src/main/db/gateway'
import { runMigrations } from '../src/main/db/migrate'
import { seedIfEmpty } from '../src/main/db/seed'
import { cognitiveFunctions, colors, instruments, patients } from '../src/main/db/schema'
import { createPatient } from '../src/main/repositories/patients'
import { createInstrument } from '../src/main/repositories/trees'
import { saveRanges } from '../src/main/repositories/classification-ranges'
import { createAssessment, saveResult } from '../src/main/repositories/assessments'

const DEFAULT_DB = join(homedir(), 'AppData', 'Roaming', 'baremo', 'baremo.db')

// ─── Faixas normativas por tipo de escore ────────────────────────────────────
//
// Cinco faixas por escala, uma por nível, cobrindo o domínio inteiro — a
// validação exige cobertura total, e é o nível que faz os radares existirem.
// Nenhuma é invertida: nos quatro tipos usados aqui, valor alto é desempenho
// melhor.

const FAIXAS = {
  scaledScore: [
    ['Muito inferior', 1, 4, 1, 'Vermelho'],
    ['Inferior', 4, 7, 2, 'Laranja'],
    ['Média', 7, 13, 3, 'Amarelo claro'],
    ['Superior', 13, 16, 4, 'Verde claro'],
    ['Muito superior', 16, 19, 5, 'Verde escuro']
  ],
  standardScore: [
    ['Muito inferior', 40, 70, 1, 'Vermelho'],
    ['Inferior', 70, 85, 2, 'Laranja'],
    ['Média', 85, 115, 3, 'Amarelo claro'],
    ['Superior', 115, 130, 4, 'Verde claro'],
    ['Muito superior', 130, 160, 5, 'Verde escuro']
  ],
  percentile: [
    ['Muito inferior', 0, 5, 1, 'Vermelho'],
    ['Inferior', 5, 25, 2, 'Laranja'],
    ['Média', 25, 75, 3, 'Amarelo claro'],
    ['Superior', 75, 95, 4, 'Verde claro'],
    ['Muito superior', 95, 100, 5, 'Verde escuro']
  ],
  zScore: [
    ['Muito inferior', -5, -2, 1, 'Vermelho'],
    ['Inferior', -2, -1, 2, 'Laranja'],
    ['Média', -1, 1, 3, 'Amarelo claro'],
    ['Superior', 1, 2, 4, 'Verde claro'],
    ['Muito superior', 2, 5, 5, 'Verde escuro']
  ]
}

// ─── O catálogo ──────────────────────────────────────────────────────────────
//
// Cada subteste declara [nome, tipo de escore, função cognitiva, valor]. O
// valor `null` cadastra o subteste sem lançar resultado — é o caso do WISC-V,
// que fica pronto no catálogo mas não se aplica a uma paciente adulta.

const CATALOGO = [
  {
    nome: 'Escala Wechsler de Inteligência para Crianças — 5ª edição',
    sigla: 'WISC-V',
    minIdade: 6,
    maxIdade: 16,
    referencia: 'Wechsler, D. (2013). WISC-V. São Paulo: Pearson.',
    subtestes: [
      ['WISC-V - Vocabulário', 'scaledScore', 'Compreensão verbal', null],
      ['WISC-V - Semelhanças', 'scaledScore', 'Compreensão verbal', null],
      ['WISC-V - Cubos', 'scaledScore', 'Construção visuoespacial', null],
      ['WISC-V - Quebra-Cabeças Visuais', 'scaledScore', 'Percepção visual', null],
      ['WISC-V - Dígitos', 'scaledScore', 'Memória de trabalho', null],
      ['WISC-V - Códigos', 'scaledScore', 'Velocidade de processamento', null],
      ['WISC-V - QI Total', 'standardScore', 'Inteligência geral', null]
    ]
  },
  {
    nome: 'Escala Wechsler de Inteligência para Adultos — 3ª edição',
    sigla: 'WAIS-III',
    minIdade: 16,
    maxIdade: 89,
    referencia: 'Wechsler, D. (2004). WAIS-III. São Paulo: Casa do Psicólogo.',
    subtestes: [
      ['WAIS-III - Vocabulário', 'scaledScore', 'Compreensão verbal', 12],
      ['WAIS-III - Semelhanças', 'scaledScore', 'Compreensão verbal', 13],
      ['WAIS-III - Informação', 'scaledScore', 'Memória semântica', 11],
      ['WAIS-III - Cubos', 'scaledScore', 'Construção visuoespacial', 10],
      ['WAIS-III - Raciocínio Matricial', 'scaledScore', 'Percepção visual', 11],
      ['WAIS-III - Dígitos', 'scaledScore', 'Memória de trabalho', 6],
      ['WAIS-III - Sequência de Números e Letras', 'scaledScore', 'Memória de trabalho', 5],
      ['WAIS-III - Códigos', 'scaledScore', 'Velocidade de processamento', 5],
      ['WAIS-III - QI Total', 'standardScore', 'Inteligência geral', 98]
    ]
  },
  {
    nome: 'Teste de Aprendizagem Auditivo-Verbal de Rey',
    sigla: 'RAVLT',
    minIdade: 16,
    maxIdade: 89,
    referencia: 'Malloy-Diniz, L. F. et al. (2007). Validação brasileira do RAVLT.',
    subtestes: [
      ['RAVLT - Total A1-A5', 'zScore', 'Memória episódica verbal', -1.2],
      ['RAVLT - Evocação Tardia (A7)', 'zScore', 'Memória episódica verbal', -1.5],
      ['RAVLT - Reconhecimento', 'zScore', 'Memória episódica verbal', -0.4]
    ]
  },
  {
    nome: 'Teste dos Cinco Dígitos',
    sigla: 'FDT',
    minIdade: 6,
    maxIdade: 89,
    referencia: 'Sedó, M., Paula, J. J., Malloy-Diniz, L. F. (2015). FDT. Hogrefe.',
    subtestes: [
      ['FDT - Leitura', 'percentile', 'Velocidade de processamento', 30],
      ['FDT - Contagem', 'percentile', 'Velocidade de processamento', 20],
      ['FDT - Inibição', 'percentile', 'Controle inibitório', 8],
      ['FDT - Flexibilidade', 'percentile', 'Flexibilidade cognitiva', 4]
    ]
  },
  {
    nome: 'Bateria Psicológica para Avaliação da Atenção',
    sigla: 'BPA',
    minIdade: 6,
    maxIdade: 82,
    referencia: 'Rueda, F. J. M. (2013). BPA. São Paulo: Vetor.',
    subtestes: [
      ['BPA - Atenção Concentrada', 'percentile', 'Atenção seletiva', 10],
      ['BPA - Atenção Dividida', 'percentile', 'Atenção dividida', 3],
      ['BPA - Atenção Alternada', 'percentile', 'Atenção alternada', 15],
      // Direto na função PAI: é o caso em que a raiz tem escore próprio além
      // das filhas, e ele conta na média do radar geral sem virar eixo do
      // radar de Atenção.
      ['BPA - Atenção Geral', 'percentile', 'Atenção', 5]
    ]
  }
]

const PACIENTE = {
  fullName: 'Marina Alves Ferreira',
  birthDate: '1991-06-18',
  sex: 'female',
  education: 'Ensino superior completo',
  handedness: 'right',
  guardian: null,
  contact: 'marina.ferreira@exemplo.test',
  notes: 'Paciente fictícia, criada para testes do aplicativo.'
}

const AVALIACAO = {
  date: '2026-08-31',
  referralReason:
    'Queixa de desatenção e esquecimentos frequentes no trabalho, com prejuízo em prazos e reuniões. Encaminhada pela psiquiatra para investigação de TDAH no adulto.',
  complaint:
    'Relata dificuldade em sustentar o foco em tarefas longas, perder o fio em conversas e precisar reler o mesmo parágrafo várias vezes.',
  notes:
    'Avaliação em duas sessões. Boa colaboração, sem sinais de fadiga ou desmotivação que comprometessem o desempenho.'
}

export function carregarMock(dbPath) {
  const handle = openDatabase(dbPath)
  runMigrations(handle)
  seedIfEmpty(handle)

  const palette = handle.db.select().from(colors).all()
  const corId = (nome) => {
    const cor = palette.find((color) => color.name === nome)
    if (!cor) throw new Error(`cor "${nome}" não existe na paleta`)
    return cor.id
  }

  const arvore = handle.db.select().from(cognitiveFunctions).all()
  const funcaoId = (nome) => {
    const node = arvore.find((entry) => entry.name === nome)
    if (!node) throw new Error(`função cognitiva "${nome}" não existe na árvore`)
    return node.id
  }

  const existentes = handle.db.select().from(instruments).all()
  const porNome = new Map(existentes.map((node) => [node.name, node]))

  const resumo = { instrumentos: 0, subtestes: 0, faixas: 0, resultados: 0, pulados: 0 }

  // ── Paciente e avaliação ─────────────────────────────────────────────────
  const jaExiste = handle.db
    .select()
    .from(patients)
    .all()
    .find((row) => row.fullName === PACIENTE.fullName)

  if (jaExiste) {
    handle.close()
    return { ...resumo, jaCarregado: true, pacienteId: jaExiste.id }
  }

  const pacienteId = createPatient(handle, PACIENTE).id
  const avaliacaoId = createAssessment(handle, { patientId: pacienteId, ...AVALIACAO }).id

  // ── Catálogo ─────────────────────────────────────────────────────────────
  for (const [ordem, teste] of CATALOGO.entries()) {
    let raiz = porNome.get(teste.nome)

    if (raiz === undefined) {
      raiz = createInstrument(handle, {
        parentId: null,
        name: teste.nome,
        acronym: teste.sigla,
        cognitiveFunctionId: null,
        minAgeYears: teste.minIdade,
        maxAgeYears: teste.maxIdade,
        reference: teste.referencia,
        order: 100 + ordem
      })
      porNome.set(teste.nome, raiz)
      resumo.instrumentos++
    } else {
      resumo.pulados++
    }

    for (const [posicao, [nome, tipo, funcao, valor]] of teste.subtestes.entries()) {
      let subteste = porNome.get(nome)

      if (subteste === undefined) {
        subteste = createInstrument(handle, {
          parentId: raiz.id,
          name: nome,
          acronym: null,
          cognitiveFunctionId: funcaoId(funcao),
          minAgeYears: teste.minIdade,
          maxAgeYears: teste.maxIdade,
          reference: null,
          order: posicao
        })
        porNome.set(nome, subteste)
        resumo.subtestes++

        const faixas = FAIXAS[tipo].map(([classificacao, min, max, nivel, cor]) => ({
          classificationName: classificacao,
          minValue: min,
          maxValue: max,
          colorId: corId(cor),
          level: nivel,
          inverted: false
        }))
        saveRanges(handle, subteste.id, tipo, faixas)
        resumo.faixas += faixas.length
      }

      if (valor === null) continue

      saveResult(handle, null, {
        assessmentId: avaliacaoId,
        instrumentId: subteste.id,
        scoreType: tipo,
        value: valor,
        status: 'applied',
        notes: null,
        override: null
      })
      resumo.resultados++
    }
  }

  handle.close()
  return { ...resumo, jaCarregado: false, pacienteId, avaliacaoId }
}

const alvo = process.argv[2] ?? DEFAULT_DB
const resultado = carregarMock(alvo)

if (resultado.jaCarregado) {
  console.log(`A paciente "${PACIENTE.fullName}" já existe neste banco. Nada foi alterado.`)
} else {
  console.log(`Banco: ${alvo}`)
  console.log(
    `Instrumentos: ${resultado.instrumentos} raiz, ${resultado.subtestes} subtestes, ` +
      `${resultado.faixas} faixas (todas com nível).`
  )
  console.log(`Paciente "${PACIENTE.fullName}" com 1 avaliação e ${resultado.resultados} resultados.`)
  console.log(`Avaliação: ${resultado.avaliacaoId}`)
}
