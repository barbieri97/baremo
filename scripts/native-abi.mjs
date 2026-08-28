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

const npx = process.platform === 'win32' ? 'npm.cmd' : 'npm'
console.log(`[native-abi] recompilando better-sqlite3 para a ABI do ${target}…`)

if (target === 'electron') {
  execFileSync(npx, ['exec', '--', 'electron-builder', 'install-app-deps'], { stdio: 'inherit' })
} else {
  execFileSync(npx, ['rebuild', 'better-sqlite3'], { stdio: 'inherit' })
}

writeFileSync(STAMP, target)
