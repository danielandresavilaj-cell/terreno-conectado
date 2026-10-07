import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      'docs/mockups-prueba/**',
      'Fase 1/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['backend/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
{
    files: ['**/*.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
  {
    // Nest inyecta por metadata de tipo: los tokens (ConfigService, DbService,
    // AuthService, …) deben importarse como VALOR, no como tipo, para que
    // design:paramtypes los referencie (si no, DI emite `Object` y falla).
    files: ['backend/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
)
