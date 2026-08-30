/**
 * Normalização da logo do perfil profissional (spec §4.1, §7.2).
 *
 * O upload aceitava a imagem como veio: um PNG de 1 MB virava ~1,4 MB de base64
 * gravado no banco e recarregado por inteiro a cada PDF gerado, para caber num
 * espaço de 40 × 22 mm no cabeçalho. O CSS escondia o excesso; a memória e o
 * tamanho de cada arquivo, não.
 *
 * A redução acontece em dois lugares, e é de propósito. O renderer reduz antes
 * de enviar, porque lá o Chromium decodifica qualquer formato que ele exiba —
 * WebP, AVIF, GIF. Aqui é a autoridade: vale para qualquer chamador, inclusive
 * um perfil gravado por uma versão anterior do app, e transforma um arquivo
 * ilegível em erro de validação em vez de uma logo quebrada no laudo.
 */

import { nativeImage } from 'electron'
import { invalid } from '../ipc/register'

/**
 * Caixa máxima, em pixels.
 *
 * 40 × 22 mm é o espaço real no cabeçalho impresso (`.doc-header__logo`), e a
 * 300 dpi isso dá 472 × 260 px. Arredondado para 480 × 260: acima disso são
 * pixels que a impressão descarta.
 */
const MAX_WIDTH = 480
const MAX_HEIGHT = 260

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,/i

/**
 * Reduz a logo à caixa de impressão, devolvendo um data URL PNG.
 *
 * PNG na saída, e não JPEG, para preservar a transparência: uma logo com fundo
 * branco sólido sobre o cabeçalho denuncia o recorte.
 */
export function normalizeLogo(dataUrl: string | null): string | null {
  if (dataUrl === null || dataUrl.trim() === '') return null

  if (!DATA_URL.test(dataUrl)) {
    throw invalid('A logo precisa ser uma imagem PNG, JPEG, WebP, GIF ou AVIF.')
  }

  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) {
    throw invalid('Não foi possível ler a imagem enviada. Tente um arquivo PNG ou JPEG.')
  }

  const { width, height } = image.getSize()
  if (width === 0 || height === 0) {
    throw invalid('A imagem enviada não tem dimensões válidas.')
  }

  // Já cabe: devolver o original evita uma recompressão que só perderia
  // qualidade.
  if (width <= MAX_WIDTH && height <= MAX_HEIGHT) return dataUrl

  const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height)

  return image
    .resize({
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      quality: 'best'
    })
    .toDataURL()
}
