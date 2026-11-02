// Drives the built extension in real Chromium with the real model.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS;
const server = createServer((req, res) => {
  const title = decodeURIComponent(req.url.slice(1));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
}).listen(0);
const port = server.address().port;
const url = (title) => `http://localhost:${port}/${encodeURIComponent(title)}`;

const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tab-focus-'));
const dist = resolve('dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const errors = [];

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  worker.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const extensionId = new URL(worker.url()).host;

  const open = async (title) => {
    const page = await context.newPage();
    await page.goto(url(title));
    return page;
  };
  const inTab = (fn, arg) => worker.evaluate(fn, arg);
  const tabByTitle = (title) =>
    inTab(async (t) => (await chrome.tabs.query({})).find((x) => x.title === t), title);
  const until = async (label, check, timeout = 20000) => {
    const end = Date.now() + timeout;
    for (;;) {
      if (await check()) return;
      if (Date.now() > end) throw new Error(`timeout: ${label}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  const onRu = 'Подоходный налог в Молдове для компаний';
  const onRo = 'Cota TVA în Republica Moldova';
  const offA = 'Рецепт борща с говядиной';
  const offB = 'Netflix';
  const own = 'Купить кроссовки Nike';
  const pinned = 'Weather forecast';
  for (const title of [onRu, onRo, offA, offB, own, pinned]) await open(title);

  const ownId = (await tabByTitle(own)).id;
  const ownGroup = await inTab((id) => chrome.tabs.group({ tabIds: id }), ownId);
  await inTab(async ([id]) => chrome.tabs.update(id, { pinned: true }), [(await tabByTitle(pinned)).id]);

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 520 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'start.png') });
  await popup.fill('#topic', 'налоги Молдовы');
  await popup.click('#start button');
  const state = () => inTab(async () => (await chrome.storage.session.get('state')).state);
  const started = Date.now();
  await until('focus started', async () => {
    const { status } = await inTab(() => chrome.storage.session.get('status'));
    if (status?.error) throw new Error(status.text);
    return (await state())?.active;
  }, 280000);
  console.log(`started in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  let s = await state();
  assert.equal((await tabByTitle(onRu)).groupId, s.focusGroupId, 'RU tab in focus');
  assert.equal((await tabByTitle(onRo)).groupId, s.focusGroupId, 'RO tab in focus');
  assert.equal((await tabByTitle(offA)).groupId, s.offGroupId, 'off tab in off group');
  assert.equal((await tabByTitle(offB)).groupId, s.offGroupId, 'off tab in off group');
  assert.equal((await tabByTitle(own)).groupId, ownGroup, 'user group untouched');
  assert.equal((await tabByTitle(pinned)).groupId, -1, 'pinned untouched');
  assert.equal((await inTab((id) => chrome.tabGroups.get(id), s.offGroupId)).collapsed, true);
  const best = Math.max(...Object.values(s.tabs).map(({ score }) => score));
  assert.equal(s.autoThreshold, true);
  assert.ok(Math.abs(s.threshold - best / 2) < 1e-9, `threshold ${s.threshold} follows best ${best}`);
  console.log(`ok: first sort, automatic threshold ${s.threshold.toFixed(2)}`);

  const distraction = 'YouTube cats compilation';
  await open(distraction);
  await until('classified', async () => {
    const t = await tabByTitle(distraction);
    return t && (await state()).tabs[t.id];
  });
  const d = await tabByTitle(distraction);
  assert.equal(d.active, true);
  assert.equal(d.groupId, -1, 'active off-topic tab stays put');
  assert.equal(await inTab((tabId) => chrome.action.getBadgeText({ tabId }), d.id), '!');
  console.log('ok: active off-topic tab stays, badge shown');

  await inTab((id) => chrome.tabs.update(id, { active: true }), (await tabByTitle(onRu)).id);
  s = await state();
  await until('moved on leave', async () => (await tabByTitle(distraction)).groupId === s.offGroupId);
  console.log('ok: moved after leaving');

  const related = 'Declarația fiscală online';
  await open(related);
  await until('related classified', async () => {
    const t = await tabByTitle(related);
    return t && (await state()).tabs[t.id];
  });
  await inTab((id) => chrome.tabs.update(id, { active: true }), (await tabByTitle(distraction)).id);
  const id = (await tabByTitle(distraction)).id;
  await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'mark', tabId, on: true }), id);
  await until('marked on', async () => (await tabByTitle(distraction)).groupId === (await state()).focusGroupId);
  assert.equal((await state()).positives.length, 2, 'learned example');
  s = await state();
  assert.equal((await tabByTitle(offB)).groupId, s.offGroupId, 'one mark must not pull in unrelated tabs');
  assert.equal((await tabByTitle(offA)).groupId, s.offGroupId, 'one mark must not pull in unrelated tabs');
  console.log('ok: "Это по теме" moves the tab and teaches');

  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'threshold', value: 0.05 }));
  s = await state();
  assert.equal(s.autoThreshold, false, 'slider turns the automatic threshold off');
  assert.equal(s.threshold, 0.05);
  console.log('ok: slider overrides the automatic threshold');

  if (SHOTS) {
    await popup.bringToFront();
    await popup.waitForTimeout(300);
    await popup.screenshot({ path: join(SHOTS, 'popup.png') });
  }

  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  await until('stopped', async () => !(await state()).active);
  assert.equal((await tabByTitle(onRu)).groupId, -1, 'focus group dissolved');
  assert.equal((await tabByTitle(offA)).groupId, -1, 'off group dissolved');
  assert.equal((await tabByTitle(own)).groupId, ownGroup, 'user group survives stop');
  console.log('ok: exit restores ungrouped tabs, user group kept');

  for (const title of ['Рецепт пиццы маргарита', 'Рецепт домашней пасты', 'Рецепт томатного соуса']) await open(title);
  await popup.bringToFront();
  await popup.click('#suggest');
  await popup.waitForSelector('#suggestions button', { timeout: 60000 });
  if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'suggestions.png') });
  const pizza = (await tabByTitle('Рецепт пиццы маргарита')).id;
  const { suggestions } = await inTab(() => chrome.storage.session.get('suggestions'));
  const index = suggestions.findIndex(({ tabIds }) => tabIds.includes(pizza));
  assert.notEqual(index, -1, 'cooking tabs form a suggestion');
  console.log('suggestions:', suggestions.map(({ label, tabIds }) => `${label} [${tabIds.length}]`).join(' / '));
  await popup.locator('#suggestions button').nth(index).click();
  await until('picked', async () => (await state())?.active);
  s = await state();
  assert.equal((await tabByTitle('Рецепт пиццы маргарита')).groupId, s.focusGroupId, 'member in focus');
  assert.equal((await tabByTitle(onRu)).groupId, s.offGroupId, 'unrelated tab goes off');
  assert.equal((await tabByTitle(own)).groupId, ownGroup, 'user group untouched by suggestions');
  const added = 'Рецепт лазаньи с мясом';
  await open(added);
  await until('new tab judged', async () => {
    const t = await tabByTitle(added);
    return t && (await state()).tabs[t.id];
  });
  assert.equal((await tabByTitle(added)).groupId, s.focusGroupId, 'new related tab joins the focus');
  console.log('ok: picking a suggestion focuses on the group and judges new tabs against it');
  console.log('worker errors:', errors.length ? errors : 'none');
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
