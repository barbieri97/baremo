/**
 * Tipos de `archiver` (spec §6.4).
 *
 * A versão 8 é ESM nativo, expõe classes nomeadas e **não publica tipos**. O
 * pacote `@types/archiver` da DefinitelyTyped ainda descreve a API v7, baseada
 * em CommonJS e função-fábrica — usá-lo aqui daria tipos que não correspondem ao
 * runtime, que é pior do que não ter tipo nenhum.
 *
 * Declaramos apenas o que a exportação de prontuário usa.
 */

declare module 'archiver' {
  import type { Readable } from 'node:stream'

  interface EntryData {
    /** Caminho da entrada dentro do arquivo compactado. */
    name: string
  }

  interface ArchiveOptions {
    zlib?: { level?: number }
  }

  class ZipArchive extends Readable {
    constructor(options?: ArchiveOptions)

    /** Acrescenta um buffer ou stream como entrada. */
    append(source: Buffer | Readable | string, data: EntryData): this

    /** Acrescenta um arquivo do disco. */
    file(path: string, data: EntryData): this

    /** Acrescenta um diretório inteiro. */
    directory(path: string, destination: string | false): this

    /** Sinaliza que não há mais entradas; o flush do destino ainda acontece depois. */
    finalize(): Promise<void>

    /** Bytes escritos até o momento. */
    pointer(): number

    on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this
    on(event: 'warning', listener: (error: NodeJS.ErrnoException) => void): this
    on(event: string, listener: (...args: unknown[]) => void): this
  }

  class TarArchive extends ZipArchive {}
  class JsonArchive extends ZipArchive {}

  export { ZipArchive, TarArchive, JsonArchive }
  export type { ArchiveOptions, EntryData }
}
