/**
 * E2E — caminho principal do app (spec §15.1).
 *
 * Cadastro → instrumento com faixas → avaliação → resultado com classificação
 * automática. É o fluxo que a spec chama de caso de uso dominante, atravessando
 * de verdade a fronteira IPC, o banco e a interface.
 *
 * Nenhuma chave de API real em ponto algum: o módulo de IA nasce desligado, e
 * este roteiro não o liga.
 */

import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  // Diretório de dados isolado: o E2E não pode tocar no prontuário real de quem
  // roda os testes na própria máquina.
  userDataDir = mkdtempSync(join(tmpdir(), 'baremo-e2e-'))

  app = await electron.launch({
    args: [
      join(process.cwd(), 'out/main/index.js'),
      `--user-data-dir=${userDataDir}`,
      // Contêineres de CI não têm o namespace de usuário que o sandbox do
      // Chromium exige. A flag vale só para este processo de teste — o
      // `sandbox: true` das janelas do app é outra coisa e continua ativo.
      '--no-sandbox'
    ],
    env: { ...process.env, NODE_ENV: 'production' }
  })

  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

test('a janela abre com o aviso de criptografia de disco', async () => {
  // §16.1 — a criptografia de disco do SO é requisito de instalação, comunicado
  // na primeira execução.
  await expect(page.getByText('Ative a criptografia de disco do seu sistema.')).toBeVisible()
  await page.getByRole('button', { name: 'Entendi' }).click()
})

test('o indicador do módulo de IA mostra desligado por padrão', async () => {
  // ADR-001 e §10.1, princípio 6.
  await expect(page.getByText('IA desligada')).toBeVisible()
  await expect(page.getByText('Nenhum dado sai deste computador.')).toBeVisible()
})

test('a árvore de funções cognitivas vem semeada', async () => {
  await page.getByRole('link', { name: /Funções cognitivas/ }).click()

  await expect(page.getByRole('button', { name: 'Atenção', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Memória', exact: true })).toBeVisible()
})

test('cadastra instrumento e faixas de classificação', async () => {
  await page.getByRole('link', { name: /Instrumentos/ }).click()
  await page.getByRole('button', { name: 'Adicionar na raiz' }).click()

  await page.getByLabel('Nome').fill('Teste de Atenção Concentrada')
  await page.getByLabel('Sigla').fill('TAC')
  await page.getByRole('button', { name: 'Salvar' }).click()

  await page.getByRole('button', { name: 'Faixas de classificação' }).click()
  await page.getByRole('button', { name: 'Gerar 5 faixas' }).click()

  const names = ['Inferior', 'Média inferior', 'Média', 'Média superior', 'Superior']
  const rows = page.locator('tbody tr')
  for (let index = 0; index < names.length; index++) {
    await rows.nth(index).locator('input').first().fill(names[index]!)
  }

  await page.getByRole('button', { name: 'Salvar faixas' }).click()
  await expect(page.getByText(/Faixas salvas/)).toBeVisible()
})

test('cadastra paciente e cria avaliação', async () => {
  await page.getByRole('link', { name: /Pacientes/ }).click()
  await page.getByRole('button', { name: 'Novo paciente' }).click()

  await page.getByLabel('Nome completo').fill('Paciente de Verificação')
  await page.getByLabel('Data de nascimento').fill('1990-05-15')
  await page.getByRole('button', { name: 'Salvar' }).click()

  await expect(page.getByRole('heading', { name: /Paciente de Verificação/ })).toBeVisible()

  await page.getByRole('button', { name: 'Nova avaliação' }).click()
  await page.getByLabel('Motivo do encaminhamento').fill('Verificação automatizada')
  await page.getByRole('button', { name: 'Criar avaliação' }).click()

  await expect(page.getByRole('heading', { name: /Avaliação de/ })).toBeVisible()
})

test('lança resultado e recebe classificação automática', async () => {
  await page.getByRole('button', { name: 'Lançar resultado' }).click()

  await page
    .getByLabel('Instrumento')
    .selectOption({ label: 'Teste de Atenção Concentrada (TAC)' })
  await page.getByLabel('Tipo de escore').selectOption('percentile')
  // Com as cinco faixas geradas em partes iguais, 65 cai em [60, 80) — a quarta,
  // "Média superior".
  await page.getByLabel('Valor').fill('65')

  // A prévia aparece ANTES de gravar — é o que faz o erro de digitação ser
  // percebido no momento em que acontece (§16.4).
  await expect(page.getByText('Média superior').first()).toBeVisible()

  await page.getByRole('button', { name: 'Lançar' }).click()
  await expect(page.locator('table').getByText('Média superior').first()).toBeVisible()
})

test('gera relatório por função cognitiva em PDF', async () => {
  // O diálogo de salvar é nativo: interceptamos para não travar o teste.
  const target = join(userDataDir, 'relatorio.pdf')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  await page.getByRole('button', { name: 'PDF por função' }).click()
  await expect(page.getByText('Relatório gerado.')).toBeVisible({ timeout: 15_000 })

  // A verificação roda no processo de teste, e não dentro do Electron: é o mesmo
  // sistema de arquivos, e evita serializar `fs` para dentro do main.
  expect(existsSync(target)).toBe(true)
  expect(statSync(target).size).toBeGreaterThan(1000)
})

test('o app funciona inteiro com o módulo de IA desligado', async () => {
  // §16.2 e P2 — a ausência do módulo não pode bloquear nada.
  await page.getByRole('link', { name: /Manutenção/ }).click()
  await expect(page.getByRole('heading', { name: 'Manutenção' })).toBeVisible()

  await page.getByRole('button', { name: 'Verificar' }).click()
  await expect(page.getByText(/Banco íntegro/)).toBeVisible()

  await page.getByRole('button', { name: 'Criar backup' }).click()
  await expect(page.getByText('Backup criado.')).toBeVisible()
})

test('salva o perfil profissional', async () => {
  // Regressão: o formulário enviava o `ref` reativo direto ao IPC, e o
  // contextBridge recusava o Proxy com "An object could not be cloned.".
  // Atravessa a ponte de verdade — é o que o teste de unidade não prova.
  await page.getByRole('link', { name: /Configurações/ }).click()

  await page.getByLabel('Nome', { exact: true }).fill('Profissional de Verificação')
  await page.getByLabel('CRP').fill('06/123456')
  await page.getByRole('button', { name: 'Salvar perfil' }).click()

  await expect(page.getByText('Perfil salvo.')).toBeVisible()
  await expect(page.getByText('An object could not be cloned.')).toHaveCount(0)
})

test('exporta o catálogo, e o arquivo não leva dado de paciente', async () => {
  const target = join(userDataDir, 'catalogo.json')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  await page.getByRole('link', { name: /Instrumentos/ }).click()
  await page.getByRole('button', { name: 'Exportar catálogo' }).click()
  await expect(page.getByText('Catálogo exportado.')).toBeVisible()

  const content = readFileSync(target, 'utf8')
  expect(content).toContain('Teste de Atenção Concentrada')
  expect(content).toContain('Média superior')
  // O paciente e a avaliação existem neste banco desde os testes anteriores: se
  // vazassem para o catálogo, apareceriam aqui.
  expect(content).not.toContain('Paciente de Verificação')
  expect(content).not.toContain('Verificação automatizada')
})

test('importa um catálogo e a árvore passa a mostrar o que veio do arquivo', async () => {
  const source = join(userDataDir, 'catalogo.json')
  const modified = join(userDataDir, 'catalogo-com-novo.json')

  // Um catálogo como o que viria de outra máquina: o mesmo de antes, mais um
  // instrumento que este computador não conhece.
  const catalog = JSON.parse(readFileSync(source, 'utf8'))
  catalog.instruments.push({
    id: randomUUID(),
    parentId: null,
    name: 'Instrumento vindo do arquivo',
    acronym: null,
    cognitiveFunctionPath: ['Memória', 'Memória de trabalho'],
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order: 5
  })
  writeFileSync(modified, JSON.stringify(catalog), 'utf8')

  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, modified)

  await page.getByRole('button', { name: 'Importar catálogo' }).click()

  // A prévia vem antes de qualquer escrita: um instrumento novo, e o conjunto
  // de faixas já idêntico ao que está gravado não conta como mudança.
  await expect(page.getByText('Instrumentos novos')).toBeVisible()
  await expect(page.getByText('Conjuntos de faixas sem mudança')).toBeVisible()

  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  await expect(page.getByText(/Catálogo importado/)).toBeVisible()

  await expect(
    page.getByRole('button', { name: 'Instrumento vindo do arquivo', exact: true })
  ).toBeVisible()
})

test('reimportar o mesmo catálogo não propõe mudança nenhuma', async () => {
  const modified = join(userDataDir, 'catalogo-com-novo.json')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, modified)

  await page.getByRole('button', { name: 'Importar catálogo' }).click()

  await expect(page.getByText('Este catálogo já está inteiramente neste computador.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Cancelar' }).click()
})
