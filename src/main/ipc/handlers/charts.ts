/**
 * Handler de `charts:*` (spec §7.3).
 *
 * Segue o mesmo desenho de `reports:generate`, `catalog:export` e
 * `maintenance:exportMedicalRecord`: o renderer nunca toca no disco, o diálogo
 * de "salvar como" roda aqui, e o caminho escolhido volta só para ser exibido
 * numa notificação.
 *
 * A imagem chega pronta do renderer, e isso é deliberado. A instância do
 * ECharts com o estado atual do gráfico — o tipo que o usuário escolheu, a
 * faixa esperada ligada ou não — vive lá. Redesenhar aqui significaria manter
 * uma segunda fonte para a mesma figura, e a figura salva poderia divergir da
 * que estava na tela.
 */

import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { dialog, BrowserWindow } from 'electron'
import { registerHandler, invalid } from '../register'
import { slug } from '../../util/slug'

/** Prefixo aceito para a imagem rasterizada. Nada de `data:` genérico. */
const PNG_PREFIX = 'data:image/png;base64,'

export function registerChartHandlers(): void {
  registerHandler('charts:exportImage', async ({ fileName, format, content }) => {
    const payload = decode(format, content)

    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const target = await dialog.showSaveDialog(window!, {
      title: 'Salvar imagem do gráfico',
      defaultPath: `${slug(fileName)}.${format}`,
      filters: [
        format === 'png'
          ? { name: 'Imagem PNG', extensions: ['png'] }
          : { name: 'Imagem vetorial SVG', extensions: ['svg'] }
      ]
    })

    if (target.canceled || !target.filePath) {
      return { filePath: '', cancelled: true }
    }

    await writeFile(target.filePath, payload)
    return { filePath: target.filePath, cancelled: false }
  })
}

/**
 * Converte o que veio do renderer no que vai para o disco.
 *
 * O conteúdo é validado aqui, e não só pelo schema Zod: o schema garante que é
 * uma string dentro do tamanho, não que seja uma imagem. Um data URL de outro
 * tipo gravado com extensão `.png` seria um arquivo que não abre — e, no caso
 * de um `data:text/html`, um arquivo que abre no navegador como página.
 */
function decode(format: 'png' | 'svg', content: string): Buffer {
  if (format === 'png') {
    if (!content.startsWith(PNG_PREFIX)) {
      throw invalid('A imagem enviada não é um PNG.')
    }
    return Buffer.from(content.slice(PNG_PREFIX.length), 'base64')
  }

  if (!content.trimStart().startsWith('<svg')) {
    throw invalid('A imagem enviada não é um SVG.')
  }
  return Buffer.from(content, 'utf8')
}
