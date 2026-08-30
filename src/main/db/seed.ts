/**
 * Dados semeados na primeira execução.
 *
 * Semeamos a paleta da §5 e uma árvore inicial de funções cognitivas — ambas
 * inteiramente editáveis. NÃO semeamos instrumentos nem faixas normativas: as
 * tabelas de normas são material protegido dos manuais dos testes, e cada
 * profissional trabalha com a edição e a normatização que possui.
 *
 * Quem precisa levar o próprio catálogo de uma instalação para outra usa
 * exportar/importar catálogo (`services/catalog/`), que é transferência
 * escolhida caso a caso — e não distribuição embutida no instalador.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { BaremoDatabase } from './gateway'
import { aiConfig, cognitiveFunctions, colors, professionalProfile, SINGLETON_ID } from './schema'

interface SeedColor {
  readonly name: string
  readonly hex: string
}

/** §5 — a sugestão de uso é orientação, não vínculo: o usuário associa livremente. */
const SEED_COLORS: readonly SeedColor[] = [
  { name: 'Azul escuro', hex: '#1A365D' },
  { name: 'Azul claro', hex: '#2B6CB0' },
  { name: 'Verde escuro', hex: '#2F855A' },
  { name: 'Verde claro', hex: '#48BB78' },
  { name: 'Amarelo claro', hex: '#ECC94B' },
  { name: 'Laranja', hex: '#DD6B20' },
  { name: 'Vermelho', hex: '#C53030' }
]

interface SeedFunction {
  readonly name: string
  readonly children?: readonly SeedFunction[]
}

const SEED_FUNCTIONS: readonly SeedFunction[] = [
  {
    name: 'Atenção',
    children: [
      { name: 'Atenção sustentada' },
      { name: 'Atenção seletiva' },
      { name: 'Atenção alternada' },
      { name: 'Atenção dividida' }
    ]
  },
  {
    name: 'Memória',
    children: [
      { name: 'Memória de trabalho' },
      { name: 'Memória episódica verbal' },
      { name: 'Memória episódica visual' },
      { name: 'Memória semântica' },
      { name: 'Memória prospectiva' }
    ]
  },
  {
    name: 'Funções executivas',
    children: [
      { name: 'Flexibilidade cognitiva' },
      { name: 'Controle inibitório' },
      { name: 'Planejamento' },
      { name: 'Fluência' },
      { name: 'Tomada de decisão' }
    ]
  },
  {
    name: 'Linguagem',
    children: [
      { name: 'Nomeação' },
      { name: 'Compreensão verbal' },
      { name: 'Repetição' },
      { name: 'Leitura e escrita' }
    ]
  },
  {
    name: 'Habilidades visuoespaciais',
    children: [{ name: 'Percepção visual' }, { name: 'Construção visuoespacial' }]
  },
  { name: 'Velocidade de processamento' },
  { name: 'Praxias' },
  { name: 'Cognição social' },
  { name: 'Inteligência geral' }
]

/** Contagem por nome de tabela — os nomes são literais deste arquivo, não entrada. */
function countRows(handle: BaremoDatabase, table: 'colors' | 'cognitive_functions'): number {
  const row = handle.raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
    total: number
  }
  return row.total
}

/**
 * Idempotente: roda a cada boot e só preenche o que estiver vazio. Um usuário
 * que apagou todas as cores de propósito não as vê voltar — a checagem é por
 * tabela vazia, não por linha faltando.
 */
export function seedIfEmpty(handle: BaremoDatabase): void {
  const { db } = handle

  db.insert(professionalProfile).values({ id: SINGLETON_ID }).onConflictDoNothing().run()
  db.insert(aiConfig).values({ id: SINGLETON_ID }).onConflictDoNothing().run()

  if (countRows(handle, 'colors') === 0) {
    db.insert(colors)
      .values(
        SEED_COLORS.map((color, index) => ({
          id: randomUUID(),
          name: color.name,
          hex: color.hex,
          order: index,
          isSeed: true
        }))
      )
      .run()
  }

  if (countRows(handle, 'cognitive_functions') === 0) {
    const rows: (typeof cognitiveFunctions.$inferInsert)[] = []

    const walk = (nodes: readonly SeedFunction[], parentId: string | null): void => {
      nodes.forEach((node, index) => {
        const id = randomUUID()
        rows.push({ id, parentId, name: node.name, description: null, order: index })
        if (node.children) walk(node.children, id)
      })
    }

    walk(SEED_FUNCTIONS, null)
    db.insert(cognitiveFunctions).values(rows).run()
  }
}

/** Restaura a paleta da §5 sem apagar cores personalizadas do usuário. */
export function restoreSeedColors(handle: BaremoDatabase): number {
  const { db } = handle
  let restored = 0

  const existing = db.select({ hex: colors.hex }).from(colors).all()
  const present = new Set(existing.map((row) => row.hex.toUpperCase()))
  const maxOrder = db
    .select({ value: sql<number>`coalesce(max("order"), -1)` })
    .from(colors)
    .get()

  let nextOrder = (maxOrder?.value ?? -1) + 1

  for (const color of SEED_COLORS) {
    if (present.has(color.hex.toUpperCase())) continue
    db.insert(colors)
      .values({
        id: randomUUID(),
        name: color.name,
        hex: color.hex,
        order: nextOrder++,
        isSeed: true
      })
      .run()
    restored++
  }

  return restored
}
