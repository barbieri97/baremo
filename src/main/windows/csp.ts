/**
 * Content-Security-Policy das janelas (spec §13.1).
 *
 * Separado de `main-window.ts` porque aquele módulo importa `electron` e não
 * pode ser carregado pelo Vitest — e a regra de QUAL resposta recebe QUAL
 * política precisa de teste: foi um erro nela que fez todo PDF exportado em
 * produção sair sem folha de estilo (ver `cspHeadersFor`).
 */

import { PRINT_SCHEME } from '../pdf/document-html'

/**
 * CSP de produção.
 *
 * `style-src-attr 'unsafe-inline'` é a única concessão, e é deliberada:
 * `style-src` cobre também atributos `style=`, que o Vue emite em todo binding
 * `:style` e as bibliotecas de posicionamento usam para colocar um popover na
 * tela. Separar a diretiva mantém `<style>` e folhas externas travados em
 * `'self'` — que é onde script poderia entrar — sem quebrar a interface.
 */
export const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: baremo-file:",
  "media-src 'self' baremo-file:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/**
 * Em desenvolvimento o Vite injeta estilos e usa `eval` no HMR, e o dev server é
 * HTTP em localhost. A política é afrouxada só aqui — a de produção acima é a
 * que vai para o usuário.
 */
export function developmentCsp(devServerUrl: string): string {
  const origin = new URL(devServerUrl).origin
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-eval' ${origin}`,
    `style-src 'self' 'unsafe-inline' ${origin}`,
    `img-src 'self' data: baremo-file: ${origin}`,
    `media-src 'self' baremo-file: ${origin}`,
    `font-src 'self' data: ${origin}`,
    `connect-src 'self' ${origin} ws://localhost:* ws://127.0.0.1:*`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

type Headers = Record<string, string[]>

/**
 * Os cabeçalhos de uma resposta, com a CSP da interface aplicada.
 *
 * O gancho de `onHeadersReceived` vale para a SESSÃO inteira, e a janela de
 * impressão (`pdf/render.ts`) usa a mesma sessão da janela principal. Antes
 * desta exceção, a resposta do esquema de impressão — que já chega com a sua
 * própria política, `PRINT_CSP` — tinha o cabeçalho trocado pela da interface.
 * Com `style-src 'self'` e `font-src 'self'`, o Chromium bloqueava o `<style>`
 * embutido e as fontes em `data:`: o laudo saía em Times, sem layout, e só os
 * atributos `style=` (liberados por `style-src-attr`) sobreviviam. Nem a prévia
 * nem o modo de desenvolvimento reproduziam isso, e o bug passou por várias
 * versões.
 *
 * A janela de impressão não perde proteção com a exceção: a `PRINT_CSP` é
 * `default-src 'none'`, a janela roda sem JavaScript, sem preload e em sandbox,
 * e o corpo passa pelo DOMPurify.
 */
export function cspHeadersFor(url: string, headers: Headers, policy: string): Headers {
  if (url.startsWith(`${PRINT_SCHEME}:`)) return headers
  return { ...headers, 'Content-Security-Policy': [policy] }
}
