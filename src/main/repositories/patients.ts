/**
 * Pacientes (spec §4.2, §6.2).
 *
 * Arquivar é a ação padrão e reversível; excluir definitivamente é operação
 * separada, exige digitar o nome do paciente e apaga os blobs dos anexos.
 * A guarda mínima de prontuário (Res. CFP nº 001/2009) é incompatível com
 * exclusão casual.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, like, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { BaremoDatabase } from '../db/gateway'
import { assessments, attachments, documents, patients } from '../db/schema'
import type { Patient, PatientInput } from '@shared/contracts/entities'
import { conflict, notFound } from '../ipc/register'
import { countWhere, escapeLike, nowIso, normalizeForComparison } from './helpers'
import type { Impact } from './helpers'

export function listPatients(
  handle: BaremoDatabase,
  options: { query: string; includeArchived: boolean }
): Patient[] {
  const filters: SQL[] = []

  if (!options.includeArchived) {
    filters.push(isNull(patients.archivedAt))
  }

  const term = options.query.trim()
  if (term.length > 0) {
    const pattern = `%${escapeLike(term)}%`
    const matches = or(
      like(patients.fullName, pattern),
      like(patients.contact, pattern),
      like(patients.guardian, pattern)
    )
    if (matches) filters.push(matches)
  }

  return handle.db
    .select()
    .from(patients)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(patients.fullName))
    .all() as Patient[]
}

export function getPatient(handle: BaremoDatabase, id: string): Patient {
  const row = handle.db.select().from(patients).where(eq(patients.id, id)).get()
  if (!row) throw notFound('Paciente não encontrado.')
  return row as Patient
}

export function createPatient(handle: BaremoDatabase, input: PatientInput): Patient {
  const id = randomUUID()
  handle.db
    .insert(patients)
    .values({ id, ...input, createdAt: nowIso(), archivedAt: null })
    .run()
  return getPatient(handle, id)
}

export function updatePatient(handle: BaremoDatabase, id: string, input: PatientInput): Patient {
  const result = handle.db.update(patients).set(input).where(eq(patients.id, id)).run()
  if (result.changes === 0) throw notFound('Paciente não encontrado.')
  return getPatient(handle, id)
}

export function setPatientArchived(
  handle: BaremoDatabase,
  id: string,
  archived: boolean
): Patient {
  const result = handle.db
    .update(patients)
    .set({ archivedAt: archived ? nowIso() : null })
    .where(eq(patients.id, id))
    .run()
  if (result.changes === 0) throw notFound('Paciente não encontrado.')
  return getPatient(handle, id)
}

/** Contagem de vínculos para o modal de confirmação (§6.3). */
export function patientImpact(handle: BaremoDatabase, id: string): Impact {
  const patient = getPatient(handle, id)

  return {
    label: patient.fullName,
    counts: [
      { entity: 'Avaliações', count: countWhere(handle, assessments, eq(assessments.patientId, id)) },
      {
        entity: 'Arquivos anexados',
        count: countWhere(handle, attachments, eq(attachments.patientId, id))
      },
      { entity: 'Documentos', count: countWhere(handle, documents, eq(documents.patientId, id)) }
    ]
  }
}

export interface BlobRef {
  readonly sha256: string
  readonly extension: string
}

/**
 * Blobs que ficarão sem referência se este paciente for excluído.
 *
 * Precisa ser consultado ANTES do DELETE: depois da cascata não há como saber
 * quais arquivos eram dele. Só entram os hashes que nenhum OUTRO paciente usa —
 * o armazenamento é deduplicado (§8.3), e apagar um blob compartilhado quebraria
 * o anexo de outro prontuário.
 */
export function orphanBlobsIfPatientDeleted(
  handle: BaremoDatabase,
  patientId: string
): BlobRef[] {
  return handle.raw
    .prepare(
      `SELECT DISTINCT a.sha256 AS sha256, a.extension AS extension
         FROM attachments a
        WHERE a.patient_id = ?
          AND NOT EXISTS (
                SELECT 1 FROM attachments b
                 WHERE b.sha256 = a.sha256
                   AND b.patient_id <> ?
              )`
    )
    .all(patientId, patientId) as BlobRef[]
}

export function deletePatient(
  handle: BaremoDatabase,
  id: string,
  confirmationName: string
): void {
  const patient = getPatient(handle, id)

  // A confirmação por digitação é o que separa "arquivar" de "excluir" (§6.2).
  if (normalizeForComparison(confirmationName) !== normalizeForComparison(patient.fullName)) {
    throw conflict(
      'O nome digitado não confere com o do paciente. A exclusão definitiva foi cancelada.'
    )
  }

  handle.db.delete(patients).where(eq(patients.id, id)).run()
}
