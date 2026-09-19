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
  await page.getByRole('radio', { name: 'Item individual' }).click()

  await page.getByLabel('Instrumento').selectOption({ label: 'Teste de Atenção Concentrada (TAC)' })
  // Só há faixas de percentil: o tipo vem autoselecionado e a lista oferece só
  // ele e o escore bruto.
  await expect(page.getByLabel('Tipo de escore')).toHaveValue('percentile')
  await expect(page.getByLabel('Tipo de escore').locator('option')).toHaveCount(2)
  // Com as cinco faixas geradas em partes iguais, 65 cai em [60, 80) — a quarta,
  // "Média superior".
  await page.getByLabel('Valor').fill('65')

  // A prévia aparece ANTES de gravar — é o que faz o erro de digitação ser
  // percebido no momento em que acontece (§16.4).
  await expect(page.getByText('Média superior').first()).toBeVisible()

  await page.getByRole('button', { name: 'Lançar' }).click()
  await expect(page.locator('table').getByText('Média superior').first()).toBeVisible()
})

test('abre a visualização de resultados', async () => {
  // A tela de avaliação deixou de gerar PDF direto: o relatório de resultados
  // substituiu os dois anteriores e sai daqui, ao lado dos gráficos que ele
  // reproduz.
  await page.getByRole('button', { name: 'Visualizar resultados' }).click()

  await expect(page.getByRole('heading', { name: /^Resultados de/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Panorama por função' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Por teste' })).toBeVisible()

  // O resultado lançado no teste anterior aparece na leitura por função.
  await expect(page.getByText('Média superior').first()).toBeVisible()
})

test('gera o relatório de resultados em PDF', async () => {
  // O diálogo de salvar é nativo: interceptamos para não travar o teste.
  const target = join(userDataDir, 'relatorio.pdf')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  await page.getByRole('button', { name: 'Exportar PDF' }).click()
  await expect(page.getByText('Relatório gerado.')).toBeVisible({ timeout: 20_000 })

  // A verificação roda no processo de teste, e não dentro do Electron: é o mesmo
  // sistema de arquivos, e evita serializar `fs` para dentro do main.
  expect(existsSync(target)).toBe(true)
  // Maior que o limite antigo de propósito: com fonte embutida e SVG, um PDF
  // pequeno demais indicaria que a tipografia ou os gráficos não entraram.
  expect(statSync(target).size).toBeGreaterThan(20_000)
})

test('salva a imagem de um gráfico', async () => {
  const target = join(userDataDir, 'grafico.png')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)

  // Sem gráfico de comparação (o instrumento do roteiro tem um escore só), o
  // botão de PNG que existe é o do radar do panorama.
  const png = page.getByRole('button', { name: 'PNG' }).first()
  if (await png.isVisible()) {
    await png.click()
    await expect(page.getByText(/Imagem salva em/)).toBeVisible({ timeout: 15_000 })
    expect(existsSync(target)).toBe(true)
  }

  await page.getByRole('button', { name: /Voltar à avaliação/ }).click()
  await expect(page.getByRole('heading', { name: /^Avaliação de/ })).toBeVisible()
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

test('importa uma bateria com subtestes e faixas próprias', async () => {
  // Pai com índice em escore padrão, filhos em escore ponderado — o formato das
  // baterias reais, e o que exercita a escolha de tipo por linha.
  const parentId = randomUUID()
  const colorLow = randomUUID()
  const colorHigh = randomUUID()
  const bands = (scoreType: string, cut: number, min: number, max: number) => ({
    scoreType,
    entries: [
      {
        classificationName: 'Rebaixado',
        minValue: min,
        maxValue: cut,
        colorId: colorLow,
        level: 1
      },
      {
        classificationName: 'Preservado',
        minValue: cut,
        maxValue: max,
        colorId: colorHigh,
        level: 3
      }
    ]
  })
  const children = ['Subteste Um', 'Subteste Dois'].map((name, order) => ({
    id: randomUUID(),
    parentId,
    name,
    acronym: null,
    cognitiveFunctionPath: null,
    minAgeYears: null,
    maxAgeYears: null,
    reference: null,
    order
  }))
  const file = {
    schema: 'baremo/catalog@1',
    exportedAt: new Date().toISOString(),
    appVersion: 'e2e',
    colors: [
      { id: colorLow, name: 'Vermelho de teste', hex: '#C53030' },
      { id: colorHigh, name: 'Verde de teste', hex: '#2F855A' }
    ],
    instruments: [
      {
        id: parentId,
        parentId: null,
        name: 'Bateria de Verificação',
        acronym: 'BV',
        cognitiveFunctionPath: null,
        minAgeYears: null,
        maxAgeYears: null,
        reference: null,
        order: 10
      },
      ...children
    ],
    ranges: [
      { instrumentId: parentId, ...bands('standardScore', 90, 40, 160) },
      ...children.map((child) => ({ instrumentId: child.id, ...bands('scaledScore', 8, 1, 19) }))
    ]
  }
  const target = join(userDataDir, 'bateria.json')
  writeFileSync(target, JSON.stringify(file), 'utf8')

  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, target)

  await page.getByRole('link', { name: /Instrumentos/ }).click()
  await page.getByRole('button', { name: 'Importar catálogo' }).click()
  await page.getByRole('button', { name: 'Importar', exact: true }).click()
  await expect(page.getByText(/Catálogo importado: 3 instrumento/)).toBeVisible()
})

test('a árvore de instrumentos começa recolhida e abre sob demanda', async () => {
  // Recarrega a tela para ver o estado inicial, sem expansões desta sessão.
  await page.getByRole('link', { name: /Pacientes/ }).click()
  await page.getByRole('link', { name: /Instrumentos/ }).click()

  const battery = page.getByRole('button', { name: 'Bateria de Verificação', exact: true })
  const child = page.getByRole('button', { name: 'Subteste Um', exact: true })
  const expand = page.getByRole('button', { name: 'Expandir Bateria de Verificação' })

  await expect(battery).toBeVisible()
  await expect(child).toHaveCount(0)
  await expect(expand).toHaveAttribute('aria-expanded', 'false')

  await expand.click()
  await expect(child).toBeVisible()

  await page.getByRole('button', { name: 'Recolher Bateria de Verificação' }).click()
  await expect(child).toHaveCount(0)
})

test('lança o teste completo escolhendo só o pai', async () => {
  await page.getByRole('link', { name: /Pacientes/ }).click()
  await page.getByText('Paciente de Verificação').click()
  await page.getByText('Verificação automatizada').click()
  await expect(page.getByRole('heading', { name: /^Avaliação de/ })).toBeVisible()

  // Depois de um lançamento a linha de entrada fica aberta; numa visita nova,
  // abre-se pelo botão.
  const open = page.getByRole('button', { name: 'Lançar resultado' })
  if (await open.isVisible()) await open.click()

  // "Teste completo" é o modo padrão, e o seletor só lista quem tem subtestes.
  await expect(page.getByRole('radio', { name: 'Teste completo' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  const root = page.getByLabel('Teste', { exact: true })
  await expect(root.locator('option', { hasText: 'Teste de Atenção Concentrada' })).toHaveCount(0)
  await root.selectOption({ label: 'Bateria de Verificação (BV)' })

  // Pai e filhos na grade, cada um já no tipo que tem faixas.
  await expect(page.getByLabel('Tipo de escore — Bateria de Verificação (BV)')).toHaveValue(
    'standardScore'
  )
  const childType = page.getByLabel('Tipo de escore — Subteste Um')
  await expect(childType).toHaveValue('scaledScore')
  await expect(childType.locator('option')).toHaveCount(2)

  // "Para todos" troca de uma vez as linhas que têm o tipo; as outras ficam.
  const parentType = page.getByLabel('Tipo de escore — Bateria de Verificação (BV)')
  const bulk = page.getByLabel('Tipo de escore para todos')
  await bulk.selectOption('raw')
  await expect(parentType).toHaveValue('raw')
  await expect(childType).toHaveValue('raw')
  await expect(page.getByLabel('Tipo de escore — Subteste Dois')).toHaveValue('raw')
  await expect(bulk).toHaveValue('')

  await bulk.selectOption('scaledScore')
  await expect(childType).toHaveValue('scaledScore')
  await expect(page.getByLabel('Tipo de escore — Subteste Dois')).toHaveValue('scaledScore')
  await expect(parentType).toHaveValue('raw')
  await expect(page.getByText(/em 1 linha\(s\); elas mantiveram o tipo anterior/)).toBeVisible()

  await bulk.selectOption('standardScore')
  await expect(parentType).toHaveValue('standardScore')
  await expect(childType).toHaveValue('scaledScore')

  // Enter avança de linha em linha; no último, lança tudo.
  await page.getByLabel('Valor — Bateria de Verificação (BV)').fill('85')
  await page.getByLabel('Valor — Bateria de Verificação (BV)').press('Enter')
  await expect(page.getByLabel('Valor — Subteste Um')).toBeFocused()
  await page.getByLabel('Valor — Subteste Um').fill('12')
  await page.getByLabel('Valor — Subteste Um').press('Enter')
  await page.getByLabel('Valor — Subteste Dois').fill('5')
  await page.getByLabel('Valor — Subteste Dois').press('Enter')

  await expect(page.getByText('3 resultado(s) lançado(s).')).toBeVisible()
  const table = page.locator('table')
  await expect(table.getByText('Bateria de Verificação', { exact: true })).toBeVisible()
  await expect(table.getByText('Bateria de Verificação › Subteste Um')).toBeVisible()
  await expect(table.getByText('Bateria de Verificação › Subteste Dois')).toBeVisible()
  await expect(table.getByText('Preservado')).toHaveCount(1)
  await expect(table.getByText('Rebaixado')).toHaveCount(2)
})
