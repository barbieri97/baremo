/**
 * Gera `src/main/pdf/fonts.generated.ts` a partir dos `.woff2` do @fontsource.
 *
 * A janela de impressão roda sob `default-src 'none'` com `font-src data:`: a
 * fonte não pode ser buscada na rede nem lida do disco pelo Chromium, ela tem
 * de viajar embutida no CSS como data URI. E o `electron-builder.yml` empacota
 * apenas `out/**` e `package.json`, com o processo principal bundlado por
 * rollup — um `.woff2` lido do disco em runtime exigiria configuração extra de
 * empacotamento que um módulo `.ts` gerado dispensa.
 *
 * O arquivo gerado é COMMITADO. Rode este script apenas ao trocar de fonte:
 *
 *   node scripts/embed-fonts.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Só o subconjunto `latin`, e só os pesos usados.
 *
 * Um `.woff2` latin fica na casa das dezenas de KB; o arquivo completo, com
 * cirílico e grego, multiplicaria isso por peso — em base64, dentro de cada PDF
 * gerado.
 */
const FACES = [
  {
    constant: 'INTER_REGULAR',
    file: '@fontsource/inter/files/inter-latin-400-normal.woff2',
    family: 'Inter',
    weight: 400
  },
  {
    constant: 'INTER_SEMIBOLD',
    file: '@fontsource/inter/files/inter-latin-600-normal.woff2',
    family: 'Inter',
    weight: 600
  },
  {
    constant: 'SERIF_SEMIBOLD',
    file: '@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2',
    family: 'Source Serif 4',
    weight: 600
  }
]

const parts = []
let total = 0

for (const face of FACES) {
  const buffer = await readFile(join(root, 'node_modules', face.file))
  total += buffer.byteLength
  parts.push(
    `/** ${face.family} ${face.weight} — subconjunto latin, ${Math.round(buffer.byteLength / 1024)} KB. */\n` +
      `export const ${face.constant} =\n  '${buffer.toString('base64')}'\n`
  )
}

const header = `/**
 * Fontes do PDF, em base64. ARQUIVO GERADO — não edite à mão.
 *
 * Regenere com \`node scripts/embed-fonts.mjs\` ao trocar de fonte. O porquê de
 * as fontes viverem num módulo, e não em arquivo lido do disco, está no
 * cabeçalho daquele script.
 *
 * Inter e Source Serif 4 são licenciadas sob a SIL Open Font License 1.1, que
 * permite a incorporação em documentos.
 *
 * Total embutido: ${Math.round(total / 1024)} KB.
 */

`

await writeFile(join(root, 'src/main/pdf/fonts.generated.ts'), header + parts.join('\n'), 'utf8')

console.log(`fonts.generated.ts atualizado — ${FACES.length} faces, ${Math.round(total / 1024)} KB`)
