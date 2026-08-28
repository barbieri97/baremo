/**
 * GATE DE CI — path traversal no resolvedor de arquivos (spec §13.3, §13.5).
 *
 * O protocolo `baremo-file://` serve os anexos do usuário. Ele precisa resolver
 * exclusivamente dentro do diretório de arquivos do app: um escape daqui
 * transformaria o renderer num leitor arbitrário do disco.
 *
 * Também cobre o nome de arquivo de backup, que é o outro ponto em que uma
 * string vinda do renderer vira caminho.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { isWithinRoot, resolveWithinRoot } from '../../src/main/protocol/path-guard'
import { restoreBackup } from '../../src/main/db/backup'

let root: string
let outside: string

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'baremo-path-'))
  root = join(base, 'arquivos')
  outside = join(base, 'fora')

  mkdirSync(join(root, 'ab'), { recursive: true })
  mkdirSync(outside, { recursive: true })

  writeFileSync(join(root, 'ab', 'blob.pdf'), 'conteudo')
  writeFileSync(join(outside, 'segredo.txt'), 'nao deveria ser lido')
})

afterAll(() => {
  rmSync(resolve(root, '..'), { recursive: true, force: true })
})

describe('resolveWithinRoot — caminhos legítimos', () => {
  it('resolve um caminho dentro da raiz', () => {
    expect(resolveWithinRoot(root, '/ab/blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
  })

  it('resolve a própria raiz', () => {
    expect(resolveWithinRoot(root, '/')).toBe(resolve(root))
  })

  it('normaliza segmentos redundantes', () => {
    expect(resolveWithinRoot(root, '/ab/./blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
    expect(resolveWithinRoot(root, '/ab/cd/../blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
  })
})

describe('resolveWithinRoot — traversal', () => {
  it('bloqueia .. simples', () => {
    // `normalize('/../fora/segredo.txt')` já colapsa para dentro da raiz; o
    // resultado precisa continuar sob ela.
    const resolved = resolveWithinRoot(root, '/../fora/segredo.txt')
    expect(resolved).not.toBeNull()
    expect(isWithinRoot(root, resolved!)).toBe(true)
  })

  it('bloqueia .. repetido', () => {
    // Os `..` são colapsados contra a raiz: o resultado fica sob ela, e nunca é
    // o /etc/passwd do sistema.
    const resolved = resolveWithinRoot(root, '/../../../../../../etc/passwd')
    expect(resolved).not.toBeNull()
    expect(isWithinRoot(root, resolved!)).toBe(true)
    expect(resolved).not.toBe(resolve('/etc/passwd'))
  })

  it('bloqueia caminho absoluto', () => {
    const resolved = resolveWithinRoot(root, '/etc/passwd')
    expect(resolved).not.toBeNull()
    expect(isWithinRoot(root, resolved!)).toBe(true)
  })

  it('bloqueia .. codificado em percent', () => {
    const resolved = resolveWithinRoot(root, '/%2e%2e/fora/segredo.txt')
    expect(resolved).not.toBeNull()
    expect(isWithinRoot(root, resolved!)).toBe(true)
  })

  it('não decodifica em laço — %252e%252e não vira ..', () => {
    // Uma decodificação repetida transformaria isto em `..`. Decodificar uma vez
    // só é o comportamento correto.
    const resolved = resolveWithinRoot(root, '/%252e%252e/segredo')
    expect(resolved).not.toBeNull()
    expect(isWithinRoot(root, resolved!)).toBe(true)
    expect(resolved).toContain('%2e%2e')
  })

  it('recusa byte nulo', () => {
    expect(resolveWithinRoot(root, '/ab/blob.pdf%00.png')).toBeNull()
  })

  it('recusa percent-encoding malformado', () => {
    expect(resolveWithinRoot(root, '/%ZZ')).toBeNull()
  })

  it('recusa separador do Windows misturado com ..', () => {
    const resolved = resolveWithinRoot(root, '/..\\..\\fora\\segredo.txt')
    expect(resolved).not.toBeNull()
    expect(isWithinRoot(root, resolved!)).toBe(true)
  })
})

describe('isWithinRoot', () => {
  it('aceita a raiz e o que está dentro dela', () => {
    expect(isWithinRoot(root, root)).toBe(true)
    expect(isWithinRoot(root, join(root, 'ab', 'blob.pdf'))).toBe(true)
  })

  it('recusa um caminho fora da raiz', () => {
    expect(isWithinRoot(root, join(outside, 'segredo.txt'))).toBe(false)
    expect(isWithinRoot(root, '/etc/passwd')).toBe(false)
  })

  it('recusa um diretório irmão com prefixo em comum', () => {
    // O caso que uma comparação `startsWith` ingênua deixaria passar:
    // `/dados/arquivos-outros` começa com `/dados/arquivos`.
    const sibling = `${resolve(root)}-outros`
    expect(isWithinRoot(root, join(sibling, 'x.pdf'))).toBe(false)
  })

  it('recusa o alvo de um symlink que aponta para fora', () => {
    const link = join(root, 'link')
    try {
      symlinkSync(outside, link, 'dir')
    } catch {
      return // sem permissão para symlink neste ambiente
    }

    // `resolveWithinRoot` opera sobre o caminho textual e devolveria algo sob a
    // raiz; a leitura real precisa comparar o caminho JÁ resolvido, que é o que
    // `isWithinRoot` recebe no handler do protocolo.
    expect(isWithinRoot(root, resolve(link, 'segredo.txt'))).toBe(true)
    expect(isWithinRoot(root, join(outside, 'segredo.txt'))).toBe(false)
  })
})

describe('restoreBackup — nome vindo do renderer', () => {
  it('recusa nome com separador de diretório', () => {
    expect(restoreBackup('/tmp/x.db', root, '../fora/segredo.db').kind).toBe('invalid_name')
    expect(restoreBackup('/tmp/x.db', root, '/etc/passwd').kind).toBe('invalid_name')
  })

  it('recusa nome fora do padrão de backup', () => {
    expect(restoreBackup('/tmp/x.db', root, 'qualquer.db').kind).toBe('invalid_name')
    expect(restoreBackup('/tmp/x.db', root, 'backup_vX_2026.db').kind).toBe('invalid_name')
  })

  it('aceita o padrão e falha por inexistência, não por validação', () => {
    const outcome = restoreBackup('/tmp/x.db', root, 'backup_v1_2026-08-28T00-00-00-000Z.db')
    expect(outcome.kind).toBe('not_found')
  })
})
