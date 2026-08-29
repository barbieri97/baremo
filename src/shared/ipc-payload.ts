/**
 * Payload do IPC em forma clonável — o lado do renderer da fronteira.
 *
 * O estado do renderer é reativo, e `ref`/`reactive` entregam Proxies. O
 * contextBridge não reconhece um Proxy como objeto simples: ele cai no
 * serializador do V8, que recusa — é o "An object could not be cloned." que
 * quebrava o salvamento do perfil profissional.
 *
 * Fica aqui, junto dos contratos, porque é a contraparte do que o processo
 * principal faz ao receber: lá a entrada é validada, aqui ela é posta em forma
 * transportável. Aplicado no único ponto por onde todo o IPC do renderer passa,
 * nenhum formulário precisa lembrar de copiar o objeto antes de enviar.
 *
 * O round-trip JSON é seguro para todo o contrato: nenhum schema de entrada usa
 * `Date`, `Map`, `Set` ou binário — datas são strings ISO e o logotipo é um
 * data URI.
 */
export function toCloneablePayload<T>(payload: T): T {
  // Canais sem entrada (`config:getProfile`, `ai:clearKey`, …) chegam aqui como
  // `undefined`, que o `JSON.stringify` não sabe representar.
  if (payload === undefined) return payload
  return JSON.parse(JSON.stringify(payload)) as T
}
