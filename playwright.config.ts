/**
 * Playwright for Electron (spec §15.1).
 *
 * Serial e com um único worker: os testes compartilham a mesma janela e o mesmo
 * banco, e encenam um roteiro em ordem — cadastrar antes de avaliar, avaliar
 * antes de lançar resultado. Paralelizar aqui não daria velocidade, daria
 * intermitência.
 */

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
