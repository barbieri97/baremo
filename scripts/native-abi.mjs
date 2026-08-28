#!/usr/bin/env node
/**
 * better-sqlite3 é um módulo nativo: o binário compilado serve a UMA ABI por vez.
 * O Electron 44 e o Node do sistema têm ABIs diferentes, então o mesmo
 * node_modules não consegue atender `npm run dev` e `npm test` ao mesmo tempo.
 *
 * Este script deixa o binário na ABI pedida, e não faz nada se já estiver certa —
 * o caso comum custa alguns milissegundos.
 *
 *   node scripts/native-abi.mjs node        → antes do Vitest
 *   node scripts/native-abi.mjs electron    → antes de dev/build/E2E
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error('uso: node scripts/native-abi.mjs <node|electron>')
  process.exit(1)
}

const STAMP = resolve('node_modules/.better-sqlite3-abi')
const current = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : null

if (current === target) process.exit(0)

// Sem marca, a ABI é a que o `npm install` deixou (prebuild do Node).
if (current === null && target === 'node') {
  const require = createRequire(import.meta.url)
  try {
    require('better-sqlite3')
    writeFileSync(STAMP, 'node')
    process.exit(0)
  } catch {
    // segue para a recompilação
  }
}

/**
 * Executa um comando npm sem passar pelo `npm.cmd`.
 *
 * Desde a correção da CVE-2024-27980, o Node recusa executar arquivos `.cmd` e
 * `.bat` por `spawnSync` sem shell: `execFileSync('npm.cmd', …)` falha com
 * EINVAL no Windows, e só lá.
 *
 * Como este script roda como lifecycle script do npm (`predev`, `prebuild`,
 * `pretest`), `npm_execpath` aponta para o `npm-cli.js` — um arquivo `.js`, que
 * o Node executa direto em qualquer plataforma. É o caminho preferido: sem
 * shell, sem `.cmd`, sem questão de aspas.
 *
 * O `shell: true` fica como saída para quem chama o script à mão, fora do npm.
 * Os argumentos são literais deste arquivo, então não há superfície de injeção.
 */
function runNpm(args) {
  const cli = process.env.npm_execpath

  if (cli !== undefined && cli.endsWith('.js')) {
    execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' })
    return
  }

  execFileSync('npm', args, { stdio: 'inherit', shell: true })
}

console.log(`[native-abi] recompilando better-sqlite3 para a ABI do ${target}…`)

if (target === 'electron') {
  runNpm(['exec', '--', 'electron-builder', 'install-app-deps'])
} else {
  runNpm(['rebuild', 'better-sqlite3'])
}

writeFileSync(STAMP, target)
