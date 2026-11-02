import { closeModel, embed } from './embedder.js';
import { t } from './i18n.js';
import { collapseOff, dissolveGroups, getTab, placeTabs, setBadge, syncOffTitle } from './groups.js';
import {
  LEARNED_THRESHOLD,
  MIN_THRESHOLD,
  NO_GROUP,
  autoThreshold,
  centroid,
  cluster,
  hasReadableTitle,
  isManaged,
  judge,
  labelFor,
  learn,
  neighbour,
} from './logic.js';

const EMPTY = { active: false };
const MAX_SUGGESTIONS = 5;
const MIN_SUGGESTION_SIZE = 3;
const BADGE_COLOR = '#c5481c';

/** @returns {Promise<any>} */
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

// Saves after a failure too: the state may already point at a group created on the way.
const withState = (change) =>
  enqueue(async () => {
    const state = await load();
    if (!state.active) return;
    try {
      await change(state);
      await syncOffTitle(state);
    } finally {
      await save(state);
    }
  });

async function forget(state, tabId) {
  if (!state.tabs[tabId]) return;
  delete state.tabs[tabId];
  await setBadge(tabId, '');
}

// The user may have pinned the tab or dragged it into their own group since it was judged.
async function settle(state, tabId) {
  const tab = await getTab(tabId);
  if (!tab || !state.tabs[tabId]) return;
  if (isManaged(tab, state)) await placeTabs(state, [tab]);
  else await forget(state, tabId);
}

async function measure(state, tab) {
  if (!isManaged(tab, state) || !hasReadableTitle(tab)) {
    await forget(state, tab.id);
    return;
  }
  const known = state.tabs[tab.id];
  const sameUrl = known?.url === tab.url;
  if (sameUrl && (known.manual || known.title === tab.title)) return;

  const vector = await embed(tab.title);
  state.tabs[tab.id] = { url: tab.url, title: tab.title, vector, leftAt: known?.leftAt, ...judge(vector, state) };
}

// Works on fresh tabs: the event may have waited in the queue, and embedding takes time,
// so by now the user could have switched to this tab or moved it.
async function classify(state, tabId) {
  const tab = await getTab(tabId);
  if (!tab) return;
  await measure(state, tab);
  await settle(state, tabId);
}

async function rejudgeAll(state) {
  const open = await chrome.tabs.query({ windowId: state.windowId });
  const tabsById = new Map(open.map((tab) => [tab.id, tab]));
  const tabs = [];
  for (const [id, record] of Object.entries(state.tabs)) {
    const tab = tabsById.get(Number(id));
    if (!tab || !isManaged(tab, state)) {
      delete state.tabs[id];
      continue;
    }
    if (!record.manual) Object.assign(record, judge(record.vector, state));
    tabs.push(tab);
  }
  await placeTabs(state, tabs);
}

async function suggest() {
  const [{ windowId }] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabs = await chrome.tabs.query({ windowId, pinned: false, groupId: NO_GROUP });
  const tabsByTitle = Map.groupBy(tabs.filter(hasReadableTitle), ({ title }) => title);
  const titles = [...tabsByTitle.keys()];

  await report({ text: t('statusReadingTabs') });
  try {
    const vectors = [];
    for (const title of titles) vectors.push(await embed(title));

    const groups = cluster(vectors).filter((group) => group.length >= MIN_SUGGESTION_SIZE);
    const suggestions = groups.slice(0, MAX_SUGGESTIONS).map((group) => ({
      label: labelFor(group.map((i) => titles[i]), titles),
      vector: centroid(group.map((i) => vectors[i])),
      tabIds: group.flatMap((i) => tabsByTitle.get(titles[i]).map(({ id }) => id)),
    }));
    await chrome.storage.session.set({ suggestions });
    await report(null);
  } finally {
    await closeModel();
  }
}

async function start({ topic, vector, tabIds = [] }) {
  const fromSuggestion = tabIds.length > 0;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await report({ text: t('statusLoadingModel') });
  vector ??= await embed(topic);
  const state = {
    active: true,
    topic,
    windowId: tab.windowId,
    lastActiveTabId: tab.id,
    threshold: MIN_THRESHOLD,
    autoThreshold: !fromSuggestion,
    positives: [vector],
    negatives: [],
    tabs: {},
  };
  await report({ text: t('statusSortingTabs') });
  for (const other of await chrome.tabs.query({ windowId: state.windowId })) {
    await measure(state, other);
  }
  // Tabs of a chosen suggestion belong to the topic by definition, whatever their score.
  for (const id of tabIds) {
    if (state.tabs[id]) Object.assign(state.tabs[id], { on: true, manual: true });
  }
  // A suggestion's vector is built from pages, and pages score high against each other.
  state.threshold = fromSuggestion ? LEARNED_THRESHOLD : autoThreshold(Object.values(state.tabs));
  await rejudgeAll(state);
  await syncOffTitle(state);
  await save(state);
  await chrome.storage.session.remove('suggestions');
  await report(null);
}

// Keeps the model loaded, since a new session usually follows at once.
async function endSession() {
  const state = await load();
  await dissolveGroups(state);
  await Promise.all(Object.keys(state.tabs ?? {}).map((id) => setBadge(Number(id), '')));
  await save(EMPTY);
  await report(null);
}

async function stop() {
  await endSession();
  await closeModel();
}

// A failed start may have grouped tabs already, and no saved state would point at them.
async function restart(options) {
  await endSession();
  try {
    await start(options);
  } catch (error) {
    await endSession().catch((cleanupError) => console.error('[tab-focus]', cleanupError));
    throw error;
  }
}

async function mark(state, tabId, on) {
  const record = state.tabs[tabId];
  const tab = await getTab(tabId);
  if (!record || !tab) return;
  if (!isManaged(tab, state)) {
    await forget(state, tabId);
    return;
  }

  Object.assign(record, { on, manual: true });
  Object.assign(state, learn(state, record.vector, on));

  if (!on && tab.active) {
    const next = neighbour(tab, await chrome.tabs.query({ windowId: state.windowId }), state);
    if (next) await chrome.tabs.update(next.id, { active: true });
  }
  if (state.autoThreshold) state.threshold = autoThreshold(Object.values(state.tabs));
  await rejudgeAll(state);
}

const handlers = {
  start: ({ topic }) => enqueue(() => restart({ topic })),
  suggest: () => enqueue(suggest),
  // A double click sends a second pick after the first has cleared the list.
  pick: ({ index }) =>
    enqueue(async () => {
      const { suggestions } = await chrome.storage.session.get('suggestions');
      const suggestion = suggestions?.[index];
      if (suggestion) await restart({ topic: suggestion.label, ...suggestion });
    }),
  stop: () => enqueue(stop),
  mark: ({ tabId, on }) => withState((state) => mark(state, tabId, on)),
  threshold: ({ value }) =>
    withState(async (state) => {
      state.threshold = value;
      state.autoThreshold = false;
      await rejudgeAll(state);
    }),
};

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  const handler = handlers[message.type];
  if (!handler) return undefined;
  handler(message).then(
    () => respond({ ok: true }),
    async (error) => {
      await report({ text: t('statusFailed', error.message), error: true });
      respond({ error: error.message });
    },
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.status !== 'complete' || !(change.status || change.title)) return;
  withState((state) => classify(state, tabId));
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  withState(async (state) => {
    if (windowId !== state.windowId) return;
    const previous = state.lastActiveTabId;
    state.lastActiveTabId = tabId;
    const left = state.tabs[previous];
    if (left) left.leftAt = Date.now();
    if (left?.on === false) await settle(state, previous);
    await collapseOff(state);
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

// Session storage is gone by now, so any group of ours has nothing managing it.
const dissolveLeftovers = () => enqueue(() => dissolveGroups());
chrome.runtime.onStartup.addListener(dissolveLeftovers);
chrome.runtime.onInstalled.addListener(dissolveLeftovers);

chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });

// Tasks die with the worker, so a progress status found at launch belongs to a dead task
// and would keep the popup's buttons disabled forever.
enqueue(async () => {
  const { status } = /** @type {any} */ (await chrome.storage.session.get('status'));
  if (status && !status.error) await report(null);
});
