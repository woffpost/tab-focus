// Renders the Chrome Web Store images from the real extension on demo tabs: run it after a build.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const LOCALES = {
  en: {
    topic: 'AI agents, LLM',
    active: 'Pizza dough recipe',
    tabs: [
      'Building effective AI agents',
      'How LLM agents use tools',
      'AI agents memory patterns',
      'LLM agents and prompt caching',
      'Pizza dough recipe',
      'Cheap flights to Rome',
      'Weather in Chisinau',
      'Running shoes sale',
    ],
    captions: {
      session: ['Stay on one topic', 'Tabs on your topic gather into one group. The rest fold away, and none of them gets closed.'],
      start: ['Your tabs stay private', 'A language model runs right in your browser. Titles and addresses never leave your computer.'],
      suggestions: ['No topic in mind?', 'Tab Focus finds the topics among your open tabs, and one click starts a focus session.'],
    },
    tile: 'Stay on one topic',
    tileNote: 'Private: runs in your browser',
  },
  ru: {
    topic: 'AI-агенты, LLM',
    active: 'Рецепт теста для пиццы',
    tabs: [
      'AI-агенты: как их создавать',
      'AI-агенты и работа с инструментами',
      'AI-агенты: как устроена память',
      'AI-агенты на LLM: руководство',
      'Рецепт теста для пиццы',
      'Дешёвые билеты в Рим',
      'Погода в Кишинёве',
      'Распродажа кроссовок',
    ],
    captions: {
      session: ['Держись одной темы', 'Вкладки по теме собираются в одну группу. Остальные сворачиваются, и ни одна не закрывается.'],
      start: ['Вкладки остаются твоими', 'Языковая модель работает прямо в браузере. Заголовки и адреса не покидают компьютер.'],
      suggestions: ['Не знаешь, с чего начать?', 'Tab Focus найдёт темы среди открытых вкладок: один клик, и фокус включён.'],
    },
  },
};

const server = createServer((req, res) => {
  const title = decodeURIComponent(req.url.slice(1));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
}).listen(0);
const url = (title) => `http://localhost:${server.address().port}/${encodeURIComponent(title)}`;

// A copy with one locale only, since the browser's own language cannot be forced everywhere.
function distFor(locale) {
  const dir = mkdtempSync(join(tmpdir(), 'tab-focus-store-'));
  cpSync('dist', dir, { recursive: true });
  for (const other of Object.keys(LOCALES)) {
    if (other !== locale) rmSync(join(dir, '_locales', other), { recursive: true });
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, default_locale: locale }));
  return dir;
}

async function capturePopup(locale, { topic, tabs, active }) {
  const dist = distFor(locale);
  const profile = mkdtempSync(join(tmpdir(), 'tab-focus-store-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    colorScheme: 'light',
    viewport: { width: 340, height: 640 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${resolve(dist)}`, `--load-extension=${resolve(dist)}`],
  });
  const shots = {};
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const pages = [];
    for (const title of tabs) {
      const page = await context.newPage();
      await page.goto(url(title));
      pages.push(page);
    }
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const shoot = () => popup.locator('body').screenshot();

    await popup.fill('#topic', topic);
    shots.start = await shoot();

    await popup.click('#suggest');
    await popup.waitForSelector('#suggestions button', { timeout: 60000 });
    shots.suggestions = await shoot();

    await popup.evaluate((text) => chrome.runtime.sendMessage({ type: 'start', topic: text }), topic);
    const tab = await worker.evaluate(
      async (title) => (await chrome.tabs.query({})).find((other) => other.title === title),
      active,
    );
    await popup.evaluate((target) => {
      chrome.tabs.query = async () => [target];
      return chrome.storage.session.set({ rerender: Date.now() });
    }, tab);
    await popup.waitForSelector('#verdict:visible');
    shots.session = await shoot();
  } finally {
    await context.close();
    rmSync(dist, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }
  return shots;
}

const dataUrl = (png) => `data:image/png;base64,${png.toString('base64')}`;
const icon = readFileSync('public/icons/icon-128.png');
const BASE_STYLE = `*{margin:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:linear-gradient(135deg,#e8f0fe,#f6f8fc);color:#1c1c1e}`;

async function render(browser, html, width, height, path) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><style>${BASE_STYLE}</style>${html}`);
  await page.screenshot({ path });
  await page.close();
}

const screenshotHtml = ([title, text], popup) => `
  <div style="display:flex;align-items:center;gap:72px;width:1280px;height:800px;padding:0 96px">
    <div style="flex:1">
      <img src="${dataUrl(icon)}" width="96" height="96" style="margin:-16px">
      <h1 style="margin-top:48px;font-size:52px;line-height:1.15">${title}</h1>
      <p style="margin-top:24px;font-size:26px;line-height:1.45;color:#44474f">${text}</p>
    </div>
    <img src="${dataUrl(popup)}" style="flex:none;max-height:700px;max-width:440px;border-radius:16px;box-shadow:0 18px 60px rgba(26,50,110,.22)">
  </div>`;

const browser = await chromium.launch();
try {
  for (const [locale, content] of Object.entries(LOCALES)) {
    const shots = await capturePopup(locale, content);
    mkdirSync(`store/${locale}`, { recursive: true });
    for (const [index, name] of ['session', 'start', 'suggestions'].entries()) {
      const html = screenshotHtml(content.captions[name], shots[name]);
      await render(browser, html, 1280, 800, `store/${locale}/screenshot-${index + 1}.png`);
    }
  }
  // Promo tiles cannot be localized in the store.
  await render(
    browser,
    `<div style="display:flex;flex-direction:column;justify-content:center;width:440px;height:280px;padding:0 36px">
      <div style="display:flex;align-items:center;gap:6px;font-size:26px;font-weight:700">
        <img src="${dataUrl(icon)}" width="72" height="72" style="margin:-10px">Tab Focus
      </div>
      <h1 style="margin-top:22px;font-size:34px;line-height:1.15">${LOCALES.en.tile}</h1>
      <p style="margin-top:10px;font-size:18px;color:#44474f">${LOCALES.en.tileNote}</p>
    </div>`,
    440,
    280,
    'store/promo-small.png',
  );
} finally {
  await browser.close();
  server.close();
}
