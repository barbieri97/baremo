import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default ts.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'drizzle/**', 'test-results/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: ts.parser }
    },
    rules: {
      // Nomes de componente de uma palavra são a convenção nas views deste app.
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    // §10.5, camada 2 — o orquestrador de IA não pode alcançar os repositórios
    // gerais do app: só o AgentReadRepository, que é construído com o pacienteId
    // e injeta o filtro em toda consulta. Esta regra é o que impede a regressão.
    files: ['src/main/ai/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repositories/*', '**/db/gateway', '**/db/schema*'],
              message:
                'O módulo de IA só acessa dados via AgentReadRepository (§10.5). Importar repositórios gerais quebra o isolamento por paciente.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/main/ai/agent-read-repository.ts'],
    rules: { 'no-restricted-imports': 'off' }
  }
)
