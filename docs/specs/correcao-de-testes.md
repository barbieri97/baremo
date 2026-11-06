# SPEC — Correção de testes psicológicos no Baremo

> Status: aprovado em 2026-11-06. Acompanhamento em issues do GitHub (label `modulo: correção`).

## 1. Contexto

Hoje o Baremo **não corrige** testes: o psicólogo corrige fora (folha + manual), converte bruto → percentil/T/ponderado
e digita só o resultado normativo na avaliação (`ResultRowEditor` / `ResultBatchEditor` → `results:save[Many]`).
A partir daí o sistema já classifica automaticamente pelas `classification_ranges` e congela o snapshot (ADR-004).

Objetivo: o Baremo passa a receber **respostas/brutos**, converter pelas **tabelas normativas** escolhidas e
disparar o fluxo existente (resultado normativo → classificação → snapshot), mantendo a digitação direta.

"Interpretação" nesta spec = **o resultado normativo** que hoje é digitado à mão. Texto interpretativo para laudo
fica fora do escopo.

## 2. Decisões tomadas

| # | Tema | Decisão |
|---|------|---------|
| D1 | Pipeline | respostas → brutos → derivados → conversão normativa → `saveResults` existente → classificação por faixas (inalterada) |
| D2 | Onde corrigir | Dentro da avaliação: `/avaliacoes/:id/corrigir/:definitionId` |
| D3 | Release x usuário | Release embarca só **estrutura** (itens, subescalas, etapas, componente). Normas sempre cadastradas/importadas pelo usuário (material protegido) |
| D4 | Intervalos | Resultado guarda `valueMin`/`valueMax` + texto de exibição; se o intervalo cruzar faixas, o usuário escolhe a classificação |
| D5 | Estratos | Idade, escolaridade, região, tipo de escola/série, sexo, respondente — combináveis |
| D6 | Conversões | Tabela de consulta (bruto/faixa → valor/intervalo), média-DP (z/T/padrão), compostos (soma de convertidos → nova tabela), classificação direta (via faixas existentes) |
| D7 | Dados do paciente | Escolaridade estruturada (nível + anos), região (UF), tipo de escola e série — **tudo no paciente**; texto livre atual vira observação |
| D8 | Persistência | Salvar tudo: respostas por item, brutos, derivados, tabela+versão usadas, convertidos |
| D9 | Página genérica | Um campo de bruto por subescala/subteste (sem itens) |
| D10 | Regras | Etapas **declarativas** fixas: soma, diferença, razão, média, consulta em tabela, z/T por média-DP. Sem fórmula livre. Novas operações só via release |
| D11 | Classificação direta | Reaproveita `classification_ranges` (tipo `points`/percentil) — fonte única |
| D12 | Sugestão de tabela | Só sugere com **match exato**; nenhum ou vários → usuário escolhe (seletor mostra por que cada tabela não casa) |
| D13 | Importação | Modelo para baixar (formato longo) **e** planilha qualquer com tela de mapeamento de colunas → prévia editável → salvar |
| D14 | Registry | Chave = **código estável** da definição (`fdt`, `ravlt`, `srs2`); fallback = página genérica |
| D15 | Versionamento | Tabela normativa versionada; resultado guarda tabela+versão; reprocessar é ação explícita com prévia |
| D16 | Coexistência | Digitação direta continua. Concluir correção sobrescreve resultados do teste na avaliação após confirmação; editar à mão depois marca "ajustado manualmente" |
| D17 | Ligação ao catálogo | Ativar definição da release → vincular a instrumento existente (mapeando subescalas) ou criar a árvore |
| D18 | 1ª entrega personalizada | FDT, RAVLT, SRS-2 |
| D19 | Omissões | Regra por definição (limite + ação: invalidar / prorratear / imputar); genérica exige todos os brutos |
| D20 | Rascunho | Autosalvo; resultados só entram em "Concluir correção". Sem PDF da folha, sem export de definições (fora de escopo) |
| D21 | Tempo | Somente segundos (campo numérico) |
| D22 | Navegação | Nova aba **Correção** em Instrumentos (definição, tabelas, importação) |
| D23 | Seleção de tabela | Seletor de estrato no topo para o teste todo; cada escore pode trocar individualmente |
| D24 | Motor | Puro em `src/shared`; front calcula ao vivo, main **recalcula e valida** ao salvar (nunca confia no convertido vindo do front) |
| D25 | IA | Nova ferramenta do assistente que preenche brutos do **rascunho** com confirmação humana |

## 3. Modelo de dados (`src/main/db/migrations.ts` + `schema.ts`)

Uma migration por fase, criada quando a fase precisa dela (ver §7.1): Fase 1 → paciente estruturado,
`scoring_definitions`, `norm_sets`, `norm_tables`, `norm_table_rows`; Fase 3 → `scoring_sessions` e colunas novas de
`assessment_results`. As demais fases só criam migration se surgir necessidade.

**`scoring_definitions`** — o "teste corrigível"
- `id`, `code` (único, estável; obrigatório p/ builtin, gerado p/ usuário), `name`, `instrumentId` (raiz),
  `origin` (`builtin`|`user`), `builtinRevision`, `version`
- `inputsJson`: entradas `{ key, label, kind: 'raw'|'time'|'item', instrumentId?, min?, max? }`
- `stepsJson`: etapas declarativas (§4)
- `outputsJson`: `{ key, instrumentId, scoreType }` — o que vira `assessment_results`
- `strataDimensionsJson`: quais dimensões as tabelas desta definição usam
- `omissionRuleJson`

**`norm_sets`** — fonte normativa (ex.: "FDT — manual 2015"): `id`, `definitionId`, `name`, `reference`

**`norm_tables`** — um estrato: `id`, `normSetId`, `name`, `version`, `status` (`draft`|`active`),
`criteriaJson` (ex.: `{ ageMonths:[96,119], educationLevel:['fundamental'], sex:'F', respondent:'pais' }`)

**`norm_table_rows`**: `id`, `tableId`, `version`, `targetKey` (entrada/derivado), `method` (`lookup`|`meanSd`),
`rawMin`, `rawMax`, `scoreType`, `valueMin`, `valueMax`, `displayText`, `mean`, `sd`

**`scoring_sessions`** — uma correção dentro da avaliação: `id`, `assessmentId`, `definitionId`, `definitionVersion`,
`status` (`draft`|`completed`), `contextJson` (estratos usados, respondente), `responsesJson`, `rawJson`,
`derivedJson`, `tableSelectionsJson` (tabela+versão por saída), `warningsJson`, `updatedAt`, `completedAt`

**`assessment_results`** (alterar): `valueMin`, `valueMax`, `displayValue`, `source` (`manual`|`scoring`),
`scoringSessionId`, `normTableId`, `normTableVersion`, `adjustedAfterScoring`. `value` continua sendo o valor
pontual (ou ponto médio do intervalo, usado só para gráficos/normalização).

**`patients`** (alterar): `educationLevel` (enum), `educationYears`, `region` (UF), `schoolType`, `schoolGrade`;
`education` atual vira observação. Migration tenta inferir nível a partir do texto livre.

Atualizar `src/shared/contracts/entities.ts`, `contracts/index.ts` (novos canais), `tests/unit/schema-drift.spec.ts`.

## 4. Motor de correção (`src/shared/scoring/`)

- `engine.ts` — `runScoring(definition, inputs, context, tables) → { raw, derived, outputs, warnings }`, puro.
- Etapas: `sum`, `difference`, `ratio`, `mean`, `lookup` (bruto → valor ou intervalo), `meanSd` (z → T/padrão/
  percentil), composição natural (saída de `lookup` alimenta `sum`, que alimenta outro `lookup`). Ordem por
  dependência (grafo, erro em ciclo).
- `strata.ts` — `computeContext(patient, assessmentDate)` (idade em meses na data da avaliação) e
  `matchTables(tables, context) → { exact[], partial[{table, mismatches}] }` (D12).
- `omissions.ts` — aplica a regra de omissão (D19).
- Intervalos: `lookup` retorna `{min,max,display}`; `classifyInterval` usa `resolveRange` de
  `src/shared/domain/ranges.ts` nas duas pontas → igual = classifica; diferente = `needsChoice`.
- Validação de domínio reaproveita `validateScoreValue`/`toScaled` de `src/shared/domain/score-types.ts`.
- Validação de tabelas (sobreposição/buracos de bruto por `targetKey`) no estilo de `validateRangeSet`.
- Definições builtin em `src/shared/scoring/builtin/{fdt,ravlt,srs2}.ts` (só estrutura).

## 5. Fluxo de correção (main)

Novos canais IPC (handlers em `src/main/ipc/handlers/scoring.ts`, repositório `src/main/repositories/scoring.ts`):
`scoring:definitions:list/get/save/activate`, `scoring:normSets:*`, `scoring:tables:*`, `scoring:import:parse`,
`scoring:sessions:get/saveDraft/complete/previewReprocess/reprocess`.

`complete`: carrega definição + tabelas na versão selecionada → `runScoring` no main → se houver resultados
existentes do teste na avaliação, exige flag de confirmação → transação: grava sessão `completed` + chama a lógica
de `saveResults` (`src/main/repositories/assessments.ts:295`) com `source='scoring'` → classificação/snapshot como hoje
(`src/main/services/classification.ts`). Registrar em `audit_log`.

Reprocessar (D15): espelha `previewReprocess`/`reprocessAssessment` (`assessments.ts:376/417`), comparando versão da
tabela usada x atual.

## 6. Interface

**Avaliação** (`AssessmentView.vue`): botão "Corrigir teste" → escolhe definição ativa → rota
`/avaliacoes/:id/corrigir/:definitionId`. Resultados vindos de correção mostram selo "corrigido" + link para reabrir.

**Página de correção** (`views/ScoringView.vue`): cabeçalho com paciente, idade na data, seletor de estrato/tabela
(sugestão só com match exato; lista mostra divergências), respondente quando aplicável; corpo = componente do
registry; rodapé com brutos → derivados → convertidos ao vivo, avisos, intervalo cruzando faixas pede escolha;
autosave de rascunho (debounce, igual `DocumentView`); "Concluir correção" com confirmação de sobrescrita.

**Registry** (`src/renderer/src/scoring/registry.ts`): `{ fdt: defineAsyncComponent(...), ravlt: ..., srs2: ... }`;
`resolveScoringComponent(code) ?? GenericScoringForm`. Contrato comum de props/eventos
(`definition`, `modelValue: responses`, emite `update:raw`) via composable `useScoringSession`.

- **Genérica**: um input por entrada `raw`/`time` da definição, agrupado pela árvore de instrumentos.
- **FDT**: tempo (s) e erros das 4 partes; inibição/flexibilidade por `difference`.
- **RAVLT**: A1–A5, B1, A6, A7, reconhecimento; total, ALT, interferência, velocidade de esquecimento.
- **SRS-2**: grade de itens Likert (respondente + sexo), itens invertidos e soma por subescala no front.

**Instrumentos → aba Correção** (`InstrumentsView.vue`): definição (entradas, etapas declarativas, saídas,
dimensões de estrato, regra de omissão), ativar builtin (vincular/criar árvore), conjuntos e tabelas normativas
(editor em grade), importação.

**Importação xlsx/csv**: parse no **main** (limite de tamanho, nunca executa fórmulas), lib `exceljs` + `papaparse`;
botão "Baixar modelo" (formato longo: `criterios… | alvo | bruto_min | bruto_max | tipo_escore | valor_min | valor_max`);
planilha qualquer → tela de mapear colunas (inclusive formato largo → várias tabelas) → prévia editável com erros de
validação → salvar como `draft`/`active`. Segue o padrão "plano antes de gravar" de `src/main/services/catalog/import.ts`.

**Paciente**: novos campos estruturados no formulário de cadastro/edição; aviso na correção quando série/escolaridade
pode estar desatualizada em relação à data da avaliação.

**Resultados/PDF/gráficos**: exibir `displayValue` ("25–50") em `ResultsView`, `resultsBlock`
(`document-report.ts`), templates PDF; gráficos usam ponto médio com barra de intervalo.

**IA (D25)**: ferramenta `preencher_correcao` em `src/main/services/` análoga a `ai-result-import.ts`: preenche brutos do
rascunho, usuário confirma; nunca conclui a correção.

## 7. Fases (uma issue cada)

1. **Fundação**: migration da fase, schema/contratos, campos do paciente, motor `src/shared/scoring` + testes unitários.
2. **Normas**: aba Correção, CRUD de definição de usuário, conjuntos/tabelas, editor em grade, importação xlsx/csv.
3. **Correção genérica**: rota, `ScoringView`, registry + fallback, sugestão de tabela, rascunho, concluir,
   intervalos em resultados/PDF/gráficos, coexistência com digitação direta.
4. **Personalizadas**: builtin FDT, RAVLT, SRS-2 + ativação/vínculo ao catálogo.
5. **Reprocessamento** por versão de tabela.
6. **IA** preenchendo rascunho.

### 7.1 Estratégia de execução

- **Um PR por fase**, cada um mergeado na `main` com CI verde (lint, typecheck, unit, e2e). Nada de branch longa
  acumulando todas as fases.
- **Sem interruptor de recurso**: por enquanto só o autor usa o app, então as telas entram visíveis à medida que as
  fases são mergeadas.
- **Migrations**: uma por fase (§3). Uma migration publicada nunca é editada, então até a primeira release que a
  contenha ela ainda pode ser ajustada na `main` (via PR). A partir da release, ajustes viram nova migration.
- **Releases**: nenhuma release nas Fases 1 e 2 (não entregam nada usável sozinhas). **Primeira release ao fim da
  Fase 3** (correção genérica de ponta a ponta). Fases 4, 5 e 6 → uma release cada. Correções de bug urgentes podem
  ser lançadas a qualquer momento, sabendo que congelam as migrations já mergeadas.
- **Teste antes de lançar**: rodar em dev apontando para uma **cópia** do banco real, nunca o original. Opcional:
  pré-release (`vX.Y.Z-beta.N`) para testar o instalador/auto-update.

## 8. Verificação

- Unit (`tests/unit/scoring/*.spec.ts`): cada operação, ordem/ciclo, lookup com faixas de bruto e intervalos,
  média-DP, composto, match de estratos (exato, nenhum, vários), omissões, intervalo cruzando faixas,
  idade em meses, validação de tabela, parse/mapeamento de planilha (fixtures em `tests/fixtures/`).
- Segurança (`tests/security`): import rejeita arquivo grande/malformado; main recalcula e ignora convertidos do front.
- `schema-drift.spec.ts` atualizado.
- E2E (`tests/e2e/scoring.spec.ts`): cadastrar definição + importar CSV de tabela → paciente com escolaridade/idade
  → avaliação → corrigir pela genérica (sugestão aparece) → concluir → resultado com classificação e intervalo →
  PDF; repetir com FDT; editar tabela → reprocessar com prévia.
- `npm run typecheck`, `npm test`, `npm run test:e2e`.

## 9. Pendências para confirmar durante a implementação

- Itens invertidos/chaves do SRS-2 e regras de omissão de cada teste vêm do manual: confirmar se a estrutura pode ir
  na release ou se também deve ser cadastrada pelo usuário.
- Lista fechada de níveis de escolaridade e de tipos de escola (enum).
- Nomes dos respondentes padronizados (autorrelato, pais, professor...).
