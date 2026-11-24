import js from '@eslint/js';
import tseslint from 'typescript-eslint';

import { generatedCodeIgnores } from '../../eslint.config.base.mjs';

export default tseslint.config(
  { ignores: generatedCodeIgnores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Build and test scripts run in Node; the browser runner also holds a
    // function that executes in the page.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        window: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        TextEncoder: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
);
