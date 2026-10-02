import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: [
      'node_modules/**',
      '.wxt/**',
      '.output/**',
      'test-results/**',
      'playwright-report/**',
      'public/vendor/**',
      'vendor/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', URL: 'readonly' },
    },
  },
);
