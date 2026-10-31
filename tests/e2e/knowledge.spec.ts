/**
 * E2E opt-in da base de referências com o modelo de embeddings REAL.
 *
 * Baixa o modelo (~130 MB) do Hugging Face na primeira execução, então não
 * roda por padrão nem no CI. Para rodar:
 *
 *   BAREMO_E2E_MODEL=1 npx playwright test tests/e2e/knowledge.spec.ts
 *
 * Opcionalmente, `BAREMO_E2E_MODELS_DIR` aponta um cache já baixado (a pasta
 * `modelos` é copiada para o userData temporário).
 */

import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test.skip(process.env['BAREMO_E2E_MODEL'] !== '1', 'Opt-in: baixa o modelo de embeddings.')
test.setTimeout(10 * 60_000)

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'baremo-e2e-knowledge-'))
  const cache = process.env['BAREMO_E2E_MODELS_DIR']
  if (cache && existsSync(cache)) cpSync(cache, join(userDataDir, 'modelos'), { recursive: true })

  app = await electron.launch({
    args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'Entendi' }).click()
})

test.afterAll(async () => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

test('importa, indexa com o modelo local e exclui', async () => {
  const norma = join(userDataDir, 'Resolucao_Documentos.md')
  writeFileSync(
    norma,
    [
      '# Resolução sobre documentos psicológicos',
      '',
      'O laudo psicológico deve conter identificação, descrição da demanda, procedimento, análise e conclusão.',
      '',
      'Os documentos e o material que os fundamentou devem ser guardados pelo prazo mínimo de cinco anos.'
    ].join('\n')
  )
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, norma)

  await page.getByRole('link', { name: /Configurações/ }).click()
  await page.getByRole('tab', { name: 'Assistente de IA' }).click()

  const card = page.getByTestId('knowledge-card')
  await card.getByRole('button', { name: 'Importar documentos' }).click()

  const row = card.locator('[data-testid^="knowledge-row-"]').first()
  await expect(row.getByText('Resolucao Documentos')).toBeVisible()
  await expect(row.getByText('Pronto')).toBeVisible({ timeout: 9 * 60_000 })
  await expect(row.getByText(/1 trecho\(s\)/)).toBeVisible()

  await row.getByRole('button', { name: 'Excluir' }).click()
  await page
    .getByRole('dialog', { name: 'Excluir documento de referência' })
    .getByRole('button', { name: 'Excluir' })
    .click()
  await expect(card.getByText('Nenhum documento de referência')).toBeVisible()
})
