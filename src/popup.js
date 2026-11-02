import { t } from './i18n.js';

/** @type {(id: string) => any} */
const $ = (id) => document.getElementById(id);

// Failures reach the user through the status in storage; this is only for a worker that died.
const send = (message) => chrome.runtime.sendMessage(message).catch(console.error);

function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

const markActive = async (on) => send({ type: 'mark', tabId: (await activeTab()).id, on });

const showThreshold = (value, auto = false) => {
  $('threshold-value').textContent = `${value.toFixed(2)}${auto ? ` · ${t('thresholdAuto')}` : ''}`;
};

function renderStatus(status) {
  $('status').hidden = !status;
  $('status').textContent = status?.text ?? '';
  $('status').classList.toggle('error', Boolean(status?.error));
}

function renderSuggestions(suggestions) {
  $('no-suggestions').hidden = suggestions?.length !== 0;
  $('suggestions').replaceChildren(
    ...(suggestions ?? []).map(({ label, tabIds }, index) => {
      const button = el(
        'button',
        { type: 'button', className: 'quiet', onclick: () => send({ type: 'pick', index }) },
        el('span', { textContent: label }),
        el('span', { className: 'count', textContent: tabIds.length }),
      );
      return el('li', {}, button);
    }),
  );
}

async function renderVerdict(state) {
  const tab = await activeTab();
  const record = state.tabs[tab.id];
  $('verdict').hidden = !record;
  if (!record) return;

  $('verdict').classList.toggle('on', record.on);
  $('verdict-text').textContent = record.on
    ? t('verdictOn', state.topic)
    : t('verdictOff', state.topic, t('offGroupTitle'));
  $('mark-on').hidden = record.on;
  $('mark-off').hidden = !record.on && tab.groupId === state.offGroupId;
}

function renderTabs(records) {
  const rows = records
    .toSorted((a, b) => b.score - a.score)
    .map(({ title, score, on }) =>
      el(
        'li',
        { className: on ? 'on' : '' },
        el('span', { className: 'score', textContent: score.toFixed(2) }),
        el('span', { className: 'title', textContent: title, title }),
      ),
    );
  $('tabs').replaceChildren(...rows);
}

async function render() {
  const keys = ['state', 'status', 'suggestions'];
  const { state, status, suggestions } = /** @type {any} */ (await chrome.storage.session.get(keys));
  const active = Boolean(state?.active);

  $('start').hidden = active;
  $('session').hidden = !active;
  renderStatus(status);
  renderSuggestions(suggestions);
  for (const button of $('start').querySelectorAll('button')) {
    button.disabled = Boolean(status && !status.error);
  }
  if (!active) return;

  $('current-topic').textContent = state.topic;
  $('threshold').value = state.threshold;
  showThreshold(state.threshold, state.autoThreshold);
  renderTabs(Object.values(state.tabs));
  await renderVerdict(state);
}

function translatePage() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.getAttribute('data-i18n'));
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  }
}

$('start').addEventListener('submit', (event) => {
  event.preventDefault();
  const topic = $('topic').value.trim();
  if (topic) send({ type: 'start', topic });
});
$('suggest').addEventListener('click', () => send({ type: 'suggest' }));
$('stop').addEventListener('click', () => send({ type: 'stop' }));
$('mark-on').addEventListener('click', () => markActive(true));
$('mark-off').addEventListener('click', () => markActive(false));
$('threshold').addEventListener('input', () => showThreshold(Number($('threshold').value)));
$('threshold').addEventListener('change', () => {
  send({ type: 'threshold', value: Number($('threshold').value) });
});

translatePage();
chrome.storage.session.onChanged.addListener(render);
render();
