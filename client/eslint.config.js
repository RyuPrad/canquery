import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The house data-fetching pattern (cancelled-flag effects that seed
      // loading/error state) intentionally sets state inside effects.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**'],
    languageOptions: {
      globals: {
        ...globals.browser,
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
])
