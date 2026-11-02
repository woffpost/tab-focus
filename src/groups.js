import { FOCUS_TITLE_PREFIX, OFF_TITLE, isOwnGroupTitle, placement } from './logic.js';

const RETRY_ATTEMPTS = 6;
const RETRY_DELAY_MS = 250;

// Chrome reports these only as message text.
const TAB_BUSY = /cannot be edited/i;
const TAB_GONE = /no tab/i;
const GROUP_GONE = /no group/i;

// Chrome refuses tab edits while the user is dragging a tab.
async function retry(action) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt === RETRY_ATTEMPTS || !TAB_BUSY.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

export const getTab = (tabId) => chrome.tabs.get(tabId).catch(() => null);

export const setBadge = (tabId, text) =>
  chrome.action.setBadgeText({ tabId, text }).catch((error) => {
    if (!TAB_GONE.test(error.message)) throw error;
  });

async function moveToGroup(state, tabIds, key, properties) {
  const groupId = state[key];
  if (groupId != null) {
    try {
      await retry(() => chrome.tabs.group({ tabIds, groupId }));
      return;
    } catch (error) {
      if (!GROUP_GONE.test(error.message)) throw error;
    }
  }
  state[key] = await retry(() =>
    chrome.tabs.group({ tabIds, createProperties: { windowId: state.windowId } }),
  );
  await retry(() => chrome.tabGroups.update(state[key], properties));
}

// A collapsed group would hide the tab the user is reading.
export async function collapseOff(state) {
  if (state.offGroupId == null) return;
  const [active] = await chrome.tabs.query({ active: true, windowId: state.windowId });
  if (active?.groupId === state.offGroupId) return;
  await retry(() => chrome.tabGroups.update(state.offGroupId, { collapsed: true })).catch((error) => {
    if (!GROUP_GONE.test(error.message)) throw error;
  });
}

// Moves tabs in batches, so a long list shifts once instead of tab by tab.
export async function placeTabs(state, tabs) {
  const targets = Map.groupBy(tabs, (tab) => placement(tab, state.tabs[tab.id], state));
  const idsFor = (target) => (targets.get(target) ?? []).map(({ id }) => id);
  const [focus, off] = [idsFor('focus'), idsFor('off')];

  try {
    if (focus.length) {
      await moveToGroup(state, focus, 'focusGroupId', {
        title: FOCUS_TITLE_PREFIX + state.topic,
        color: 'blue',
        collapsed: false,
      });
    }
    if (off.length) {
      await moveToGroup(state, off, 'offGroupId', { title: OFF_TITLE, color: 'grey', collapsed: true });
      await collapseOff(state);
    }
  } catch (error) {
    if (!TAB_GONE.test(error.message)) throw error;
    // One tab closed mid-way fails its whole batch, so go again without it.
    const open = new Set((await chrome.tabs.query({ windowId: state.windowId })).map(({ id }) => id));
    const remaining = tabs.filter(({ id }) => open.has(id));
    if (remaining.length === tabs.length) throw error;
    await placeTabs(state, remaining);
    return;
  }
  await Promise.all(tabs.map(({ id }) => setBadge(id, state.tabs[id].on ? '' : '!')));
}

// Session storage does not survive a browser restart or an extension update, but restored
// groups do, so leftovers are recognised by title. The ids cover a group the user renamed.
/** @param {{ focusGroupId?: number, offGroupId?: number }} [state] */
export async function dissolveGroups({ focusGroupId, offGroupId } = {}) {
  const groups = await chrome.tabGroups.query({});
  const leftovers = groups.filter(({ title }) => isOwnGroupTitle(title)).map(({ id }) => id);
  const known = [focusGroupId, offGroupId].filter((id) => id != null);
  for (const groupId of new Set([...known, ...leftovers])) {
    const tabs = await chrome.tabs.query({ groupId });
    const tabIds = /** @type {[number, ...number[]]} */ (tabs.map(({ id }) => id));
    if (tabIds.length) await retry(() => chrome.tabs.ungroup(tabIds));
  }
}
