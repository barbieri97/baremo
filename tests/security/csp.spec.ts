/**
 * CSP por resposta (spec §13.1, §13.4).
 *
 * A janela de impressão divide a sessão com a janela principal, e o gancho de
 * cabeçalhos da principal vale para a sessão inteira. Até a v0.18.0 ele trocava
 * a política da impressão pela da interface, e todo PDF exportado em produção
 * saía sem folha de estilo e sem as fontes — sem erro, sem aviso. Este teste
 * fixa a exceção e, junto, que ela não afrouxa a política da interface.
 */

import { describe, expect, it } from 'vitest'
import { cspHeadersFor, PRODUCTION_CSP } from '../../src/main/windows/csp'
import { PRINT_CSP, PRINT_SCHEME } from '../../src/main/pdf/document-html'

describe('cspHeadersFor', () => {
  it('aplica a política da interface às respostas do app', () => {
    const headers = cspHeadersFor('app://baremo/index.html', { 'X-Outro': ['1'] }, PRODUCTION_CSP)

    expect(headers['Content-Security-Policy']).toEqual([PRODUCTION_CSP])
    expect(headers['X-Outro']).toEqual(['1'])
  })

  it('preserva a política própria da janela de impressão', () => {
    const original = { 'content-security-policy': [PRINT_CSP] }
    const headers = cspHeadersFor(`${PRINT_SCHEME}://job-id/`, original, PRODUCTION_CSP)

    expect(headers).toBe(original)
    expect(headers['Content-Security-Policy']).toBeUndefined()
  })

  it('não confunde um esquema parecido com o de impressão', () => {
    const headers = cspHeadersFor(`${PRINT_SCHEME}-x://job/`, {}, PRODUCTION_CSP)
    expect(headers['Content-Security-Policy']).toEqual([PRODUCTION_CSP])
  })
})

describe('as políticas', () => {
  it('a da interface continua sem estilo embutido', () => {
    expect(PRODUCTION_CSP).toContain("style-src 'self'")
    expect(PRODUCTION_CSP).not.toMatch(/style-src [^;]*'unsafe-inline'/)
  })

  it('a da impressão segue sem script e libera só o que o laudo usa', () => {
    expect(PRINT_CSP).toContain("default-src 'none'")
    expect(PRINT_CSP).not.toContain('script-src')
    expect(PRINT_CSP).toContain("style-src 'unsafe-inline'")
    expect(PRINT_CSP).toContain('font-src data:')
  })
})
