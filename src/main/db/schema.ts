/**
 * Schema Drizzle (spec §4, §14).
 *
 * O DDL correspondente vive em `migrations.ts`, escrito à mão para que as
 * migrations viajem dentro do bundle do processo principal — arquivos `.sql`
 * soltos exigiriam `extraResources` no empacotamento e mais um jeito de o app
 * quebrar em produção. `tests/unit/schema-drift.spec.ts` compara as duas
 * definições coluna a coluna e falha o build se divergirem.
 */

import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`

// ─── Configuração ────────────────────────────────────────────────────────────

/** Registro único: `id` é sempre `'singleton'` (§4.1, premissa P1). */
export const professionalProfile = sqliteTable('professional_profile', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  crp: text('crp').notNull().default(''),
  specialty: text('specialty').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  address: text('address').notNull().default(''),
  logoDataUrl: text('logo_data_url')
})

/** Pares chave/valor para preferências que não merecem tabela própria. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const colors = sqliteTable('colors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hex: text('hex').notNull(),
  order: integer('order').notNull().default(0),
  isSeed: integer('is_seed', { mode: 'boolean' }).notNull().default(false)
})

// ─── Prontuário ──────────────────────────────────────────────────────────────

export const patients = sqliteTable(
  'patients',
  {
    id: text('id').primaryKey(),
    fullName: text('full_name').notNull(),
    birthDate: text('birth_date'),
    sex: text('sex').notNull().default('unspecified'),
    education: text('education'),
    handedness: text('handedness').notNull().default('unspecified'),
    guardian: text('guardian'),
    contact: text('contact'),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
    archivedAt: text('archived_at')
  },
  (table) => [index('idx_patients_name').on(table.fullName)]
)

export const cognitiveFunctions = sqliteTable(
  'cognitive_functions',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    order: integer('order').notNull().default(0)
  },
  (table) => [index('idx_cognitive_functions_parent').on(table.parentId)]
)

export const instruments = sqliteTable(
  'instruments',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    acronym: text('acronym'),
    cognitiveFunctionId: text('cognitive_function_id'),
    minAgeYears: integer('min_age_years'),
    maxAgeYears: integer('max_age_years'),
    reference: text('reference'),
    order: integer('order').notNull().default(0)
  },
  (table) => [
    index('idx_instruments_parent').on(table.parentId),
    index('idx_instruments_function').on(table.cognitiveFunctionId)
  ]
)

export const classificationRanges = sqliteTable(
  'classification_ranges',
  {
    id: text('id').primaryKey(),
    instrumentId: text('instrument_id').notNull(),
    scoreType: text('score_type').notNull(),
    classificationName: text('classification_name').notNull(),
    minValue: real('min_value').notNull(),
    maxValue: real('max_value').notNull(),
    colorId: text('color_id').notNull(),
    version: integer('version').notNull().default(1),
    /** Ordinal 1–5 que dá ordem ao nome livre da faixa (§4.6). Nulo = não definido. */
    level: integer('level'),
    /** Escore alto indica PIOR desempenho — escalas de sintoma. */
    inverted: integer('inverted', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [index('idx_ranges_instrument_type').on(table.instrumentId, table.scoreType)]
)

export const assessments = sqliteTable(
  'assessments',
  {
    id: text('id').primaryKey(),
    patientId: text('patient_id').notNull(),
    date: text('date').notNull(),
    referralReason: text('referral_reason'),
    complaint: text('complaint'),
    notes: text('notes'),
    createdAt: text('created_at').notNull().default(now),
    archivedAt: text('archived_at')
  },
  (table) => [index('idx_assessments_patient').on(table.patientId)]
)

export const assessmentResults = sqliteTable(
  'assessment_results',
  {
    id: text('id').primaryKey(),
    assessmentId: text('assessment_id').notNull(),
    instrumentId: text('instrument_id').notNull(),
    scoreType: text('score_type').notNull(),
    value: real('value'),
    status: text('status').notNull().default('applied'),
    // Snapshot imutável da classificação — ADR-004.
    classificationName: text('classification_name'),
    colorHex: text('color_hex'),
    rangeId: text('range_id'),
    rangeVersion: integer('range_version'),
    manuallyOverridden: integer('manually_overridden', { mode: 'boolean' })
      .notNull()
      .default(false),
    notes: text('notes'),
    /** Nível 1–5 da faixa que classificou, copiado no snapshot. Nulo antes da migration 2. */
    classificationLevel: integer('classification_level')
  },
  (table) => [
    index('idx_results_assessment').on(table.assessmentId),
    uniqueIndex('uq_results_assessment_instrument_type').on(
      table.assessmentId,
      table.instrumentId,
      table.scoreType
    )
  ]
)

// ─── Arquivos (§8) ───────────────────────────────────────────────────────────

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    patientId: text('patient_id').notNull(),
    assessmentId: text('assessment_id'),
    originalName: text('original_name').notNull(),
    sha256: text('sha256').notNull(),
    extension: text('extension').notNull().default(''),
    detectedMime: text('detected_mime').notNull().default(''),
    sizeBytes: integer('size_bytes').notNull().default(0),
    description: text('description'),
    /** JSON array — o volume de tags não justifica tabela de junção. */
    tags: text('tags').notNull().default('[]'),
    createdAt: text('created_at').notNull().default(now),
    archivedAt: text('archived_at')
  },
  (table) => [
    index('idx_attachments_patient').on(table.patientId),
    index('idx_attachments_sha').on(table.sha256)
  ]
)

// ─── Documentos (§9) ─────────────────────────────────────────────────────────

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    patientId: text('patient_id').notNull(),
    assessmentId: text('assessment_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    /** JSON do TipTap, nunca HTML (§9.4). */
    contentJson: text('content_json').notNull(),
    status: text('status').notNull().default('draft'),
    origin: text('origin').notNull().default('human'),
    reviewedAt: text('reviewed_at'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
    finalizedAt: text('finalized_at')
  },
  (table) => [index('idx_documents_patient').on(table.patientId)]
)

export const documentVersions = sqliteTable(
  'document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id').notNull(),
    contentJson: text('content_json').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull().default(now)
  },
  (table) => [index('idx_document_versions_document').on(table.documentId)]
)

export const documentTemplates = sqliteTable('document_templates', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  contentJson: text('content_json').notNull(),
  isSeed: integer('is_seed', { mode: 'boolean' }).notNull().default(false)
})

// ─── Auditoria (§4.12) ───────────────────────────────────────────────────────

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    timestamp: text('timestamp').notNull().default(now),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    action: text('action').notNull(),
    summary: text('summary').notNull().default('')
  },
  (table) => [index('idx_audit_timestamp').on(table.timestamp)]
)

// ─── Módulo de IA (§4.11, §10) ───────────────────────────────────────────────

/** Registro único, `id = 'singleton'`. A chave de API NÃO fica aqui (§10.2). */
export const aiConfig = sqliteTable('ai_config', {
  id: text('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  model: text('model').notNull().default('gemini-flash-latest'),
  keyHint: text('key_hint'),
  keyPersisted: integer('key_persisted', { mode: 'boolean' }).notNull().default(true),
  pseudonymize: integer('pseudonymize', { mode: 'boolean' }).notNull().default(true),
  monthlyTokenBudget: integer('monthly_token_budget').notNull().default(1_000_000),
  tokensUsedThisMonth: integer('tokens_used_this_month').notNull().default(0),
  budgetPeriod: text('budget_period').notNull().default('')
})

export const aiSessions = sqliteTable(
  'ai_sessions',
  {
    id: text('id').primaryKey(),
    /** Imutável após a criação — §10.1, princípio 3. */
    patientId: text('patient_id').notNull(),
    title: text('title').notNull().default(''),
    model: text('model').notNull(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now)
  },
  (table) => [index('idx_ai_sessions_patient').on(table.patientId)]
)

export const aiMessages = sqliteTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    text: text('text').notNull().default(''),
    toolName: text('tool_name'),
    createdAt: text('created_at').notNull().default(now)
  },
  (table) => [index('idx_ai_messages_session').on(table.sessionId)]
)

export const aiToolCalls = sqliteTable(
  'ai_tool_calls',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    messageId: text('message_id'),
    toolName: text('tool_name').notNull(),
    argumentsJson: text('arguments_json').notNull().default('{}'),
    status: text('status').notNull(),
    resultSummary: text('result_summary'),
    createdAt: text('created_at').notNull().default(now)
  },
  (table) => [index('idx_ai_tool_calls_session').on(table.sessionId)]
)

export const consents = sqliteTable(
  'consents',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    patientId: text('patient_id'),
    grantedAt: text('granted_at').notNull().default(now),
    consentTextVersion: text('consent_text_version').notNull()
  },
  (table) => [uniqueIndex('uq_consents_scope_patient').on(table.scope, table.patientId)]
)

export const aiAudit = sqliteTable(
  'ai_audit',
  {
    id: text('id').primaryKey(),
    timestamp: text('timestamp').notNull().default(now),
    sessionId: text('session_id'),
    patientId: text('patient_id'),
    model: text('model').notNull().default(''),
    toolCallsJson: text('tool_calls_json').notNull().default('[]'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    pseudonymized: integer('pseudonymized', { mode: 'boolean' }).notNull().default(true),
    blockedBySafetyFilter: integer('blocked_by_safety_filter', { mode: 'boolean' })
      .notNull()
      .default(false),
    idRevalidationFailed: integer('id_revalidation_failed', { mode: 'boolean' })
      .notNull()
      .default(false),
    detail: text('detail')
  },
  (table) => [index('idx_ai_audit_timestamp').on(table.timestamp)]
)

export const SINGLETON_ID = 'singleton'
