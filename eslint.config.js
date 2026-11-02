import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

/**
 * Regras do projeto.
 *
 * Duas escolhas que valem explicação:
 *
 *  - `no-undef` fica desligado em TypeScript. O compilador já resolve todo
 *    identificador com muito mais precisão, e a regra do ESLint não enxerga as
 *    libs do `tsconfig` — mantê-la só produziria falso positivo em `setTimeout`,
 *    `URL` e afins.
 *  - as regras de formatação do plugin Vue ficam desligadas porque o Prettier é
 *    quem formata. Deixar as duas ligadas gera briga por quebra de linha sem
 *    nenhum ganho.
 */
/** §10.5, camada 2 — ver o bloco de `src/main/ai/**` abaixo. */
const PATIENT_ISOLATION = {
  group: [
    '**/repositories/patients',
    '**/repositories/assessments',
    '**/repositories/trees',
    '**/repositories/documents',
    '**/repositories/classification-ranges',
    '**/services/reports',
    '**/services/document-report'
  ],
  message:
    'O módulo de IA lê dados de paciente exclusivamente pelo AgentReadRepository (§10.5). Importar um repositório geral aqui quebra o isolamento por paciente.'
}

/**
 * O SDK de cada empresa de IA mora só no adaptador dela, em
 * `src/main/ai/providers/`. Fora dali o app fala a interface neutra de
 * `providers/types.ts` — é o que permite trocar de provedor sem caçar
 * `import` pelo código.
 */
const PROVIDER_SDKS = {
  group: ['@google/genai', '@anthropic-ai/sdk', 'openai'],
  message:
    'SDK de provedor de IA só pode ser importado pelo adaptador em src/main/ai/providers/. Use a interface AiProvider.'
}

export default ts.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**']
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],

  {
    files: ['**/*.{ts,vue}'],
    rules: { 'no-undef': 'off' }
  },

  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node }
  },

  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: {
      // Nomes de uma palavra são a convenção nas views deste app.
      'vue/multi-word-component-names': 'off',

      // Formatação — território do Prettier.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/attributes-order': 'off',
      'vue/first-attribute-linebreak': 'off'
    }
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },

  {
    /**
     * §10.5, camada 2 — isolamento por paciente.
     *
     * O módulo de IA não pode alcançar os repositórios que leem dados de
     * paciente sem filtro: o único caminho autorizado é o `AgentReadRepository`,
     * construído com o `patientId` e responsável por injetar o `WHERE` em toda
     * consulta. Esta regra é o que impede a regressão silenciosa — um `import`
     * distraído de `repositories/patients` no orquestrador desfaria a garantia
     * sem que nenhum teste de comportamento acusasse.
     *
     * Os módulos de infraestrutura (gateway, schema, helpers) e as tabelas do
     * próprio módulo de IA continuam acessíveis: eles não expõem dado clínico
     * de terceiros.
     */
    files: ['src/main/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [PATIENT_ISOLATION, PROVIDER_SDKS]
        }
      ]
    }
  },

  {
    // O repositório do agente é justamente quem tem permissão para montar as
    // consultas — com o filtro por paciente aplicado em todas elas.
    files: ['src/main/ai/agent-read-repository.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [PROVIDER_SDKS] }] }
  },

  {
    // Os adaptadores importam o SDK da sua empresa — e só isso a mais: o
    // isolamento por paciente continua valendo dentro deles. No flat config a
    // regra do último bloco SUBSTITUI a anterior, por isso a lista é refeita.
    files: ['src/main/ai/providers/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [PATIENT_ISOLATION] }] }
  },

  {
    // Fora do módulo de IA, nenhum SDK de provedor.
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/main/ai/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [PROVIDER_SDKS] }] }
  }
)
