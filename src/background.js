import {
  LEARNED_THRESHOLD,
  MIN_THRESHOLD,
  FOCUS_TITLE_PREFIX,
  NO_GROUP,
  autoThreshold,
  centroid,
  cluster,
  labelFor,
  OFF_TITLE,
  hasReadableTitle,
  isManaged,
  judge,
  placement,
} from './logic.js';

const EMPTY = { active: false };
const MAX_SUGGESTIONS = 5;
const MIN_SUGGESTION_SIZE = 3;

const load = async () => (await chrome.storage.session.get('state')).state ?? EMPTY;
const save = (state) => chrome.storage.session.set({ state });
const report = (status) => chrome.storage.session.set({ status });

// Every handler runs one at a time: they all read, change and save the same state,
// and the service worker can be restarted between any two of them.
let queue = Promise.resolve();
const enqueue = (task) => {
  const run = queue.then(task);
  queue = run.catch((error) => console.error('[tab-focus]', error));
  return run;
};

const withState = (change) =>
  enqueue(async () => {
    const state = await load();
    if (!state.active) return;
    await change(state);
    await save(state);
  });

// Chrome refuses tab edits while the user is dragging a tab.
async function retry(action, attempts = 6) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt === attempts || !/cannot be edited/i.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function embed(text) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Runs the local embedding model that compares tab titles with the topic.',
    });
  }
  const { vector, error } = await chrome.runtime.sendMessage({ type: 'embed', text });
  if (error) throw new Error(error);
  return vector;
}

async function moveToGroup(state, tabId, key, properties) {
  const groupId = state[key];
  if (groupId != null) {
    try {
      await retry(() => chrome.tabs.group({ tabIds: tabId, groupId }));
      return;
    } catch (error) {
      if (!/no group/i.test(error.message)) throw error;
    }
  }
  state[key] = await retry(() =>
    chrome.tabs.group({ tabIds: tabId, createProperties: { windowId: state.windowId } }),
  );
  await retry(() => chrome.tabGroups.update(state[key], properties));
}

const moveToFocus = (state, tabId) =>
  moveToGroup(state, tabId, 'focusGroupId', {
    title: FOCUS_TITLE_PREFIX + state.topic,
    color: 'blue',
    collapsed: false,
  });

async function collapseOff(state) {
  if (state.offGroupId == null) return;
  await retry(() => chrome.tabGroups.update(state.offGroupId, { collapsed: true })).catch(() => {});
}

async function moveToOff(state, tabId) {
  await moveToGroup(state, tabId, 'offGroupId', { title: OFF_TITLE, color: 'grey', collapsed: true });
  await collapseOff(state);
}

async function place(state, tab) {
  const record = state.tabs[tab.id];
  const target = placement(tab, record, state);
  if (target === 'focus') await moveToFocus(state, tab.id);
  if (target === 'off') await moveToOff(state, tab.id);
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#c5481c' });
  await chrome.action.setBadgeText({ tabId: tab.id, text: record.on ? '' : '!' });
}

// Returns true when the tab got a new record that still has to be placed.
async function measure(state, tab) {
  if (!isManaged(tab, state)) {
    delete state.tabs[tab.id];
    return false;
  }
  if (!hasReadableTitle(tab)) return false;

  const known = state.tabs[tab.id];
  const sameUrl = known?.url === tab.url;
  if (sameUrl && (known.manual || known.title === tab.title)) return false;

  const vector = await embed(tab.title);
  state.tabs[tab.id] = { url: tab.url, title: tab.title, vector, ...judge(vector, state) };
  return true;
}

async function classify(state, tab) {
  if (await measure(state, tab)) await place(state, tab);
}

async function rejudgeAll(state) {
  for (const [id, record] of Object.entries(state.tabs)) {
    if (record.manual) continue;
    const tab = await chrome.tabs.get(Number(id)).catch(() => null);
    if (!tab || !isManaged(tab, state)) {
      delete state.tabs[id];
      continue;
    }
    Object.assign(record, judge(record.vector, state));
    await place(state, tab);
  }
}

async function closeModel() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

async function suggest() {
  const [{ windowId }] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabs = (await chrome.tabs.query({ windowId, pinned: false, groupId: NO_GROUP })).filter(hasReadableTitle);
  const idsByTitle = Map.groupBy(tabs, ({ title }) => title);
  const titles = [...idsByTitle.keys()];

  await report({ text: 'Смотрю на вкладки…' });
  const vectors = [];
  for (const title of titles) vectors.push(await embed(title));

  const groups = cluster(vectors).filter((group) => group.length >= MIN_SUGGESTION_SIZE);
  const suggestions = groups.slice(0, MAX_SUGGESTIONS).map((group) => ({
    label: labelFor(group.map((i) => titles[i]), titles),
    vector: centroid(group.map((i) => vectors[i])),
    tabIds: group.flatMap((i) => idsByTitle.get(titles[i]).map(({ id }) => id)),
  }));
  await chrome.storage.session.set({ suggestions });
  await closeModel();
  await report(null);
}

async function start({ topic, vector, tabIds = [] }) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await report({ text: 'Загружаю модель…' });
  vector ??= await embed(topic);
  const state = {
    active: true,
    topic,
    windowId: tab.windowId,
    lastActiveTabId: tab.id,
    threshold: MIN_THRESHOLD,
    autoThreshold: tabIds.length === 0,
    positives: [vector],
    negatives: [],
    tabs: {},
  };
  await report({ text: 'Разбираю вкладки…' });
  for (const other of await chrome.tabs.query({ windowId: state.windowId })) {
    await measure(state, other);
  }
  // Tabs of a chosen suggestion belong to the topic by definition, whatever their score.
  for (const id of tabIds) {
    if (state.tabs[id]) Object.assign(state.tabs[id], { on: true, manual: true });
  }
  // A suggestion's vector is built from pages, and pages score high against each other.
  state.threshold = state.autoThreshold ? autoThreshold(Object.values(state.tabs)) : LEARNED_THRESHOLD;
  await rejudgeAll(state);
  for (const id of tabIds) {
    const member = await chrome.tabs.get(id).catch(() => null);
    if (member && state.tabs[id]) await place(state, member);
  }
  await save(state);
  await chrome.storage.session.remove('suggestions');
  await report(null);
}

async function stop() {
  const state = await load();
  const groupIds = [state.focusGroupId, state.offGroupId].filter((id) => id != null);
  for (const groupId of groupIds) {
    const tabs = await chrome.tabs.query({ groupId });
    if (tabs.length) await retry(() => chrome.tabs.ungroup(tabs.map(({ id }) => id)));
  }
  for (const id of Object.keys(state.tabs ?? {})) {
    await chrome.action.setBadgeText({ tabId: Number(id), text: '' }).catch(() => {});
  }
  await save(EMPTY);
  await report(null);
  await closeModel();
}

async function mark(state, tabId, on) {
  const record = state.tabs[tabId];
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!record || !tab) return;

  Object.assign(record, { on, manual: true });
  (on ? state.positives : state.negatives).push(record.vector);
  await place(state, tab);

  if (!on && tab.active) {
    const others = await chrome.tabs.query({ windowId: state.windowId, hidden: false });
    const next = others.find(({ id, groupId }) => id !== tabId && groupId !== state.offGroupId);
    if (next) await chrome.tabs.update(next.id, { active: true });
  }
  if (state.autoThreshold) state.threshold = autoThreshold(Object.values(state.tabs));
  await rejudgeAll(state);
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const tasks = {
    start: () =>
      enqueue(async () => {
        await stop();
        await start({ topic: message.topic });
      }),
    suggest: () => enqueue(suggest),
    pick: () =>
      enqueue(async () => {
        const { suggestions } = await chrome.storage.session.get('suggestions');
        const { label, vector, tabIds } = suggestions[message.index];
        await stop();
        await start({ topic: label, vector, tabIds });
      }),
    stop: () => enqueue(stop),
    mark: () => withState((state) => mark(state, message.tabId, message.on)),
    threshold: () =>
      withState(async (state) => {
        state.threshold = message.value;
        state.autoThreshold = false;
        await rejudgeAll(state);
      }),
  };
  if (message.type === 'model-progress') {
    report({ text: `Загружаю модель: ${message.progress}%` });
    return;
  }
  const task = tasks[message.type];
  if (!task) return;
  task().then(
    () => respond({ ok: true }),
    async (error) => {
      await report({ text: `Не получилось: ${error.message}`, error: true });
      respond({ error: error.message });
    },
  );
  return true;
});

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (tab.status !== 'complete' || !(change.status || change.title)) return;
  withState((state) => classify(state, tab));
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  withState(async (state) => {
    if (windowId !== state.windowId) return;
    const previous = state.lastActiveTabId;
    state.lastActiveTabId = tabId;

    const left = previous != null && state.tabs[previous];
    const tab = left && !left.on ? await chrome.tabs.get(previous).catch(() => null) : null;
    if (tab) await place(state, tab);

    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (current && current.groupId !== state.offGroupId) await collapseOff(state);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  withState((state) => {
    delete state.tabs[tabId];
    if (state.lastActiveTabId === tabId) state.lastActiveTabId = null;
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  enqueue(async () => {
    if ((await load()).windowId === windowId) await stop();
  });
});

