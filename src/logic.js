export const MIN_THRESHOLD = 0.17;
export const THRESHOLD_SHARE = 0.5;
export const LEARNED_THRESHOLD = 0.6;
export const CLUSTER_LINKAGE = 0.4;
export const FOCUS_TITLE_PREFIX = '🎯 ';
export const OFF_TITLE = 'Не по теме';
export const NO_GROUP = -1;

export const cosine = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

const nearest = (vector, examples) =>
  examples.length ? Math.max(...examples.map((example) => cosine(vector, example))) : -Infinity;

// positives[0] is the topic. Examples the user marked are tabs, and any two pages score
// far higher against each other than against a short topic, so they only count for near matches.
export function judge(vector, { positives, negatives, threshold }) {
  const [topic, ...learned] = positives;
  const score = cosine(vector, topic);
  const like = nearest(vector, learned);
  const unlike = nearest(vector, negatives);
  const closeToMarked = like >= LEARNED_THRESHOLD && like >= unlike;
  const rejected = unlike >= LEARNED_THRESHOLD && unlike > score;
  return { score, on: closeToMarked || (score >= threshold && !rejected) };
}

// Scores for a useful topic vary too much for one fixed number, so the cut follows the best tab.
// A tab the user rejected says nothing about how high the topic can score.
export function autoThreshold(records) {
  const scores = records.filter(({ manual, on }) => !(manual && !on)).map(({ score }) => score);
  return Math.max(MIN_THRESHOLD, THRESHOLD_SHARE * Math.max(0, ...scores));
}

export const hasReadableTitle = ({ url = '', title = '' }) =>
  /^https?:\/\//.test(url) && title.trim() !== '' && title !== url;

// Pinned tabs and the user's own groups are never touched.
export const isManaged = (tab, { windowId, focusGroupId, offGroupId }) =>
  tab.windowId === windowId &&
  !tab.pinned &&
  [NO_GROUP, focusGroupId, offGroupId].includes(tab.groupId);

// 'stay' covers the active tab: an off-topic page is never pulled out from under the user.
export function placement(tab, { on }, { focusGroupId, offGroupId }) {
  if (on) return tab.groupId === focusGroupId ? 'stay' : 'focus';
  if (tab.active || tab.groupId === offGroupId) return 'stay';
  return 'off';
}

const average = (a, b, vectors) => {
  let sum = 0;
  for (const i of a) for (const j of b) sum += cosine(vectors[i], vectors[j]);
  return sum / (a.length * b.length);
};

// Average-linkage clustering. Returns groups of indexes, largest first, without lone items.
export function cluster(vectors, linkage = CLUSTER_LINKAGE) {
  const groups = vectors.map((_, i) => [i]);
  for (;;) {
    let best = { score: -Infinity };
    for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const score = average(groups[a], groups[b], vectors);
        if (score > best.score) best = { score, a, b };
      }
    }
    if (best.score < linkage) break;
    groups[best.a].push(...groups[best.b]);
    groups.splice(best.b, 1);
  }
  return groups.filter((group) => group.length > 1).sort((a, b) => b.length - a.length);
}

export function centroid(vectors) {
  const sum = vectors[0].map((_, i) => vectors.reduce((total, vector) => total + vector[i], 0));
  const length = Math.hypot(...sum);
  return sum.map((value) => value / length);
}

const STOP_WORDS = new Set(
  `the an to of for and with by in on your you how all from at is it this that as or are be can what
  everything know guide google search docs youtube blog medium
  что как для это или при из от до по на не поиск`.split(/\s+/),
);

const words = (title) =>
  title.split(/[^\p{L}\p{N}+#]+/u).filter((word) => word.length > 1 && !STOP_WORDS.has(word.toLowerCase()) && !/^\d+$/.test(word));

function phrases(title) {
  const list = words(title);
  return [...list, ...list.slice(1).map((word, i) => `${list[i]} ${word}`)];
}

// No model here can name a topic, so the label is whatever this group repeats and other tabs do not.
export function labelFor(group, allTitles) {
  const inTitles = (titles) => {
    const counts = new Map();
    for (const title of titles) {
      for (const key of new Set(phrases(title).map((phrase) => phrase.toLowerCase()))) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  };
  const here = inTitles(group);
  const everywhere = inTitles(allTitles);
  const spelling = new Map(group.flatMap(phrases).reverse().map((phrase) => [phrase.toLowerCase(), phrase]));

  const ranked = [...here]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, score: (count * count * key.split(' ').length) / everywhere.get(key) }))
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  for (const { key } of ranked) {
    if (chosen.length === 2) break;
    const overlaps = chosen.some((other) => other.split(' ').some((word) => key.split(' ').includes(word)));
    if (!overlaps) chosen.push(key);
  }
  return chosen.length ? chosen.map((key) => spelling.get(key)).join(', ') : group[0].slice(0, 40);
}
