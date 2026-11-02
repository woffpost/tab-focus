import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const locales = readdirSync(new URL('../public/_locales', import.meta.url));
const messages = Object.fromEntries(
  locales.map((locale) => [locale, JSON.parse(read(`public/_locales/${locale}/messages.json`))]),
);
const reference = messages.en;
const placeholders = (text) => (text.match(/\$\d/g) ?? []).sort();

test('every locale has the same keys and placeholders', () => {
  for (const [locale, list] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(list).sort(), Object.keys(reference).sort(), locale);
    for (const [key, { message }] of Object.entries(list)) {
      assert.deepEqual(placeholders(message), placeholders(reference[key].message), `${locale}: ${key}`);
    }
  }
});

test('every key the code asks for exists, and every message is used', () => {
  const code = readdirSync(new URL('../src', import.meta.url))
    .map((file) => read(`src/${file}`))
    .join('\n');
  const used = new Set([
    ...[...code.matchAll(/\bt\('(\w+)'/g)].map((match) => match[1]),
    ...[...read('public/popup.html').matchAll(/data-i18n(?:-placeholder)?="(\w+)"/g)].map((match) => match[1]),
    ...[...read('public/manifest.json').matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]),
  ]);
  assert.deepEqual([...used].sort(), Object.keys(reference).sort());
});
