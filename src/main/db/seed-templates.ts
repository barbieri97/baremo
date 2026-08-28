/**
 * Modelos de documento da Resolução CFP nº 06/2019 (spec §9.5).
 *
 * Vêm com a estrutura de seções e os tokens já posicionados, para que o
 * profissional comece de um esqueleto correto em vez de uma página em branco.
 * Todos são editáveis, e o usuário pode salvar os próprios.
 *
 * Os tokens (`{{paciente.nome}}` etc.) são resolvidos LOCALMENTE na exportação
 * (§9.2) — é o mecanismo que permite ao módulo de IA trabalhar com dados
 * pseudonimizados sem que o documento final perca o nome real.
 */

import { randomUUID } from 'node:crypto'
import type { BaremoDatabase } from './gateway'
import { documentTemplates } from './schema'
import type { DocumentType } from '@shared/labels'

interface Block {
  type: string
  attrs?: Record<string, unknown>
  content?: Block[]
  text?: string
}

const token = (name: string): Block => ({ type: 'variable', attrs: { token: name } })
const text = (value: string): Block => ({ type: 'text', text: value })

function paragraph(...parts: Block[]): Block {
  return { type: 'paragraph', content: parts }
}

function heading(value: string, level = 2): Block {
  return { type: 'heading', attrs: { level }, content: [text(value)] }
}

function centered(...parts: Block[]): Block {
  return { type: 'paragraph', attrs: { textAlign: 'center' }, content: parts }
}

const identification: Block[] = [
  heading('Identificação'),
  paragraph(text('Nome: '), token('paciente.nome')),
  paragraph(text('Idade na avaliação: '), token('paciente.idade_na_avaliacao')),
  paragraph(text('Data de nascimento: '), token('paciente.data_nascimento')),
  paragraph(text('Escolaridade: '), token('paciente.escolaridade')),
  paragraph(text('Data da avaliação: '), token('avaliacao.data'))
]

const signature: Block[] = [{ type: 'signature' }]

interface SeedTemplate {
  readonly type: DocumentType
  readonly name: string
  readonly blocks: Block[]
}

const TEMPLATES: readonly SeedTemplate[] = [
  {
    type: 'psychological_report',
    name: 'Relatório / laudo psicológico (Res. CFP 06/2019)',
    blocks: [
      centered(text('LAUDO PSICOLÓGICO')),
      ...identification,
      heading('1. Demanda'),
      paragraph(text('Motivo do encaminhamento: '), token('avaliacao.motivo')),
      paragraph(text('Descreva quem encaminhou, a demanda apresentada e a questão a ser respondida.')),
      heading('2. Procedimento'),
      paragraph(
        text(
          'Descreva o número de sessões, o período, os instrumentos aplicados e as fontes de informação (entrevistas, observação, documentos).'
        )
      ),
      heading('3. Análise'),
      paragraph(
        text(
          'Integre os achados por função cognitiva, articulando os resultados com a história clínica e as observações comportamentais. Evite listar escores sem interpretação.'
        )
      ),
      { type: 'resultsBlock', attrs: { assessmentId: null, cognitiveFunctionId: null } },
      heading('4. Conclusão'),
      paragraph(
        text(
          'Responda à demanda formulada, com o grau de certeza que os dados sustentam, explicitando limitações.'
        )
      ),
      heading('5. Referências'),
      paragraph(text('Instrumentos utilizados e literatura de apoio.')),
      ...signature
    ]
  },
  {
    type: 'technical_opinion',
    name: 'Parecer técnico (Res. CFP 06/2019)',
    blocks: [
      centered(text('PARECER TÉCNICO')),
      ...identification,
      heading('1. Demanda'),
      paragraph(text('Descreva a questão técnica sobre a qual o parecer se manifesta e quem a formulou.')),
      heading('2. Análise'),
      paragraph(
        text(
          'Fundamente a análise em literatura, normativas e nos documentos examinados. O parecer se manifesta sobre uma questão, não sobre a pessoa avaliada.'
        )
      ),
      heading('3. Conclusão'),
      paragraph(text('Posicionamento técnico fundamentado.')),
      ...signature
    ]
  },
  {
    type: 'certificate',
    name: 'Atestado psicológico (Res. CFP 06/2019)',
    blocks: [
      centered(text('ATESTADO PSICOLÓGICO')),
      paragraph(
        text('Atesto, para os devidos fins, que '),
        token('paciente.nome'),
        text(', com '),
        token('paciente.idade_na_avaliacao'),
        text(', encontra-se em atendimento psicológico sob minha responsabilidade.')
      ),
      paragraph(text('Finalidade: descreva a finalidade solicitada.')),
      paragraph(text('Data do atendimento: '), token('avaliacao.data')),
      ...signature
    ]
  },
  {
    type: 'declaration',
    name: 'Declaração (Res. CFP 06/2019)',
    blocks: [
      centered(text('DECLARAÇÃO')),
      paragraph(
        text('Declaro, para os devidos fins, que '),
        token('paciente.nome'),
        text(' compareceu a atendimento psicológico nesta data.')
      ),
      paragraph(text('Data: '), token('avaliacao.data')),
      paragraph(
        text(
          'A declaração limita-se a informar comparecimento, duração e finalidade, sem registrar diagnóstico ou conteúdo do atendimento.'
        )
      ),
      ...signature
    ]
  },
  {
    type: 'feedback',
    name: 'Devolutiva ao paciente / responsável',
    blocks: [
      heading('Devolutiva da avaliação neuropsicológica', 1),
      ...identification,
      heading('O que foi avaliado'),
      paragraph(text('Explique, em linguagem acessível, quais funções foram investigadas e por quê.')),
      heading('O que encontramos'),
      paragraph(text('Apresente os achados evitando jargão e escores isolados.')),
      { type: 'chartBlock', attrs: { assessmentId: null } },
      heading('Recomendações'),
      paragraph(text('Orientações práticas para casa, escola ou trabalho.')),
      ...signature
    ]
  },
  {
    type: 'referral',
    name: 'Encaminhamento',
    blocks: [
      heading('Encaminhamento', 1),
      paragraph(text('Encaminho '), token('paciente.nome'), text(', com '), token('paciente.idade_na_avaliacao'), text('.')),
      heading('Motivo do encaminhamento'),
      paragraph(text('Descreva os achados que justificam o encaminhamento e a especialidade indicada.')),
      heading('Informações relevantes'),
      paragraph(text('Resumo dos dados que auxiliam o profissional receptor.')),
      ...signature
    ]
  }
]

/** Idempotente: só semeia quando a tabela está vazia. */
export function seedTemplatesIfEmpty(handle: BaremoDatabase): void {
  const row = handle.raw.prepare('SELECT COUNT(*) AS total FROM document_templates').get() as {
    total: number
  }
  if (row.total > 0) return

  handle.db
    .insert(documentTemplates)
    .values(
      TEMPLATES.map((template) => ({
        id: randomUUID(),
        type: template.type,
        name: template.name,
        contentJson: JSON.stringify({ type: 'doc', content: template.blocks }),
        isSeed: true
      }))
    )
    .run()
}
