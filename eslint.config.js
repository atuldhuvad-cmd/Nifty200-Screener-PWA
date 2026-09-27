import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'samples/'] },
  js.configs.recommended,
  ts.configs.strict,
  svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.svelte'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'crypto', 'os'],
              message: 'src/ is browser code; Node APIs are allowed only in tests.',
            },
          ],
        },
      ],
      'no-console': 'error',
    },
  },
);
