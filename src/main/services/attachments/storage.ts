/**
 * Armazenamento endereçado por conteúdo (spec §8.3, ADR-003).
 *
 * Os blobs vão para o filesystem, não para BLOB no SQLite: o `.db` precisa
 * continuar pequeno, porque o backup preventivo antes de cada migration (§14.3)
 * ficaria inviável com centenas de MB de anexos dentro dele. O custo aceito é
 * que o backup do banco não cobre os arquivos — compensado pela exportação de
 * prontuário (§6.4).
 *
 * O caminho é `arquivos/<sha[0:2]>/<sha>.<ext>`. O prefixo de dois caracteres
 * espalha os arquivos em 256 pastas: um diretório único com dezenas de milhares
 * de entradas degrada listagem e navegação em vários sistemas.
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { attachmentsDir, blobPath } from '../../paths'

export interface StoredBlob {
  readonly sha256: string
  readonly sizeBytes: number
  /** `true` quando o conteúdo já existia — deduplicação (§8.3). */
  readonly deduplicated: boolean
}

/**
 * Copia um arquivo para o storage calculando o SHA-256 DURANTE a cópia.
 *
 * Ler o arquivo duas vezes — uma para o hash, outra para copiar — abriria uma
 * janela em que o conteúdo muda entre as duas leituras, e dobraria a E/S num
 * arquivo de até 100 MB. A cópia vai primeiro para um temporário, porque o nome
 * final só é conhecido quando o hash termina.
 */
export async function storeFile(sourcePath: string, extension: string): Promise<StoredBlob> {
  const hash = createHash('sha256')
  const temporaryPath = join(tmpdir(), `baremo-ingest-${process.pid}-${Date.now()}`)

  const source = createReadStream(sourcePath)
  const target = createWriteStream(temporaryPath)

  source.on('data', (chunk) => hash.update(chunk))

  try {
    await pipeline(source, target)

    const sha256 = hash.digest('hex')
    const finalPath = blobPath(sha256, extension)
    const { size } = await stat(temporaryPath)

    if (await exists(finalPath)) {
      // Mesmo conteúdo já armazenado: descarta a cópia e reaproveita o blob.
      await rm(temporaryPath, { force: true })
      return { sha256, sizeBytes: size, deduplicated: true }
    }

    await mkdir(dirname(finalPath), { recursive: true })
    await rename(temporaryPath, finalPath).catch(async (error: NodeJS.ErrnoException) => {
      // `rename` falha atravessando sistemas de arquivos (o tmp costuma estar em
      // outra partição); nesse caso, copia e apaga.
      if (error.code !== 'EXDEV') throw error
      await pipeline(createReadStream(temporaryPath), createWriteStream(finalPath))
      await rm(temporaryPath, { force: true })
    })

    return { sha256, sizeBytes: size, deduplicated: false }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function resolveBlobPath(sha256: string, extension: string): string {
  return blobPath(sha256, extension)
}

export function storageRoot(): string {
  return attachmentsDir()
}

export async function removeBlob(sha256: string, extension: string): Promise<void> {
  await rm(blobPath(sha256, extension), { force: true })
}
