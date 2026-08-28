/**
 * Migrations (spec §14.2).
 *
 * Escritas à mão e compiladas dentro do bundle: assim o app nunca depende de
 * arquivos `.sql` soltos sobrevivendo ao empacotamento. Cada entrada é aplicada
 * em ordem, dentro de uma transação, e `PRAGMA user_version` guarda até onde o
 * banco chegou — é o `schema_version` do §14.2.
 *
 * REGRA: uma migration publicada nunca é editada. Divergência de schema se
 * corrige com uma migration nova.
 */

export interface Migration {
  readonly version: number
  readonly name: string
  readonly statements: readonly string[]
}

const initial: Migration = {
  version: 1,
  name: 'esquema-inicial',
  statements: [
    `CREATE TABLE professional_profile (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL DEFAULT '',
       crp TEXT NOT NULL DEFAULT '',
       specialty TEXT NOT NULL DEFAULT '',
       phone TEXT NOT NULL DEFAULT '',
       email TEXT NOT NULL DEFAULT '',
       address TEXT NOT NULL DEFAULT '',
       logo_data_url TEXT
     )`,

    `CREATE TABLE app_settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,

    `CREATE TABLE colors (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       hex TEXT NOT NULL,
       "order" INTEGER NOT NULL DEFAULT 0,
       is_seed INTEGER NOT NULL DEFAULT 0
     )`,

    `CREATE TABLE patients (
       id TEXT PRIMARY KEY,
       full_name TEXT NOT NULL,
       birth_date TEXT,
       sex TEXT NOT NULL DEFAULT 'unspecified',
       education TEXT,
       handedness TEXT NOT NULL DEFAULT 'unspecified',
       guardian TEXT,
       contact TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       archived_at TEXT
     )`,
    `CREATE INDEX idx_patients_name ON patients (full_name)`,

    `CREATE TABLE cognitive_functions (
       id TEXT PRIMARY KEY,
       parent_id TEXT REFERENCES cognitive_functions(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       description TEXT,
       "order" INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX idx_cognitive_functions_parent ON cognitive_functions (parent_id)`,

    // Excluir uma função cognitiva remove o VÍNCULO com os instrumentos (§6.3),
    // não os instrumentos — daí SET NULL, e não CASCADE.
    `CREATE TABLE instruments (
       id TEXT PRIMARY KEY,
       parent_id TEXT REFERENCES instruments(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       acronym TEXT,
       cognitive_function_id TEXT REFERENCES cognitive_functions(id) ON DELETE SET NULL,
       min_age_years INTEGER,
       max_age_years INTEGER,
       reference TEXT,
       "order" INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX idx_instruments_parent ON instruments (parent_id)`,
    `CREATE INDEX idx_instruments_function ON instruments (cognitive_function_id)`,

    `CREATE TABLE classification_ranges (
       id TEXT PRIMARY KEY,
       instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
       score_type TEXT NOT NULL,
       classification_name TEXT NOT NULL,
       min_value REAL NOT NULL,
       max_value REAL NOT NULL,
       color_id TEXT NOT NULL REFERENCES colors(id) ON DELETE RESTRICT,
       version INTEGER NOT NULL DEFAULT 1
     )`,
    `CREATE INDEX idx_ranges_instrument_type ON classification_ranges (instrument_id, score_type)`,

    `CREATE TABLE assessments (
       id TEXT PRIMARY KEY,
       patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
       date TEXT NOT NULL,
       referral_reason TEXT,
       complaint TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       archived_at TEXT
     )`,
    `CREATE INDEX idx_assessments_patient ON assessments (patient_id)`,

    // range_id e range_version NÃO têm FK de propósito: são rastro do snapshot
    // (§4.8 / ADR-004). Uma FK obrigaria a escolher entre travar a edição das
    // faixas e apagar o rastro — as duas piores que guardar o ID solto.
    `CREATE TABLE assessment_results (
       id TEXT PRIMARY KEY,
       assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
       instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
       score_type TEXT NOT NULL,
       value REAL,
       status TEXT NOT NULL DEFAULT 'applied',
       classification_name TEXT,
       color_hex TEXT,
       range_id TEXT,
       range_version INTEGER,
       manually_overridden INTEGER NOT NULL DEFAULT 0,
       notes TEXT
     )`,
    `CREATE INDEX idx_results_assessment ON assessment_results (assessment_id)`,
    `CREATE UNIQUE INDEX uq_results_assessment_instrument_type
       ON assessment_results (assessment_id, instrument_id, score_type)`,

    `CREATE TABLE attachments (
       id TEXT PRIMARY KEY,
       patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
       assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
       original_name TEXT NOT NULL,
       sha256 TEXT NOT NULL,
       extension TEXT NOT NULL DEFAULT '',
       detected_mime TEXT NOT NULL DEFAULT '',
       size_bytes INTEGER NOT NULL DEFAULT 0,
       description TEXT,
       tags TEXT NOT NULL DEFAULT '[]',
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       archived_at TEXT
     )`,
    `CREATE INDEX idx_attachments_patient ON attachments (patient_id)`,
    `CREATE INDEX idx_attachments_sha ON attachments (sha256)`,

    `CREATE TABLE documents (
       id TEXT PRIMARY KEY,
       patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
       assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,
       type TEXT NOT NULL,
       title TEXT NOT NULL,
       content_json TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'draft',
       origin TEXT NOT NULL DEFAULT 'human',
       reviewed_at TEXT,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       finalized_at TEXT
     )`,
    `CREATE INDEX idx_documents_patient ON documents (patient_id)`,

    `CREATE TABLE document_versions (
       id TEXT PRIMARY KEY,
       document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
       content_json TEXT NOT NULL,
       reason TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
    `CREATE INDEX idx_document_versions_document ON document_versions (document_id)`,

    `CREATE TABLE document_templates (
       id TEXT PRIMARY KEY,
       type TEXT NOT NULL,
       name TEXT NOT NULL,
       content_json TEXT NOT NULL,
       is_seed INTEGER NOT NULL DEFAULT 0
     )`,

    // Sem FK: a auditoria precisa sobreviver à exclusão do que ela registra.
    `CREATE TABLE audit_log (
       id TEXT PRIMARY KEY,
       timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       entity TEXT NOT NULL,
       entity_id TEXT,
       action TEXT NOT NULL,
       summary TEXT NOT NULL DEFAULT ''
     )`,
    `CREATE INDEX idx_audit_timestamp ON audit_log (timestamp)`,

    `CREATE TABLE ai_config (
       id TEXT PRIMARY KEY,
       enabled INTEGER NOT NULL DEFAULT 0,
       model TEXT NOT NULL DEFAULT 'gemini-flash-latest',
       key_hint TEXT,
       key_persisted INTEGER NOT NULL DEFAULT 1,
       pseudonymize INTEGER NOT NULL DEFAULT 1,
       monthly_token_budget INTEGER NOT NULL DEFAULT 1000000,
       tokens_used_this_month INTEGER NOT NULL DEFAULT 0,
       budget_period TEXT NOT NULL DEFAULT ''
     )`,

    `CREATE TABLE ai_sessions (
       id TEXT PRIMARY KEY,
       patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
       title TEXT NOT NULL DEFAULT '',
       model TEXT NOT NULL,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
    `CREATE INDEX idx_ai_sessions_patient ON ai_sessions (patient_id)`,

    `CREATE TABLE ai_messages (
       id TEXT PRIMARY KEY,
       session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
       role TEXT NOT NULL,
       text TEXT NOT NULL DEFAULT '',
       tool_name TEXT,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
    `CREATE INDEX idx_ai_messages_session ON ai_messages (session_id)`,

    `CREATE TABLE ai_tool_calls (
       id TEXT PRIMARY KEY,
       session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
       message_id TEXT,
       tool_name TEXT NOT NULL,
       arguments_json TEXT NOT NULL DEFAULT '{}',
       status TEXT NOT NULL,
       result_summary TEXT,
       created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
    `CREATE INDEX idx_ai_tool_calls_session ON ai_tool_calls (session_id)`,

    `CREATE TABLE consents (
       id TEXT PRIMARY KEY,
       scope TEXT NOT NULL,
       patient_id TEXT REFERENCES patients(id) ON DELETE CASCADE,
       granted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       consent_text_version TEXT NOT NULL
     )`,
    // COALESCE porque o SQLite considera NULLs distintos num índice único: sem
    // isso, o consentimento de módulo (patient_id NULL) poderia duplicar.
    `CREATE UNIQUE INDEX uq_consents_scope_patient
       ON consents (scope, COALESCE(patient_id, ''))`,

    `CREATE TABLE ai_audit (
       id TEXT PRIMARY KEY,
       timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
       session_id TEXT,
       patient_id TEXT,
       model TEXT NOT NULL DEFAULT '',
       tool_calls_json TEXT NOT NULL DEFAULT '[]',
       input_tokens INTEGER NOT NULL DEFAULT 0,
       output_tokens INTEGER NOT NULL DEFAULT 0,
       pseudonymized INTEGER NOT NULL DEFAULT 1,
       blocked_by_safety_filter INTEGER NOT NULL DEFAULT 0,
       id_revalidation_failed INTEGER NOT NULL DEFAULT 0,
       detail TEXT
     )`,
    `CREATE INDEX idx_ai_audit_timestamp ON ai_audit (timestamp)`
  ]
}

export const MIGRATIONS: readonly Migration[] = [initial]

/** Versão de schema que este binário conhece. */
export const TARGET_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0
)
