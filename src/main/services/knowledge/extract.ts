/**
 * Extração de texto dos documentos da base de referências.
 *
 * O tipo é decidido por magic number (`file-type`), como na ingestão de anexos
 * (§8.4). TXT e Markdown não têm assinatura: voltam para a extensão e passam
 * por uma checagem de "parece texto?".
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import type { PageText } from './chunk'

export const KNOWLEDGE_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md'
}

const TEXT_EXTENSIONS: Readonly<Record<string, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown'
}

/** Abaixo disto, em média por página, o PDF é tratado como escaneado. */
const MIN_CHARS_PER_PAGE = 50

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFileError'
  }
}

/** PDF sem camada de texto: o app não faz OCR. */
export class NoTextError extends Error {
  constructor() {
    super('PDF escaneado: não há texto extraível (OCR não é suportado).')
    this.name = 'NoTextError'
  }
}

export interface DetectedType {
  readonly mime: string
  readonly extension: string
}

export async function detectType(path: string, bytes: Buffer): Promise<DetectedType> {
  const detected = await fileTypeFromBuffer(bytes)

  if (detected !== undefined) {
    const extension = KNOWLEDGE_MIME[detected.mime]
    if (extension === undefined || extension === 'txt' || extension === 'md') {
      throw new UnsupportedFileError(
        'Tipo não aceito na base de referências. Use PDF, DOCX, TXT ou Markdown.'
      )
    }
    return { mime: detected.mime, extension }
  }

  const textMime = TEXT_EXTENSIONS[extname(path).toLowerCase()]
  if (textMime === undefined || !looksLikeText(bytes)) {
    throw new UnsupportedFileError(
      'Tipo não aceito na base de referências. Use PDF, DOCX, TXT ou Markdown.'
    )
  }
  return { mime: textMime, extension: KNOWLEDGE_MIME[textMime]! }
}

export interface Extracted {
  readonly pages: PageText[]
  readonly pageCount: number | null
}

export async function extractText(path: string, mime: string): Promise<Extracted> {
  if (mime === 'application/pdf') return extractPdf(path)

  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ path })
    return { pages: [{ page: null, text: value }], pageCount: null }
  }

  const text = (await readFile(path)).toString('utf8')
  return { pages: [{ page: null, text }], pageCount: null }
}

async function extractPdf(path: string): Promise<Extracted> {
  // Import dinâmico: o pdf.js do unpdf é pesado e só é preciso aqui.
  const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
  const { totalPages, text } = await extractPdfText(pdf, { mergePages: false })
  const pages = text.map((pageText, index) => ({ page: index + 1, text: pageText }))
  const chars = pages.reduce((sum, page) => sum + page.text.trim().length, 0)

  if (totalPages === 0 || chars / totalPages < MIN_CHARS_PER_PAGE) throw new NoTextError()
  return { pages, pageCount: totalPages }
}

/** UTF-8 válido e sem bytes de controle que texto não tem. */
function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample)
    return true
  } catch {
    // O corte em 8 KiB pode partir um caractere multibyte no fim.
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - 4))
      return true
    } catch {
      return false
    }
  }
}
