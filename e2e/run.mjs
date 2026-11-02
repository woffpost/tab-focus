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

  const statusNow = async () => (await inTab(() => chrome.storage.session.get('status'))).status;
  const badge = (tabId) => inTab((i) => chrome.action.getBadgeText({ tabId: i }), tabId);
  const judged = (title) =>
    until(`${title} judged`, async () => {
      const t = await tabByTitle(title);
      return t && (await state()).tabs[t.id];
    });
  const focusOn = async (title) => inTab((i) => chrome.tabs.update(i, { active: true }), (await tabByTitle(title)).id);

  const reloaded = 'Prognoza meteo Paris';
  const reloadedPage = await open(reloaded);
  await judged(reloaded);
  await reloadedPage.reload();
  await until('badge back after reload', async () => (await badge((await tabByTitle(reloaded)).id)) === '!');
  console.log('ok: a reload keeps the badge');

  // Opened as a page, the popup sees itself as the active tab, so it is pointed at the real one.
  await popup.evaluate((tab) => {
    chrome.tabs.query = async () => [tab];
    return chrome.storage.session.set({ rerender: Date.now() });
  }, await tabByTitle(reloaded));
  await popup.waitForSelector('#mark-off:visible');
  await popup.click('#mark-off');
  await until('dismissed', async () => (await tabByTitle(reloaded)).groupId === (await state()).offGroupId);
  assert.equal(await statusNow(), null, '"Убрать" works on the tab being read');
  const dismissed = await tabByTitle(reloaded);
  assert.equal(dismissed.active, false, 'the user is taken to another tab');
  assert.equal(dismissed.groupId, (await state()).offGroupId, 'dismissed tab goes off');
  console.log('ok: "Убрать" on the active tab');

  await focusOn(offA);
  const background = 'Bilete de avion ieftine';
  await inTab((u) => chrome.tabs.create({ url: u, active: false }), url(background));
  await judged(background);
  await until('background tab placed', async () => (await tabByTitle(background)).groupId === s.offGroupId);
  assert.equal((await inTab((g) => chrome.tabGroups.get(g), s.offGroupId)).collapsed, false, 'tab being read stays visible');
  await focusOn(onRu);
  await until('off group collapsed on leave', async () => (await inTab((g) => chrome.tabGroups.get(g), s.offGroupId)).collapsed);
  console.log('ok: the off group does not collapse over the tab being read');

  const moved = 'Pantofi sport de alergare';
  await open(moved);
  await judged(moved);
  const movedId = (await tabByTitle(moved)).id;
  await inTab(([tabIds, groupId]) => chrome.tabs.group({ tabIds, groupId }), [movedId, ownGroup]);
  const pinnedLater = 'Concert tickets Vienna';
  await open(pinnedLater);
  await judged(pinnedLater);
  const pinnedLaterId = (await tabByTitle(pinnedLater)).id;
  await inTab((i) => chrome.tabs.update(i, { pinned: true }), pinnedLaterId);
  await focusOn(onRu);
  await until('moved tabs forgotten', async () => !(await state()).tabs[pinnedLaterId]);
  assert.equal((await tabByTitle(pinnedLater)).pinned, true, 'pinned tab stays pinned');
  assert.equal((await tabByTitle(moved)).groupId, ownGroup, 'a tab the user took into a group stays there');
  console.log('ok: tabs the user pinned or took into a group are left alone');

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
  const leftover = 'Lista de cumparaturi';
  await open(leftover);
  await inTab(async (tabId) => {
    const groupId = await chrome.tabs.group({ tabIds: tabId });
    await chrome.tabGroups.update(groupId, { title: 'Не по теме' });
  }, (await tabByTitle(leftover)).id);

  await popup.bringToFront();
  await popup.click('#suggest');
  await popup.waitForSelector('#suggestions button', { timeout: 60000 });
  if (SHOTS) await popup.screenshot({ path: join(SHOTS, 'suggestions.png') });
  const pizza = (await tabByTitle('Рецепт пиццы маргарита')).id;
  const { suggestions } = await inTab(() => chrome.storage.session.get('suggestions'));
  const index = suggestions.findIndex(({ tabIds }) => tabIds.includes(pizza));
  assert.notEqual(index, -1, 'cooking tabs form a suggestion');
  console.log('suggestions:', suggestions.map(({ label, tabIds }) => `${label} [${tabIds.length}]`).join(' / '));
  await popup.locator('#suggestions button').nth(index).evaluate((button) => {
    button.click();
    button.click();
  });
  await until('picked', async () => (await state())?.active);
  // Handlers run in order, so this answers only after the second click has been handled.
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'pick', index: -1 }));
  assert.equal(await statusNow(), null, 'a double click on a suggestion leaves no error');
  s = await state();
  const leftoverGroup = (await tabByTitle(leftover)).groupId;
  assert.ok([s.focusGroupId, s.offGroupId, -1].includes(leftoverGroup), 'a leftover group is dissolved');
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
  assert.deepEqual(errors, [], 'no errors in the service worker');
  console.log('ok: no errors in the service worker');
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
