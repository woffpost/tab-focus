export const MIN_THRESHOLD = 0.17;
export const THRESHOLD_SHARE = 0.5;
export const LEARNED_THRESHOLD = 0.6;
export const CLUSTER_LINKAGE = 0.4;
export const FOCUS_TITLE_PREFIX = '🎯 ';
export const OFF_TITLE = 'Не по теме';
export const NO_GROUP = -1;

// The model returns unit vectors, so the dot product is the cosine.
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

// The latest answer about a tab replaces any earlier one, which would otherwise argue with it.
export function learn({ positives, negatives }, vector, on) {
  const isOther = (example) => example.some((value, i) => value !== vector[i]);
  const [topic, ...liked] = positives;
  const [keptLiked, keptDisliked] = [liked.filter(isOther), negatives.filter(isOther)];
  return on
    ? { positives: [topic, ...keptLiked, vector], negatives: keptDisliked }
    : { positives: [topic, ...keptLiked], negatives: [...keptDisliked, vector] };
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

export const isOwnGroupTitle = (title = '') => title === OFF_TITLE || title.startsWith(FOCUS_TITLE_PREFIX);

// 'stay' covers the active tab: an off-topic page is never pulled out from under the user.
export function placement(tab, { on }, { focusGroupId, offGroupId }) {
  if (on) return tab.groupId === focusGroupId ? 'stay' : 'focus';
  if (tab.active || tab.groupId === offGroupId) return 'stay';
  return 'off';
}

// Where to go when the user dismisses the current tab: the closest one that stays in sight.
export function neighbour(tab, tabs, { offGroupId }) {
  const distance = ({ index }) => Math.abs(index - tab.index);
  return tabs
    .filter(({ id, groupId }) => id !== tab.id && groupId !== offGroupId)
    .toSorted((a, b) => distance(a) - distance(b))[0];
}

// Average-linkage clustering. Returns groups of indexes, largest first, without lone items.
// A merged pair's similarities are the weighted mean of its parts (Lance–Williams),
// so vectors are compared only once, however many merges follow.
export function cluster(vectors, linkage = CLUSTER_LINKAGE) {
  const groups = vectors.map((_, i) => [i]);
  const similarity = vectors.map((a) => vectors.map((b) => cosine(a, b)));
  for (;;) {
    let best = { score: -Infinity };
    for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const score = similarity[a][b];
        if (score > best.score) best = { score, a, b };
      }
    }
    if (best.score < linkage) break;

    const { a, b } = best;
    const [sizeA, sizeB] = [groups[a].length, groups[b].length];
    for (let c = 0; c < groups.length; c += 1) {
      const merged = (sizeA * similarity[a][c] + sizeB * similarity[b][c]) / (sizeA + sizeB);
      similarity[a][c] = merged;
      similarity[c][a] = merged;
    }
    groups[a].push(...groups[b]);
    groups.splice(b, 1);
    similarity.splice(b, 1);
    for (const row of similarity) row.splice(b, 1);
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

const isMeaningful = (word) =>
  word.length > 1 && !STOP_WORDS.has(word.toLowerCase()) && !/^\d+$/.test(word);

const words = (title) => title.split(/[^\p{L}\p{N}+#]+/u).filter(isMeaningful);

function phrases(title) {
  const list = words(title);
  return [...list, ...list.slice(1).map((word, i) => `${list[i]} ${word}`)];
}

// How many titles contain each phrase, ignoring case.
function countPhrases(titles) {
  const counts = new Map();
  for (const title of titles) {
    for (const key of new Set(phrases(title).map((phrase) => phrase.toLowerCase()))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// No model here can name a topic, so the label is whatever this group repeats and other tabs do not.
export function labelFor(group, allTitles) {
  const everywhere = countPhrases(allTitles);
  // Reversed so that the first spelling in the group wins.
  const spelling = new Map(group.flatMap(phrases).reverse().map((phrase) => [phrase.toLowerCase(), phrase]));

  const ranked = [...countPhrases(group)]
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
