/**
 * Configuração do drizzle-kit.
 *
 * O app NÃO usa o migrador do Drizzle em runtime: as migrations são escritas à
 * mão em `src/main/db/migrations.ts` para viajarem dentro do bundle do processo
 * principal (ver o comentário naquele arquivo). Esta configuração serve ao
 * `drizzle-kit generate`, usado como conferência: o SQL gerado a partir do
 * schema é comparado com o DDL escrito à mão quando se acrescenta uma tabela.
 * `tests/unit/schema-drift.spec.ts` é o guarda automático dessa correspondência.
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle'
})
