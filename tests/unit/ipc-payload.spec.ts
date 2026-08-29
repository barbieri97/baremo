/**
 * Regressão: estado reativo do Vue atravessando a fronteira IPC.
 *
 * `ref`/`reactive` devolvem Proxies, e o serializador do V8 — o mesmo que o
 * contextBridge usa quando o valor não é um objeto simples — recusa Proxy. Era
 * assim que "Salvar perfil" morria com "An object could not be cloned.".
 */

import { describe, expect, it } from 'vitest'
import { serialize } from 'node:v8'
import { reactive, ref } from 'vue'
import { toCloneablePayload } from '@shared/ipc-payload'

const profile = {
  name: 'Ana Barbieri',
  crp: '06/123456',
  specialty: 'Neuropsicologia',
  phone: '(11) 90000-0000',
  email: 'ana@example.com',
  address: 'Rua das Acácias, 100',
  logoDataUrl: null
}

describe('toCloneablePayload', () => {
  it('o Proxy reativo cru não sobrevive à serialização do IPC', () => {
    const state = ref({ ...profile })
    expect(() => serialize(state.value)).toThrow(/could not be cloned/)
  })

  it('devolve o perfil reativo em forma clonável, com os mesmos valores', () => {
    const state = ref({ ...profile })
    const payload = toCloneablePayload(state.value)

    expect(() => serialize(payload)).not.toThrow()
    expect(payload).toEqual(profile)
    expect(payload.logoDataUrl).toBeNull()
  })

  it('alcança objeto reativo aninhado dentro de um literal', () => {
    const input = reactive({ name: 'Instrumento', order: 0 })
    const payload = toCloneablePayload({ id: 'abc', input })

    expect(() => serialize(payload)).not.toThrow()
    expect(payload).toEqual({ id: 'abc', input: { name: 'Instrumento', order: 0 } })
  })

  it('preserva o data URI do logotipo', () => {
    const state = ref({ ...profile, logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
    const payload = toCloneablePayload(state.value)

    expect(payload.logoDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('deixa passar os canais sem entrada', () => {
    expect(toCloneablePayload(undefined)).toBeUndefined()
  })
})
