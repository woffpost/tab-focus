import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/'] },
  js.configs.recommended,
  {
    files: ['src/**', 'public/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['*.{js,mjs}', 'test/**', 'e2e/**', 'eval/**'],
    languageOptions: { globals: { ...globals.node, ...globals.webextensions } },
  },
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
];
