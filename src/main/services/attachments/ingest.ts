/**
 * Ingestão de arquivos (spec §8.4).
 *
 * Três regras que valem para todo arquivo que entra:
 *
 *  1. **O tipo é decidido por magic number, não por extensão.** Um `.exe`
 *     renomeado para `.png` seria aceito por qualquer checagem de sufixo.
 *  2. **O nome original é apenas metadado.** O nome no disco é o hash; nome de
 *     usuário nunca vira caminho, o que remove de vez a classe de bugs de
 *     traversal e de caractere inválido por nome de arquivo.
 *  3. **Nada é executado.** Tipos sem preview interno abrem no app externo
 *     apenas por ação explícita do usuário.
 */

import { randomUUID } from 'node:crypto'
import { basename, extname } from 'node:path'
import { stat } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../../db/gateway'
import { attachments } from '../../db/schema'
import type { Attachment } from '@shared/contracts/entities'
import { storeFile } from './storage'
import { nowIso } from '../../repositories/helpers'

/** Allowlist da §8.4, por MIME detectado. */
const ALLOWED_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/mp4': 'mp4'
}

/**
 * CSV e TXT não têm magic number: são texto puro, e `file-type` não os
 * reconhece. Para eles a decisão volta a ser pela extensão, e por isso o
 * conteúdo passa por uma checagem adicional de "parece texto?" antes de entrar.
 */
const TEXT_EXTENSIONS: Readonly<Record<string, string>> = {
  '.csv': 'text/csv',
  '.txt': 'text/plain'
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024

export interface IngestResult {
  readonly added: Attachment[]
  readonly rejected: { name: string; reason: string }[]
}

export async function ingestFiles(
  handle: BaremoDatabase,
  input: {
    patientId: string
    assessmentId: string | null
    paths: readonly string[]
  }
): Promise<IngestResult> {
  const added: Attachment[] = []
  const rejected: { name: string; reason: string }[] = []

  for (const path of input.paths) {
    const name = basename(path)
    try {
      const attachment = await ingestOne(handle, input.patientId, input.assessmentId, path)
      added.push(attachment)
    } catch (error) {
      rejected.push({
        name,
        reason: error instanceof Error ? error.message : 'Falha desconhecida ao anexar.'
      })
    }
  }

  return { added, rejected }
}

async function ingestOne(
  handle: BaremoDatabase,
  patientId: string,
  assessmentId: string | null,
  path: string
): Promise<Attachment> {
  const stats = await stat(path).catch(() => null)
  if (stats === null || !stats.isFile()) {
    throw new Error('Arquivo não encontrado ou não é um arquivo comum.')
  }

  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(
      `Arquivo maior que o limite de ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`
    )
  }
  if (stats.size === 0) {
    throw new Error('Arquivo vazio.')
  }

  const detected = await detectType(path)
  if (detected === null) {
    throw new Error(
      'Tipo de arquivo não permitido. Aceitos: PDF, PNG, JPEG, WebP, DOCX, XLSX, CSV, TXT, MP3, M4A, WAV e MP4.'
    )
  }

  const stored = await storeFile(path, detected.extension)

  const attachment: Attachment = {
    id: randomUUID(),
    patientId,
    assessmentId,
    originalName: basename(path).slice(0, 400),
    sha256: stored.sha256,
    extension: detected.extension,
    detectedMime: detected.mime,
    sizeBytes: stored.sizeBytes,
    description: null,
    tags: [],
    createdAt: nowIso(),
    archivedAt: null
  }

  handle.db
    .insert(attachments)
    .values({ ...attachment, tags: JSON.stringify(attachment.tags) })
    .run()

  return attachment
}

interface DetectedType {
  readonly mime: string
  readonly extension: string
}

/**
 * `file-type` é ESM puro e pesado; o import dinâmico mantém o custo fora do boot
 * e evita forçar a topologia de módulos do resto do main.
 */
async function detectType(path: string): Promise<DetectedType | null> {
  const { fileTypeFromFile } = await import('file-type')
  const detected = await fileTypeFromFile(path)

  if (detected) {
    const extension = ALLOWED_MIME[detected.mime]
    return extension ? { mime: detected.mime, extension } : null
  }

  // Sem magic number: só os tipos de texto da allowlist seguem, e ainda assim
  // depois de confirmar que o conteúdo é mesmo texto.
  const suffix = extname(path).toLowerCase()
  const mime = TEXT_EXTENSIONS[suffix]
  if (mime === undefined) return null

  if (!(await looksLikeText(path))) return null
  return { mime, extension: suffix.slice(1) }
}

/**
 * Heurística de texto: lê o começo do arquivo e recusa se houver byte nulo ou
 * excesso de bytes de controle. Não é infalível, mas fecha o caso que importa —
 * um binário renomeado para `.txt` para escapar da allowlist.
 */
async function looksLikeText(path: string): Promise<boolean> {
  const { open } = await import('node:fs/promises')
  const handle = await open(path, 'r')

  try {
    const buffer = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const sample = buffer.subarray(0, bytesRead)

    if (sample.includes(0)) return false

    let control = 0
    for (const byte of sample) {
      // Tab, LF, CR são texto; o resto abaixo de 0x20 é controle.
      if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) control++
    }

    return bytesRead === 0 || control / bytesRead < 0.05
  } finally {
    await handle.close()
  }
}

/** Uso agregado do storage, para o aviso de quota (§8.4). */
export function totalStoredBytes(handle: BaremoDatabase): number {
  // Soma por hash distinto: com deduplicação, contar por linha inflaria o total.
  const row = handle.raw
    .prepare(
      `SELECT coalesce(sum(size_bytes), 0) AS total
         FROM (SELECT DISTINCT sha256, size_bytes FROM attachments)`
    )
    .get() as { total: number }
  return row.total
}

export function attachmentById(handle: BaremoDatabase, id: string): Attachment | null {
  const row = handle.db.select().from(attachments).where(eq(attachments.id, id)).get()
  if (!row) return null
  return toAttachment(row)
}

export function toAttachment(row: typeof attachments.$inferSelect): Attachment {
  return {
    ...row,
    tags: parseTags(row.tags)
  } as Attachment
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}
