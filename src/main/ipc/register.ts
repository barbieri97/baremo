/**
 * Fronteira IPC (spec §13.2).
 *
 * "IPC sem validação de schema é a superfície de ataque mais provável de um app
 * Electron local." Por isso não existe `ipcMain.handle` cru em nenhum lugar do
 * código: todo canal passa por aqui, e aqui sempre acontecem, nesta ordem:
 *
 *   1. validação do remetente — origem esperada e frame principal;
 *   2. validação da entrada com o schema Zod do contrato;
 *   3. execução;
 *   4. em desenvolvimento, validação da saída, para pegar drift de contrato.
 *
 * O retorno é sempre um envelope `IpcResult`: exceções viram erro estruturado,
 * nunca um stack trace atravessando a fronteira.
 */

import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { contracts } from '@shared/contracts'
import type { ChannelName, ChannelOutput, IpcError, IpcResult } from '@shared/contracts'

/** Erro de domínio com código — o jeito de um handler recusar sem estourar. */
export class HandlerError extends Error {
  constructor(
    readonly code: IpcError['code'],
    message: string,
    readonly details?: unknown
  ) {
    super(message)
    this.name = 'HandlerError'
  }
}

export const notFound = (message = 'Registro não encontrado.'): HandlerError =>
  new HandlerError('not_found', message)

export const conflict = (message: string, details?: unknown): HandlerError =>
  new HandlerError('conflict', message, details)

export const forbidden = (message: string): HandlerError =>
  new HandlerError('forbidden', message)

export const invalid = (message: string, details?: unknown): HandlerError =>
  new HandlerError('validation', message, details)

/**
 * Origens que podem falar com o processo principal.
 *
 * Em produção o renderer é servido pelo esquema `app://`, registrado como
 * standard e seguro — isso dá a ele uma origem real, o que faz a CSP com
 * `'self'` significar alguma coisa e torna esta checagem possível. Com
 * `file://`, a origem seria opaca e não haveria o que comparar.
 */
let allowedOrigins: readonly string[] = []

export function setAllowedOrigins(origins: readonly string[]): void {
  allowedOrigins = origins
}

function senderIsTrusted(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (frame === null) return false

  // Só o frame principal do renderer fala com o main: um iframe (ou um
  // conteúdo remoto que tenha conseguido carregar) não herda esse direito.
  if (frame.parent !== null) return false

  try {
    const origin = new URL(frame.url).origin
    return allowedOrigins.includes(origin)
  } catch {
    return false
  }
}

export type Handler<C extends ChannelName> = (
  input: z.output<(typeof contracts)[C]['input']>,
  event: IpcMainInvokeEvent
) => ChannelOutput<C> | Promise<ChannelOutput<C>>

const registered = new Set<ChannelName>()

export function registerHandler<C extends ChannelName>(channel: C, handler: Handler<C>): void {
  if (registered.has(channel)) {
    throw new Error(`Canal IPC registrado duas vezes: ${channel}`)
  }
  registered.add(channel)

  const contract = contracts[channel]

  ipcMain.handle(channel, async (event, rawInput): Promise<IpcResult<unknown>> => {
    if (!senderIsTrusted(event)) {
      return fail({ code: 'forbidden', message: 'Origem não autorizada.' })
    }

    const parsedInput = contract.input.safeParse(rawInput)
    if (!parsedInput.success) {
      return fail({
        code: 'validation',
        message: 'Dados inválidos para esta operação.',
        details: describeIssues(parsedInput.error)
      })
    }

    try {
      const result = await handler(parsedInput.data as never, event)

      if (import.meta.env?.DEV) {
        const parsedOutput = contract.output.safeParse(result)
        if (!parsedOutput.success) {
          // Só em desenvolvimento: em produção, um contrato desalinhado não deve
          // derrubar uma operação que já aconteceu no banco.
          console.error(
            `[ipc] saída fora do contrato em ${channel}:`,
            describeIssues(parsedOutput.error)
          )
        }
      }

      return { ok: true, data: result }
    } catch (error) {
      return fail(toIpcError(error, channel))
    }
  })
}

function fail(error: IpcError): IpcResult<never> {
  return { ok: false, error }
}

export interface FieldIssue {
  readonly path: string
  readonly message: string
}

/**
 * Achata os problemas do Zod em `campo → mensagem`.
 *
 * A forma em árvore do Zod não sobrevive bem à serialização do IPC e é
 * desconfortável de consumir na UI; a lista plana é o que os formulários
 * precisam para marcar o campo errado.
 */
function describeIssues(error: z.ZodError<unknown>): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message
  }))
}

function toIpcError(error: unknown, channel: string): IpcError {
  if (error instanceof HandlerError) {
    return { code: error.code, message: error.message, details: error.details }
  }

  // Erro inesperado: o log fica no main, e o renderer recebe uma mensagem
  // genérica. Detalhe de exceção não atravessa a fronteira.
  console.error(`[ipc] erro não tratado em ${channel}:`, error)
  return {
    code: 'internal',
    message: 'Ocorreu um erro inesperado. Consulte os logs do aplicativo.'
  }
}

/** Confere, no boot, que todo canal do contrato tem handler (§12.1). */
export function assertAllChannelsRegistered(): void {
  const missing = (Object.keys(contracts) as ChannelName[]).filter(
    (channel) => !registered.has(channel)
  )
  if (missing.length > 0) {
    throw new Error(`Canais IPC declarados sem handler: ${missing.join(', ')}`)
  }
}
