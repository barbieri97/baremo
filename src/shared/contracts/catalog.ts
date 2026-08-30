/**
 * Formato do arquivo de catálogo — instrumentos e faixas de classificação.
 *
 * O catálogo é transferido como ARQUIVO, e não semeado no instalador: as
 * tabelas normativas são material dos manuais dos testes, e o `seed.ts` registra
 * a decisão de nunca distribuí-las embutidas. Um arquivo mantém a escolha de
 * para quem o catálogo vai com quem o exportou — e resolve o caso real, que é
 * levar o próprio catálogo de uma máquina para outra.
 *
 * Duas decisões do formato, que são o que fazem a reimportação funcionar:
 *
 * **Os ids viajam.** O instrumento importado mantém o id que tinha na origem, e
 * é por ele que a segunda importação reconhece o que já existe e atualiza em vez
 * de duplicar. Sem isso, cada exportação nova viraria um catálogo paralelo.
 *
 * **A função cognitiva viaja por NOME, não por id.** A árvore de funções é
 * semeada com ids aleatórios em cada instalação (`seed.ts`), então o id da
 * origem não significa nada no destino. O caminho de nomes significa, e o que
 * não casar vira aviso — nunca uma função cognitiva criada por conta própria.
 */

import { z } from 'zod'
import {
  classificationLevelSchema,
  hexColorSchema,
  idSchema,
  scoreTypeSchema,
  timestampSchema
} from './entities'

/** Versão do formato. Um arquivo de outra versão é recusado inteiro, não adivinhado. */
export const CATALOG_FILE_SCHEMA = 'baremo/catalog@1'

const shortText = z.string().trim().min(1).max(200)

export const catalogColorSchema = z.object({
  id: idSchema,
  name: shortText,
  hex: hexColorSchema
})

export const catalogInstrumentSchema = z.object({
  id: idSchema,
  parentId: idSchema.nullable(),
  name: shortText,
  acronym: z.string().trim().max(200).nullable(),
  /**
   * Caminho de nomes da raiz até a função, por exemplo
   * `['Atenção', 'Atenção sustentada']`. Lista, e não string com separador,
   * para que um nome que contenha o separador não parta o caminho em dois.
   */
  cognitiveFunctionPath: z.array(shortText).max(20).nullable(),
  minAgeYears: z.number().int().min(0).max(120).nullable(),
  maxAgeYears: z.number().int().min(0).max(120).nullable(),
  reference: z.string().trim().max(20_000).nullable(),
  order: z.number().int().min(0).max(1_000_000)
})

/**
 * As faixas viajam por conjunto `instrumento + tipo de escore`, que é a unidade
 * com que elas são gravadas (§4.6) — nunca linha a linha. Um conjunto parcial
 * não é representável neste formato, e é justamente o que se quer.
 */
export const catalogRangeSetSchema = z.object({
  instrumentId: idSchema,
  scoreType: scoreTypeSchema,
  entries: z
    .array(
      z.object({
        classificationName: shortText,
        minValue: z.number(),
        maxValue: z.number(),
        colorId: idSchema,
        /**
         * Nível e inversão entraram depois, e por isso são OPCIONAIS: a versão
         * do formato segue `@1` de propósito. Bumpar recusaria inteiro o
         * arquivo que o usuário já tem na máquina de destino, e o ganho seria
         * nenhum — um binário antigo lendo um arquivo novo apenas ignora os
         * campos que não conhece.
         */
        level: classificationLevelSchema.nullable().optional(),
        inverted: z.boolean().optional()
      })
    )
    .min(1)
    .max(200)
})

/**
 * Os tetos existem para que um arquivo hostil ou corrompido seja recusado na
 * validação, e não depois de gastar memória. São ordens de grandeza acima de
 * qualquer catálogo real.
 */
export const catalogFileSchema = z.object({
  schema: z.literal(CATALOG_FILE_SCHEMA),
  exportedAt: timestampSchema,
  appVersion: z.string().max(40),
  colors: z.array(catalogColorSchema).max(500),
  instruments: z.array(catalogInstrumentSchema).max(5_000),
  ranges: z.array(catalogRangeSetSchema).max(20_000)
})

export type CatalogFile = z.infer<typeof catalogFileSchema>
export type CatalogInstrument = z.infer<typeof catalogInstrumentSchema>
export type CatalogRangeSet = z.infer<typeof catalogRangeSetSchema>
export type CatalogColor = z.infer<typeof catalogColorSchema>

/** Aviso de importação: o que não pôde ser resolvido, sem impedir o resto. */
export const catalogWarningSchema = z.object({
  code: z.enum([
    'unknown_cognitive_function',
    'orphan_parent',
    'duplicate_name',
    'unclassifiable_score_type'
  ]),
  message: z.string().max(500)
})

/**
 * O que uma importação faria (prévia) ou fez (resultado) — a mesma forma nos
 * dois casos, para a tela mostrar antes e depois sem dois formatos.
 */
export const catalogImportPlanSchema = z.object({
  exportedAt: timestampSchema,
  appVersion: z.string(),
  instruments: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int()
  }),
  rangeSets: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int()
  }),
  colors: z.object({
    created: z.number().int(),
    matched: z.number().int()
  }),
  warnings: z.array(catalogWarningSchema)
})

export type CatalogImportPlan = z.infer<typeof catalogImportPlanSchema>
export type CatalogWarning = z.infer<typeof catalogWarningSchema>
