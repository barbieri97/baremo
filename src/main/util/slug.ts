/**
 * Nome de arquivo seguro a partir de texto livre.
 *
 * Nome de paciente e título de instrumento entram em nomes de arquivo sugeridos
 * no diálogo de "salvar como". Um nome com barra, dois pontos ou acento quebra
 * o diálogo em algum dos três sistemas suportados — então o texto é reduzido a
 * ASCII, hifens e dígitos antes de chegar lá.
 *
 * Vivia duplicado em `ipc/handlers/reports.ts` e `ipc/handlers/maintenance.ts`.
 * Com um terceiro exportador (a imagem do gráfico), a cópia virou o caminho
 * óbvio para as três divergirem.
 */
export function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
}
