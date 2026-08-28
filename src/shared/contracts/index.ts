/**
 * Contratos de IPC — a fonte única da fronteira renderer ↔ main (spec §12.1, §13.2).
 *
 * Cada canal declara o schema Zod da entrada e da saída. O `registerHandler` do
 * processo principal valida o remetente e a entrada antes de tocar em banco ou
 * filesystem; o preload deriva `window.baremo` deste mesmo mapa. A consequência
 * prática: não existe canal sem schema, porque um canal que não está aqui
 * simplesmente não é exposto ao renderer.
 */

import { z } from 'zod'
import {
  assessmentInputSchema,
  assessmentResultInputSchema,
  assessmentResultSchema,
  assessmentSchema,
  attachmentSchema,
  auditLogSchema,
  classificationRangeDraftSchema,
  classificationRangeWithColorSchema,
  cognitiveFunctionInputSchema,
  cognitiveFunctionSchema,
  colorSchema,
  documentSchema,
  documentTemplateSchema,
  documentVersionSchema,
  hexColorSchema,
  idSchema,
  instrumentInputSchema,
  instrumentSchema,
  isoDateSchema,
  patientInputSchema,
  patientSchema,
  professionalProfileSchema,
  scoreTypeSchema,
  tiptapContentSchema,
  timestampSchema
} from './entities'
import {
  AI_MODELS,
  aiAuditSchema,
  aiConfigSchema,
  aiMessageSchema,
  aiSessionSchema
} from './entities-ai'
import { DOCUMENT_STATUSES, DOCUMENT_TYPES, REPORT_KINDS } from '../labels'

export interface ChannelContract<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny
> {
  readonly input: I
  readonly output: O
}

function channel<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  input: I,
  output: O
): ChannelContract<I, O> {
  return { input, output }
}

const empty = z.void()
const ok = z.object({ ok: z.literal(true) })

/** Contagem de vínculos exibida no modal de impacto (§6.3). */
const impactSchema = z.object({
  label: z.string(),
  counts: z.array(z.object({ entity: z.string(), count: z.number().int() }))
})

const rangeIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  rangeIds: z.array(z.string())
})

/** Linha da grade de resultados: o resultado mais o que a UI precisa mostrar. */
const resultRowSchema = assessmentResultSchema.extend({
  instrumentName: z.string(),
  instrumentAcronym: z.string().nullable(),
  cognitiveFunctionId: idSchema.nullable(),
  cognitiveFunctionName: z.string().nullable()
})

const backupSchema = z.object({
  fileName: z.string(),
  sizeBytes: z.number().int(),
  createdAt: timestampSchema,
  schemaVersion: z.number().int()
})

const appStateSchema = z.object({
  appVersion: z.string(),
  schemaVersion: z.number().int(),
  databasePath: z.string(),
  attachmentsPath: z.string(),
  /** §16.1 — o aviso de criptografia de disco aparece na primeira execução. */
  diskEncryptionNoticeAcknowledged: z.boolean(),
  aiEnabled: z.boolean(),
  safeStorageAvailable: z.boolean()
})

export const contracts = {
  // ─── config:* ──────────────────────────────────────────────────────────────
  'config:getAppState': channel(empty, appStateSchema),
  'config:acknowledgeDiskNotice': channel(empty, ok),
  'config:getProfile': channel(empty, professionalProfileSchema),
  'config:saveProfile': channel(professionalProfileSchema, professionalProfileSchema),
  'config:listColors': channel(empty, z.array(colorSchema)),
  'config:saveColor': channel(
    z.object({
      id: idSchema.nullable(),
      name: z.string().trim().min(1).max(200),
      hex: hexColorSchema
    }),
    colorSchema
  ),
  'config:deleteColor': channel(z.object({ id: idSchema }), ok),
  'config:reorderColors': channel(z.object({ orderedIds: z.array(idSchema) }), ok),

  // ─── patients:* ────────────────────────────────────────────────────────────
  'patients:list': channel(
    z.object({ query: z.string().max(200).default(''), includeArchived: z.boolean().default(false) }),
    z.array(patientSchema)
  ),
  'patients:get': channel(z.object({ id: idSchema }), patientSchema),
  'patients:create': channel(z.object({ input: patientInputSchema }), patientSchema),
  'patients:update': channel(
    z.object({ id: idSchema, input: patientInputSchema }),
    patientSchema
  ),
  'patients:setArchived': channel(
    z.object({ id: idSchema, archived: z.boolean() }),
    patientSchema
  ),
  'patients:impact': channel(z.object({ id: idSchema }), impactSchema),
  /** Exclusão definitiva exige digitar o nome do paciente (§6.2). */
  'patients:delete': channel(
    z.object({ id: idSchema, confirmationName: z.string() }),
    ok
  ),

  // ─── cognitiveFunctions:* ──────────────────────────────────────────────────
  'cognitiveFunctions:list': channel(empty, z.array(cognitiveFunctionSchema)),
  'cognitiveFunctions:create': channel(
    z.object({ input: cognitiveFunctionInputSchema }),
    cognitiveFunctionSchema
  ),
  'cognitiveFunctions:update': channel(
    z.object({ id: idSchema, input: cognitiveFunctionInputSchema }),
    cognitiveFunctionSchema
  ),
  'cognitiveFunctions:move': channel(
    z.object({ id: idSchema, parentId: idSchema.nullable(), order: z.number().int() }),
    ok
  ),
  'cognitiveFunctions:impact': channel(z.object({ id: idSchema }), impactSchema),
  'cognitiveFunctions:delete': channel(z.object({ id: idSchema }), ok),

  // ─── instruments:* ─────────────────────────────────────────────────────────
  'instruments:list': channel(empty, z.array(instrumentSchema)),
  'instruments:create': channel(z.object({ input: instrumentInputSchema }), instrumentSchema),
  'instruments:update': channel(
    z.object({ id: idSchema, input: instrumentInputSchema }),
    instrumentSchema
  ),
  'instruments:move': channel(
    z.object({ id: idSchema, parentId: idSchema.nullable(), order: z.number().int() }),
    ok
  ),
  'instruments:impact': channel(z.object({ id: idSchema }), impactSchema),
  'instruments:delete': channel(z.object({ id: idSchema }), ok),

  // ─── classifications:* ─────────────────────────────────────────────────────
  'classifications:list': channel(
    z.object({ instrumentId: idSchema, scoreType: scoreTypeSchema }),
    z.array(classificationRangeWithColorSchema)
  ),
  /** Tipos de escore que já têm faixas para o instrumento — alimenta o seletor. */
  'classifications:listConfigured': channel(
    z.object({ instrumentId: idSchema }),
    z.array(scoreTypeSchema)
  ),
  /** Validação sem gravar, para a UI dar retorno enquanto o usuário digita. */
  'classifications:validate': channel(
    z.object({
      scoreType: scoreTypeSchema,
      ranges: z.array(classificationRangeDraftSchema)
    }),
    z.array(rangeIssueSchema)
  ),
  /** Substitui o conjunto inteiro do par instrumento+tipo e incrementa a versão. */
  'classifications:save': channel(
    z.object({
      instrumentId: idSchema,
      scoreType: scoreTypeSchema,
      ranges: z.array(classificationRangeDraftSchema)
    }),
    z.array(classificationRangeWithColorSchema)
  ),

  // ─── assessments:* ─────────────────────────────────────────────────────────
  'assessments:listByPatient': channel(
    z.object({ patientId: idSchema, includeArchived: z.boolean().default(false) }),
    z.array(assessmentSchema.extend({ resultCount: z.number().int() }))
  ),
  'assessments:get': channel(z.object({ id: idSchema }), assessmentSchema),
  'assessments:create': channel(z.object({ input: assessmentInputSchema }), assessmentSchema),
  'assessments:update': channel(
    z.object({ id: idSchema, input: assessmentInputSchema }),
    assessmentSchema
  ),
  'assessments:setArchived': channel(
    z.object({ id: idSchema, archived: z.boolean() }),
    assessmentSchema
  ),
  'assessments:impact': channel(z.object({ id: idSchema }), impactSchema),
  'assessments:delete': channel(z.object({ id: idSchema }), ok),

  // ─── results:* ─────────────────────────────────────────────────────────────
  'results:listByAssessment': channel(
    z.object({ assessmentId: idSchema }),
    z.array(resultRowSchema)
  ),
  'results:save': channel(
    z.object({ id: idSchema.nullable(), input: assessmentResultInputSchema }),
    resultRowSchema
  ),
  'results:delete': channel(z.object({ id: idSchema }), ok),
  /** Reprocessa classificações desta avaliação — ação explícita, ADR-004. */
  'results:reprocess': channel(
    z.object({ assessmentId: idSchema }),
    z.object({ updated: z.number().int(), unchanged: z.number().int(), unresolved: z.number().int() })
  ),
  /** Prévia do reprocessamento: o que mudaria, antes de confirmar. */
  'results:reprocessPreview': channel(
    z.object({ assessmentId: idSchema }),
    z.array(
      z.object({
        resultId: idSchema,
        instrumentName: z.string(),
        from: z.string().nullable(),
        to: z.string().nullable()
      })
    )
  ),

  // ─── reports:* ─────────────────────────────────────────────────────────────
  'reports:generate': channel(
    z.object({
      kind: z.enum(REPORT_KINDS),
      assessmentId: idSchema.nullable(),
      comparisonAssessmentId: idSchema.nullable(),
      documentId: idSchema.nullable()
    }),
    z.object({ filePath: z.string(), cancelled: z.boolean() })
  ),

  // ─── attachments:* ─────────────────────────────────────────────────────────
  'attachments:list': channel(
    z.object({
      patientId: idSchema,
      assessmentId: idSchema.nullable().default(null),
      includeArchived: z.boolean().default(false)
    }),
    z.array(attachmentSchema)
  ),
  /** Abre o seletor de arquivos no processo principal (§8.4). */
  'attachments:pickAndAdd': channel(
    z.object({ patientId: idSchema, assessmentId: idSchema.nullable() }),
    z.object({
      added: z.array(attachmentSchema),
      rejected: z.array(z.object({ name: z.string(), reason: z.string() }))
    })
  ),
  /** Drag-and-drop: caminhos vindos de `webUtils.getPathForFile` no preload. */
  'attachments:addFromPaths': channel(
    z.object({
      patientId: idSchema,
      assessmentId: idSchema.nullable(),
      paths: z.array(z.string()).max(50)
    }),
    z.object({
      added: z.array(attachmentSchema),
      rejected: z.array(z.object({ name: z.string(), reason: z.string() }))
    })
  ),
  'attachments:update': channel(
    z.object({
      id: idSchema,
      description: z.string().max(20_000).nullable(),
      tags: z.array(z.string().trim().min(1).max(60)).max(30),
      assessmentId: idSchema.nullable()
    }),
    attachmentSchema
  ),
  'attachments:setArchived': channel(
    z.object({ id: idSchema, archived: z.boolean() }),
    attachmentSchema
  ),
  'attachments:delete': channel(z.object({ id: idSchema }), ok),
  /** URL `baremo-file://` para exibir no renderer — nunca um caminho de disco. */
  'attachments:url': channel(z.object({ id: idSchema }), z.object({ url: z.string() })),
  /** Abre no app externo do sistema; só por ação explícita do usuário (§8.4). */
  'attachments:openExternal': channel(z.object({ id: idSchema }), ok),
  'attachments:quota': channel(
    empty,
    z.object({ totalBytes: z.number().int(), warnAboveBytes: z.number().int() })
  ),

  // ─── documents:* ───────────────────────────────────────────────────────────
  'documents:list': channel(
    z.object({ patientId: idSchema, assessmentId: idSchema.nullable().default(null) }),
    z.array(documentSchema.omit({ contentJson: true }))
  ),
  'documents:get': channel(z.object({ id: idSchema }), documentSchema),
  'documents:create': channel(
    z.object({
      patientId: idSchema,
      assessmentId: idSchema.nullable(),
      type: z.enum(DOCUMENT_TYPES),
      title: z.string().trim().min(1).max(200),
      templateId: idSchema.nullable()
    }),
    documentSchema
  ),
  'documents:saveContent': channel(
    z.object({ id: idSchema, contentJson: tiptapContentSchema }),
    z.object({ updatedAt: timestampSchema, versionCreated: z.boolean() })
  ),
  'documents:updateMeta': channel(
    z.object({
      id: idSchema,
      title: z.string().trim().min(1).max(200),
      type: z.enum(DOCUMENT_TYPES),
      assessmentId: idSchema.nullable()
    }),
    documentSchema
  ),
  'documents:setStatus': channel(
    z.object({ id: idSchema, status: z.enum(DOCUMENT_STATUSES) }),
    documentSchema
  ),
  /** Revisão explícita de documento assistido por IA, exigida antes de finalizar (§10.9). */
  'documents:markReviewed': channel(z.object({ id: idSchema }), documentSchema),
  'documents:listVersions': channel(
    z.object({ documentId: idSchema }),
    z.array(documentVersionSchema.omit({ contentJson: true }))
  ),
  'documents:getVersion': channel(z.object({ versionId: idSchema }), documentVersionSchema),
  'documents:restoreVersion': channel(
    z.object({ documentId: idSchema, versionId: idSchema }),
    documentSchema
  ),
  'documents:delete': channel(z.object({ id: idSchema }), ok),
  'documents:listTemplates': channel(empty, z.array(documentTemplateSchema)),
  'documents:saveTemplate': channel(
    z.object({
      id: idSchema.nullable(),
      type: z.enum(DOCUMENT_TYPES),
      name: z.string().trim().min(1).max(200),
      contentJson: tiptapContentSchema
    }),
    documentTemplateSchema
  ),
  'documents:deleteTemplate': channel(z.object({ id: idSchema }), ok),
  /** Dados do nó `bloco-resultados`, lidos no momento da renderização (§9.2). */
  'documents:resultsBlock': channel(
    z.object({
      assessmentId: idSchema,
      cognitiveFunctionId: idSchema.nullable().default(null)
    }),
    z.object({
      assessmentDate: isoDateSchema,
      rows: z.array(
        z.object({
          instrumentPath: z.string(),
          cognitiveFunctionName: z.string().nullable(),
          scoreTypeLabel: z.string(),
          value: z.number().nullable(),
          statusLabel: z.string(),
          classificationName: z.string().nullable(),
          colorHex: hexColorSchema.nullable()
        })
      )
    })
  ),
  /** Série por função cognitiva para o nó `bloco-grafico`. */
  'documents:profileChart': channel(
    z.object({ assessmentId: idSchema }),
    z.object({
      points: z.array(
        z.object({
          cognitiveFunctionName: z.string(),
          /** Percentil normalizado 0–100, para pôr tipos de escore diferentes na mesma escala. */
          normalized: z.number(),
          sampleCount: z.number().int()
        })
      )
    })
  ),

  // ─── maintenance:* ─────────────────────────────────────────────────────────
  'maintenance:listBackups': channel(empty, z.array(backupSchema)),
  'maintenance:createBackup': channel(empty, backupSchema),
  'maintenance:restoreBackup': channel(z.object({ fileName: z.string() }), ok),
  'maintenance:integrityCheck': channel(
    empty,
    z.object({ ok: z.boolean(), detail: z.string() })
  ),
  'maintenance:scanFiles': channel(
    empty,
    z.object({
      orphanBlobs: z.array(z.object({ relativePath: z.string(), sizeBytes: z.number().int() })),
      brokenReferences: z.array(
        z.object({ attachmentId: idSchema, originalName: z.string(), sha256: z.string() })
      )
    })
  ),
  'maintenance:cleanupFiles': channel(
    z.object({ deleteOrphanBlobs: z.boolean(), removeBrokenReferences: z.boolean() }),
    z.object({ blobsDeleted: z.number().int(), referencesRemoved: z.number().int() })
  ),
  /** Exportação de prontuário em .zip (§6.4). */
  'maintenance:exportMedicalRecord': channel(
    z.object({ patientId: idSchema }),
    z.object({ filePath: z.string(), cancelled: z.boolean() })
  ),
  'maintenance:listAudit': channel(
    z.object({ limit: z.number().int().min(1).max(500).default(200) }),
    z.array(auditLogSchema)
  ),

  // ─── ai:* ──────────────────────────────────────────────────────────────────
  'ai:getConfig': channel(empty, aiConfigSchema),
  'ai:setEnabled': channel(z.object({ enabled: z.boolean() }), aiConfigSchema),
  'ai:setModel': channel(z.object({ model: z.enum(AI_MODELS) }), aiConfigSchema),
  /** Desligar a pseudonimização exige confirmação e vira registro (§10.3). */
  'ai:setPseudonymize': channel(
    z.object({ enabled: z.boolean(), confirmed: z.boolean() }),
    aiConfigSchema
  ),
  'ai:setBudget': channel(
    z.object({ monthlyTokenBudget: z.number().int().min(0) }),
    aiConfigSchema
  ),
  /** A chave sobe uma vez e nunca volta: o renderer só recebe `keyHint` (§10.1). */
  'ai:saveKey': channel(
    z.object({ key: z.string().min(1).max(500), persist: z.boolean() }),
    aiConfigSchema
  ),
  'ai:testKey': channel(
    z.object({ key: z.string().min(1).max(500) }),
    z.object({ ok: z.boolean(), message: z.string() })
  ),
  'ai:clearKey': channel(empty, aiConfigSchema),
  'ai:getConsent': channel(
    z.object({ patientId: idSchema.nullable() }),
    z.object({ moduleGranted: z.boolean(), patientGranted: z.boolean(), textVersion: z.string() })
  ),
  'ai:grantConsent': channel(
    z.object({ scope: z.enum(['module', 'patient']), patientId: idSchema.nullable() }),
    ok
  ),
  'ai:listSessions': channel(z.object({ patientId: idSchema }), z.array(aiSessionSchema)),
  'ai:createSession': channel(
    z.object({ patientId: idSchema, title: z.string().trim().max(200) }),
    aiSessionSchema
  ),
  'ai:deleteSession': channel(z.object({ sessionId: idSchema }), ok),
  'ai:listMessages': channel(z.object({ sessionId: idSchema }), z.array(aiMessageSchema)),
  /** Dispara o turno; a resposta chega pelo canal de streaming, por `requestId`. */
  'ai:sendMessage': channel(
    z.object({
      sessionId: idSchema,
      text: z.string().trim().min(1).max(20_000),
      requestId: z.string().min(1).max(80)
    }),
    ok
  ),
  'ai:cancel': channel(z.object({ requestId: z.string().min(1).max(80) }), ok),
  'ai:confirmToolCall': channel(
    z.object({
      confirmationId: z.string().min(1).max(80),
      approved: z.boolean(),
      /**
       * Índices dos blocos aceitos, quando a confirmação traz um diff (§10.6).
       * `null` significa "aplicar a proposta inteira" — o caso das tools que não
       * produzem diff, como a criação de rascunho.
       */
      acceptedBlocks: z.array(z.number().int()).nullable().default(null)
    }),
    ok
  ),
  'ai:listAudit': channel(
    z.object({ limit: z.number().int().min(1).max(500).default(200) }),
    z.array(aiAuditSchema)
  )
} as const satisfies Record<string, ChannelContract>

export type Contracts = typeof contracts
export type ChannelName = keyof Contracts

export type ChannelInput<C extends ChannelName> = z.input<Contracts[C]['input']>
export type ChannelOutput<C extends ChannelName> = z.output<Contracts[C]['output']>

export const CHANNEL_NAMES = Object.keys(contracts) as ChannelName[]

/** Canal de mão única main → renderer, para o streaming da IA (§10.4). */
export const AI_STREAM_CHANNEL = 'ai:stream'

// ─── Envelope de resultado ───────────────────────────────────────────────────

export interface IpcError {
  readonly code: IpcErrorCode
  readonly message: string
  /** Detalhes estruturados — hoje, os problemas de validação Zod. */
  readonly details?: unknown
}

export type IpcErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'io'
  | 'internal'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }
