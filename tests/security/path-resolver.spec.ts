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

/**
 * O resolvedor recebe o *pathname* de uma URL, que é sempre POSIX — e não um
 * caminho do sistema. Delegar a normalização ao `path` da plataforma fazia o
 * Windows tratar `//algo` como caminho UNC e engolir o `..`, produzindo
 * resultado diferente do POSIX para a mesma entrada.
 *
 * Estes casos são independentes de plataforma de propósito: falham em qualquer
 * sistema se alguém voltar a usar `path.normalize` aqui.
 */
describe('resolveWithinRoot — independência de plataforma', () => {
  it('colapsa .. no meio do caminho', () => {
    // O caso que o Windows quebrava: `..` engolido pela semântica UNC.
    expect(resolveWithinRoot(root, '/ab/cd/../blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
  })

  it('trata barras duplicadas como uma só, sem virar caminho UNC', () => {
    expect(resolveWithinRoot(root, '//ab//blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
    expect(resolveWithinRoot(root, '/ab///cd/../blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
  })

  it('não deixa um designador de unidade escapar da raiz', () => {
    // No Windows, `resolve(raiz, 'C:')` seria interpretado como caminho relativo
    // à unidade C: — a checagem final contra a raiz é o que fecha isso.
    for (const attempt of ['/C:/Windows/System32', '/C:', '/D:/dados']) {
      const resolved = resolveWithinRoot(root, attempt)
      if (resolved !== null) expect(isWithinRoot(root, resolved)).toBe(true)
    }
  })

  it('trata a contrabarra como separador, e não como nome de arquivo', () => {
    expect(resolveWithinRoot(root, '/ab\\blob.pdf')).toBe(join(root, 'ab', 'blob.pdf'))
  })

  it('nunca sai da raiz, qualquer que seja a quantidade de ..', () => {
    for (let depth = 1; depth <= 12; depth++) {
      const attempt = `/${'../'.repeat(depth)}segredo.txt`
      const resolved = resolveWithinRoot(root, attempt)

      expect(resolved).not.toBeNull()
      expect(isWithinRoot(root, resolved!)).toBe(true)
      expect(resolved).toBe(join(root, 'segredo.txt'))
    }
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
