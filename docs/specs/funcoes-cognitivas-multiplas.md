# SPEC: instrumento associado a várias funções cognitivas

> Status: aprovado em 2026-11-06. Sem código ainda. Acompanhamento em issue do GitHub (label `modulo: catálogo`).

## 1. Contexto

Hoje cada instrumento (teste, índice ou subteste) tem **uma** função cognitiva (`instruments.cognitive_function_id`).
Só que muitos instrumentos avaliam mais de uma coisa. Por exemplo:

- um teste de linguagem avalia linguagem expressiva **e** fonologia;
- o FDT avalia controle inibitório **e** fluência verbal.

O objetivo é permitir várias funções por instrumento, sem mudar a leitura dos resultados que já existe.

## 2. Decisões

| # | Tema | Decisão |
|---|------|---------|
| F1 | Hierarquia | Cada instrumento tem **uma função principal** e **zero ou mais secundárias**. A ordem das secundárias é definida pelo usuário. Uma secundária não pode repetir a principal nem outra secundária. |
| F2 | Agrupamento | Agrupar e agregar resultados usa **somente a principal**. Isso vale para a avaliação (agrupar por função), a visão geral e seus gráficos, o PDF de resultados e o comparativo, o `aggregateLevel` por função e o filtro do bloco de resultados no editor. As secundárias aparecem só como **etiqueta informativa** ("também avalia: …"). |
| F3 | Herança | Um instrumento **sem função principal própria** herda a principal e as secundárias do ancestral mais próximo que tenha principal. Se o instrumento tiver principal própria, nada é herdado: as secundárias do pai também não vêm. |
| F4 | Secundária sem principal | Não é permitido. Para cadastrar secundárias, é preciso ter uma principal. |

> Mudança de comportamento por causa da F3: hoje, um subteste sem função cai no grupo "Sem função cognitiva associada".
> Com a herança, ele passa a aparecer no grupo da função do teste pai.

## 3. Modelo de dados

A coluna `instruments.cognitive_function_id` **continua existindo e passa a significar a função principal**. Com isso,
tudo o que hoje agrupa por ela continua correto (F2) e a migration não precisa mexer em dados.

Tabela nova `instrument_secondary_functions`:

- `instrument_id`: referência a `instruments`, com `ON DELETE CASCADE`.
- `cognitive_function_id`: referência a `cognitive_functions`, com `ON DELETE CASCADE`.
- `order`: inteiro.
- Chave primária: `(instrument_id, cognitive_function_id)`.
- Índice em `cognitive_function_id`.

Migration: a próxima versão livre em `src/main/db/migrations.ts`. A numeração segue a ordem de merge: se a Fase 1 da
correção de testes for mergeada antes, esta migration vem depois dela. Atualizar também `schema.ts` e
`tests/unit/schema-drift.spec.ts`.

## 4. Domínio

Criar `src/shared/domain/instrument-functions.ts` com a função
`resolveFunctions(instrumentId, instruments, secondaryLinks)`, que devolve `{ primaryId, secondaryIds, inheritedFrom }`.

- Segue a mesma ideia de `loadRanges` e `inheritsRanges` em `src/main/services/classification.ts`: sobe a árvore pelo
  `parentId` até achar um nó com principal.
- Precisa de testes unitários.

As consultas que hoje fazem join direto em `instruments.cognitiveFunctionId` passam a usar a **função principal
efetiva**, já resolvida com a herança:

- `src/main/repositories/assessments.ts`: os dois selects de resultados.
- `src/main/ai/agent-read-repository.ts`: três consultas.
- `src/main/services/results-overview.ts`, `src/main/services/reports.ts` e `src/main/services/document-report.ts`:
  passam a receber o id já resolvido.

Os contratos de resultado (`src/shared/contracts/results.ts` e `index.ts`) ganham `secondaryFunctions: {id, name}[]`
e `functionInherited: boolean`.

## 5. Onde muda

| Área | Arquivo(s) | Mudança |
|------|-----------|---------|
| Cadastro de instrumento | `src/renderer/src/views/InstrumentsView.vue`, `src/shared/contracts/entities.ts` | Campo "Função principal" (o select atual) e "Funções secundárias" (seleção múltipla ordenável). Desabilitar as secundárias quando não houver principal. Mostrar "herdada de <pai>" quando estiver vazio. |
| Repositório | `src/main/repositories/instruments.ts` (ou equivalente) | Salvar o instrumento e as secundárias na mesma transação. Validar F1 e F4. |
| Exclusão de função | `src/main/repositories/trees.ts` (`cognitiveFunctionImpact`) | Contar também os vínculos secundários na mensagem de impacto. |
| Avaliação e resultados | `AssessmentView.vue`, `ResultsView.vue` | Etiqueta "também avalia: …" na linha do resultado. O agrupamento continua igual (F2). |
| PDF | `src/main/pdf/templates.ts`, `document-report.ts` (`renderResultsTable`) | Mostrar as secundárias abaixo do nome do instrumento. O agrupamento não muda. |
| Catálogo | `src/shared/contracts/catalog.ts`, `services/catalog/export.ts` e `import.ts` | Campo opcional `secondaryFunctionPaths: string[][]`. Um arquivo sem esse campo continua válido. Confirmar se o schema do catálogo rejeita campos desconhecidos; se rejeitar, usar o formato `baremo/catalog@2` e manter a importação de `@1`. |
| IA | `src/main/services/ai-catalog-write.ts`, `agent-read-repository.ts` | A leitura de instrumentos devolve as secundárias. A escrita aceita `funcoesSecundariasIds`, com o mesmo fluxo de confirmação de hoje. |
| Correção de testes | `docs/specs/correcao-de-testes.md` | Nada muda. Uma definição de correção aponta para instrumentos, e as funções vêm deles. |

## 6. Verificação

- **Testes unitários:**
  - `resolveFunctions`: função própria, herdada, sem nenhuma, e principal própria que bloqueia as secundárias do pai.
  - Validação de duplicata e de secundária sem principal.
  - Exportação e importação do catálogo, nas duas direções e com arquivo antigo.
  - `results-overview` agrupando pela principal herdada.
- **Testes de segurança:** a escrita da IA continua passando pela confirmação (`tests/security/catalog-write.spec.ts`).
- **Teste e2e:**
  1. Cadastrar o FDT com principal Controle inibitório e secundária Fluência verbal.
  2. Deixar um subteste sem função.
  3. Lançar resultados e conferir que o subteste aparece no grupo do pai, com a etiqueta das secundárias.
  4. Gerar o PDF.
- Rodar `npm run typecheck`, `npm test` e `npm run test:e2e`.
