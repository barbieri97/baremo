# Baremo Desktop

Aplicativo desktop **local-first** para agregação de resultados normativos de
avaliação neuropsicológica, produção de documentos técnicos e geração de
relatórios em PDF.

O profissional aplica e corrige os testes nas ferramentas ou manuais de sua
preferência e insere no app apenas os **escores normativos finais**. A partir
deles, o Baremo mapeia a classificação qualitativa e a cor conforme as faixas
cadastradas, organiza os resultados na árvore de funções cognitivas, permite
anexar arquivos e redigir documentos, e exporta tudo em PDF.

---

## ⚠️ Requisito de instalação: criptografia de disco

**O banco de dados e os arquivos anexados ficam em claro no seu computador.**
Esta versão não cifra o banco em repouso (ADR-002), então a proteção desses
dados depende da criptografia de disco do sistema operacional:

| Sistema | Recurso |
| --- | --- |
| macOS | FileVault |
| Windows | BitLocker |
| Linux | LUKS |

Ative-a **antes** de cadastrar o primeiro paciente. Backups e prontuários
exportados herdam a mesma exposição.

## ⚠️ O módulo de IA envia dados para fora do computador

O assistente de IA é **opcional e vem desligado**. Com ele ligado, dados do
prontuário são enviados à API do Google Gemini — um serviço de terceiros. O
posicionamento correto do produto é *local-first, com processamento em nuvem
opcional e consentido* (ADR-001).

Mitigações implementadas:

- desligado por padrão; todo o restante do app funciona sem ele;
- consentimento explícito no primeiro uso e por paciente;
- **pseudonimização ligada por padrão**: nome vira iniciais, data de nascimento
  vira idade, e responsável, escola, endereço e contatos são removidos;
- indicador permanente do estado do módulo na interface;
- toda escrita passa por confirmação humana;
- auditoria de cada chamada.

**Recomendação forte:** use uma chave de projeto com **faturamento habilitado**.
Chaves de nível gratuito historicamente têm política de retenção e uso para
melhoria de produto distinta — inadequada para dado sensível de saúde.

## ⚠️ Assinatura digital não incluída

O app **não** implementa assinatura ICP-Brasil, exigida para documentos
psicológicos em meio eletrônico (Res. CFP nº 11/2018). Exporte o PDF e assine
externamente, no **gov.br** ou no **Assinador ITI**.

---

## Desenvolvimento

```bash
npm install
npm run dev
```

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | App em modo desenvolvimento, com HMR no renderer |
| `npm run build` | Compila main, preload e renderer para `out/` |
| `npm run lint` | ESLint, incluindo a regra de isolamento do módulo de IA |
| `npm run typecheck` | `tsc` no main/preload e `vue-tsc` no renderer |
| `npm test` | Vitest: unidade + os três gates de segurança |
| `npm run test:e2e` | Playwright for Electron (use `xvfb-run` sem display) |
| `npm run pack:dir` | Empacota sem gerar instalador, para inspeção |
| `npm run release` | Build multiplataforma e publicação no GitHub Releases |

### Sobre o módulo nativo

`better-sqlite3` é a única dependência nativa, e desde a versão 13 ela é
**Node-API**: os prebuilds publicados no npm não trazem sufixo de ABI
(`prebuilds/win32-x64.node`, e não `…-node-v137-…`), então o mesmo binário
carrega tanto no Node quanto no Electron. Não há nada a recompilar — `npm
install` basta, e nenhuma toolchain C++ é necessária para desenvolver ou
empacotar.

Por isso o `electron-builder` roda com `npmRebuild: false`. Se algum dia entrar
uma dependência nativa que **não** seja Node-API, esse ajuste precisa ser
revertido e as máquinas que empacotam passarão a exigir compilador C++
(Visual Studio Build Tools no Windows, Xcode CLT no macOS).

---

## Arquitetura

```
src/
├── main/        processo principal — banco, PDF, arquivos, IA, IPC
├── preload/     ponte contextBridge, superfície mínima
├── renderer/    interface Vue 3 + Tailwind + Reka UI
└── shared/      contratos Zod e domínio puro, usados pelos dois lados
```

Três decisões estruturais que valem conhecer antes de mexer no código:

**O contrato de IPC é a fonte única.** `src/shared/contracts/` declara, por
canal, o schema Zod de entrada e de saída. Não existe `ipcMain.handle` cru em
lugar nenhum — tudo passa por `registerHandler`, que valida o remetente e o
payload antes de qualquer acesso a banco ou filesystem. Um canal sem schema
simplesmente não é exposto ao renderer.

**A classificação é um snapshot, não uma referência viva.** Quando um resultado
é gravado, a classificação e a cor viram coluna daquela linha. Editar a tabela
de faixas depois **não** reclassifica avaliações já emitidas em laudo — isso é
inaceitável em documento com validade técnica (ADR-004). Reprocessar existe,
mas é ação explícita, com prévia e auditoria.

**O módulo de IA não alcança dados de paciente sem filtro.** O
`AgentReadRepository` recebe o `patientId` no construtor e injeta o `WHERE` em
toda consulta; nenhuma tool declara `patientId`; todo ID vindo do modelo é
revalidado; e uma regra de ESLint impede que `src/main/ai/**` importe os
repositórios gerais. `tests/security/patient-isolation.spec.ts` é o gate que
trava isso no CI.

### Gates de segurança (bloqueantes no CI)

| Suíte | Verifica |
| --- | --- |
| `tests/security/patient-isolation.spec.ts` | Nenhuma tool retorna dado de outro prontuário — com IDs adversariais **e IDs válidos de outros pacientes** |
| `tests/security/serializer-xss.spec.ts` | A allowlist do serializador TipTap→HTML segura payloads de XSS |
| `tests/security/path-resolver.spec.ts` | O resolvedor do protocolo `baremo-file://` não escapa do diretório de anexos |

---

## Onde ficam os dados

Tudo em `userData` do sistema (`~/.config/baremo` no Linux,
`~/Library/Application Support/baremo` no macOS,
`%APPDATA%/baremo` no Windows):

```
baremo.db            banco SQLite
backups/             backups automáticos e manuais (10 mais recentes)
arquivos/            anexos, endereçados por conteúdo (sha256)
gemini-key.enc       chave de API cifrada, quando persistida
```

O backup automático cobre **apenas o banco**. Para incluir os arquivos, use
"Exportar prontuário" na ficha do paciente — que também atende à portabilidade
prevista na LGPD.

---

## Levar o catálogo de uma máquina para outra

Instrumentos e faixas de classificação viajam em um arquivo `.json`, pelos
botões **Exportar catálogo** e **Importar catálogo** na tela de Instrumentos.
Serve para montar o catálogo em um computador e levá-lo para outro, e para
mantê-lo em dia entre os dois ao longo do tempo.

O catálogo NÃO é semeado no instalador, e isso é decisão, não pendência: as
faixas normativas são a tabela do manual do teste, e distribuí-las embutidas no
release seria entregá-las a quem não comprou o instrumento (a mesma razão
registrada em `src/main/db/seed.ts`). Em arquivo, quem decide para quem o
catálogo vai é quem o exportou.

O que o arquivo leva: instrumentos, com a hierarquia; as faixas de cada par
instrumento + tipo de escore; e as cores usadas por essas faixas. O que ele
**não** leva: nenhum dado de paciente, avaliação, resultado ou documento — para
isso existe "Exportar prontuário", que é outra coisa e tem outro cuidado.

Quatro regras valem a pena conhecer antes de usar:

**Importar mostra antes de fazer.** O arquivo é lido e validado, e a tela diz
quantos instrumentos entram, quantos são atualizados e quantos conjuntos de
faixas serão substituídos. Nada é gravado até a confirmação.

**Importar nunca exclui.** O que existe no computador e não está no arquivo
permanece. O arquivo acrescenta e atualiza; quem remove é você, pela tela.

**Reimportar o mesmo arquivo não faz nada.** Os ids viajam junto, então a
segunda importação reconhece o que já está lá. Um conjunto de faixas idêntico ao
gravado não é regravado — o que preserva a versão das faixas, que é o rastro que
liga um resultado ao conjunto com que foi classificado (§4.8).

**As classificações já lançadas não mudam.** Importar faixas novas não
reclassifica avaliações existentes, pelo ADR-004. Para isso existe o
reprocessamento, que é ação explícita e com prévia.

A árvore de funções cognitivas não viaja no arquivo. O vínculo do instrumento
com ela é resolvido pelo NOME no computador de destino — cada instalação semeia
a própria árvore com ids diferentes, e o id da origem não significaria nada aqui.
O que não casar por nome é importado sem vínculo e aparece na lista de avisos,
para você criar a função e refazer o vínculo.

---

## Fora de escopo

Assinatura digital ICP-Brasil, sincronização automática entre máquinas (o
catálogo vai por arquivo, e o prontuário não vai), acesso multiusuário, aplicação
e correção de testes (o app agrega escores já convertidos), exportação nativa em
DOCX, agendamento e faturamento.

## Pendências antes da distribuição

1. **Confirmação documental do tratamento de dados no tier da API Gemini** a ser
   recomendado. É o único item capaz de inviabilizar o módulo de IA.
2. **Assinatura de código e notarização.** Sem certificado Windows e sem conta
   Apple Developer, os instaladores disparam avisos de SmartScreen e Gatekeeper.
   O `electron-builder` já está configurado para consumir os segredos quando
   existirem — é decisão de custo, não de código.
