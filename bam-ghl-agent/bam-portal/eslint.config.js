import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const serverTsFiles = ['api/client/**/*.ts', 'api/parent/**/*.ts', 'api/_runtime/**/*.ts', 'api/runtime/**/*.ts', 'api/website/**/*.ts', 'vitest.config.ts']

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
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // api/ is Vercel serverless JavaScript running on Node, NOT in a browser.
  // Without this block those files inherited `globals.browser` from the block
  // above, so `process`, `Buffer`, `console` and friends read as undefined and
  // eslint reported 1223 no-undef errors that were not bugs. That noise is why
  // nobody ran the linter, and it is how a REAL no-undef (`client` read from a
  // catch after being declared inside the try, api/automations.js) shipped and
  // put the send worker into a 15-minute retry loop.
  //
  // Declaring the right environment is a CONFIG fix: it clears the false
  // reports without editing a single line of live payment, messaging or
  // automation code, which a mass "fix the lint" pass would have done.
  // .mjs is included so the api/_*.test.mjs suites are covered too - they were
  // matched by no config block at all, i.e. silently unlinted.
  {
    files: ['api/**/*.js', 'api/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        // On the Node 20 runtime but not in globals.node for this version of
        // the `globals` package. Mirrors the fetch entry the TS block below
        // already carries.
        fetch: 'readonly',
      },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: serverTsFiles,
  })),
  {
    files: serverTsFiles,
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
    },
  },
])
