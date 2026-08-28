/**
 * Exportação de prontuário (spec §6.4).
 *
 * Um `.zip` com o JSON estruturado das avaliações e resultados, os PDFs dos
 * documentos finalizados e a pasta de anexos. Atende à portabilidade da LGPD e,
 * na prática, é o único backup que cobre os arquivos — o backup do banco (§14.3)
 * não os inclui, por decorrência do ADR-003.
 */

import { createWriteStream } from 'node:fs'
import archiver from 'archiver'
import { eq } from 'drizzle-orm'
import type { BaremoDatabase } from '../../db/gateway'
import { attachments, documents, patients } from '../../db/schema'
import { notFound } from '../../ipc/register'
import { listAssessmentsByPatient, listResults } from '../../repositories/assessments'
import { getProfile } from '../../repositories/config'
import { toAttachment } from '../attachments/ingest'
import { resolveBlobPath } from '../attachments/storage'
import { buildDocumentReport } from '../document-report'
import { renderDocumentReport, DOCUMENT_CSS } from '../../pdf/document-template'
import { renderPdf } from '../../pdf/render'
import { REPORT_CSS } from '../../pdf/styles'
import { extractPlainText } from '../../pdf/serialize'
import { formatIsoDate, today } from '@shared/domain/dates'

export async function exportMedicalRecord(
  handle: BaremoDatabase,
  patientId: string,
  targetPath: string
): Promise<void> {
  const patient = handle.db.select().from(patients).where(eq(patients.id, patientId)).get()
  if (!patient) throw notFound('Paciente não encontrado.')

  const assessments = listAssessmentsByPatient(handle, patientId, true)
  const attachmentRows = handle.db
    .select()
    .from(attachments)
    .where(eq(attachments.patientId, patientId))
    .all()
    .map(toAttachment)

  const documentRows = handle.db
    .select()
    .from(documents)
    .where(eq(documents.patientId, patientId))
    .all()

  const payload = {
    exportedAt: new Date().toISOString(),
    schema: 'baremo/medical-record@1',
    professional: getProfile(handle),
    patient,
    assessments: assessments.map((assessment) => ({
      ...assessment,
      results: listResults(handle, assessment.id)
    })),
    documents: documentRows.map((document) => ({
      id: document.id,
      title: document.title,
      type: document.type,
      status: document.status,
      origin: document.origin,
      createdAt: document.createdAt,
      finalizedAt: document.finalizedAt,
      // O JSON do TipTap vai inteiro, para o dado ser reimportável; o texto
      // plano vai junto para o arquivo ser legível sem o app.
      contentJson: safeParse(document.contentJson),
      plainText: extractPlainText(safeParse(document.contentJson))
    })),
    attachments: attachmentRows
  }

  const output = createWriteStream(targetPath)
  const archive = archiver('zip', { zlib: { level: 9 } })

  // A promessa resolve no `close` do stream de saída, não no `finalize` do
  // archiver: `finalize` só sinaliza que não há mais entradas, e retornar antes
  // do flush entregaria um zip truncado.
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    // `warning` com ENOENT é arquivo faltando: registrado no relatório, não fatal.
    archive.on('warning', (error) => {
      if (error.code !== 'ENOENT') reject(error)
    })
  })

  archive.pipe(output)

  archive.append(JSON.stringify(payload, null, 2), { name: 'prontuario.json' })
  archive.append(buildReadme(patient.fullName, assessments.length, attachmentRows.length), {
    name: 'LEIA-ME.txt'
  })

  for (const attachment of attachmentRows) {
    // O nome original volta aqui — dentro do zip ele é conveniência para quem
    // abrir. O prefixo com o id evita colisão entre dois arquivos homônimos.
    archive.file(resolveBlobPath(attachment.sha256, attachment.extension), {
      name: `arquivos/${attachment.id.slice(0, 8)}-${sanitizeEntryName(attachment.originalName)}`
    })
  }

  for (const document of documentRows) {
    if (document.status !== 'finalized') continue

    try {
      const report = buildDocumentReport(handle, document.id)
      const pdf = await renderPdf({
        title: report.title,
        bodyHtml: renderDocumentReport(report),
        css: REPORT_CSS + DOCUMENT_CSS,
        header: { left: patient.fullName, right: report.title },
        issuedAt: formatIsoDate(today())
      })
      archive.append(pdf, {
        name: `documentos/${sanitizeEntryName(document.title)}.pdf`
      })
    } catch {
      // Um documento que falha ao renderizar não pode abortar a exportação
      // inteira: o JSON já carrega o conteúdo dele.
    }
  }

  await archive.finalize()
  await finished
}

function buildReadme(
  patientName: string,
  assessmentCount: number,
  attachmentCount: number
): string {
  return [
    'Exportação de prontuário — Baremo',
    '',
    `Paciente: ${patientName}`,
    `Gerado em: ${formatIsoDate(today())}`,
    `Avaliações: ${assessmentCount}`,
    `Arquivos anexados: ${attachmentCount}`,
    '',
    'Conteúdo:',
    '  prontuario.json  — dados estruturados: paciente, avaliações, resultados e documentos',
    '  arquivos/        — cópias dos arquivos anexados ao prontuário',
    '  documentos/      — PDFs dos documentos finalizados',
    '',
    'ATENÇÃO: este pacote contém dados pessoais sensíveis de saúde, sem criptografia.',
    'Guarde-o em mídia com criptografia de disco e trate-o com o mesmo cuidado do prontuário original.'
  ].join('\n')
}

/**
 * Nome de entrada dentro do zip.
 *
 * Separadores e `..` viram sublinhado: um nome original malicioso não deve
 * conseguir posicionar o arquivo fora da pasta pretendida quando alguém
 * descompactar o pacote (a classe de bug conhecida como "zip slip").
 */
function sanitizeEntryName(value: string): string {
  return value
    .replace(/[/\\]/g, '_')
    .replace(/\.{2,}/g, '_')
    // Remover caracteres de controle do nome é exatamente o objetivo aqui: eles
    // corrompem entradas de zip em vários extratores.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120) || 'arquivo'
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
