import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autoThreshold,
  centroid,
  cluster,
  cosine,
  hasReadableTitle,
  isManaged,
  isOwnGroupTitle,
  judge,
  labelFor,
  learn,
  neighbour,
  placement,
  tabLists,
} from '../src/logic.js';

const session = { windowId: 1, focusGroupId: 10, offGroupId: 20 };
const tab = (overrides) => ({ windowId: 1, pinned: false, groupId: -1, active: false, ...overrides });

test('judge compares a tab with the topic', () => {
  const examples = { positives: [[1, 0]], negatives: [], threshold: 0.5 };
  assert.equal(judge([1, 0], examples).on, true);
  assert.equal(judge([0, 1], examples).on, false);
});

test('a marked example pulls in near matches only', () => {
  const examples = { positives: [[1, 0], [0, 1]], negatives: [], threshold: 0.5 };
  assert.equal(judge([0, 1], examples).on, true);
  assert.equal(judge([-0.8, 0.45], examples).on, false);
});

test('a rejected example overrules a passing score only when it is a near match', () => {
  const examples = { positives: [[0.6, 0.8]], threshold: 0.5 };
  assert.equal(judge([1, 0], { ...examples, negatives: [[1, 0]] }).on, false);
  assert.equal(judge([0.6, 0.8], { ...examples, negatives: [[1, 0]] }).on, true);
});

test('the automatic threshold is half of the best score, with a floor', () => {
  assert.equal(autoThreshold([{ score: 0.8 }, { score: 0.3 }]), 0.4);
  assert.equal(autoThreshold([{ score: 0.2 }]), 0.17);
  assert.equal(autoThreshold([]), 0.17);
});

test('a rejected tab does not raise the automatic threshold', () => {
  const rejected = { score: 0.9, manual: true, on: false };
  assert.equal(autoThreshold([rejected, { score: 0.6 }]), 0.3);
  assert.equal(autoThreshold([{ score: 0.9, manual: true, on: true }]), 0.45);
});

test('pinned tabs, other windows and the user groups stay out of focus', () => {
  assert.equal(isManaged(tab(), session), true);
  assert.equal(isManaged(tab({ groupId: 10 }), session), true);
  assert.equal(isManaged(tab({ groupId: 99 }), session), false);
  assert.equal(isManaged(tab({ pinned: true }), session), false);
  assert.equal(isManaged(tab({ windowId: 2 }), session), false);
});

test('an off-topic tab moves only after the user leaves it', () => {
  assert.equal(placement(tab({ active: true }), { on: false }, session), 'stay');
  assert.equal(placement(tab(), { on: false }, session), 'off');
  assert.equal(placement(tab({ groupId: 20 }), { on: false }, session), 'stay');
});

test('an on-topic tab joins the focus group even while active', () => {
  assert.equal(placement(tab({ active: true }), { on: true }, session), 'focus');
  assert.equal(placement(tab({ groupId: 10 }), { on: true }, session), 'stay');
});

test('browser pages and tabs still loading have nothing to classify', () => {
  assert.equal(hasReadableTitle({ url: 'chrome://newtab/', title: 'New Tab' }), false);
  assert.equal(hasReadableTitle({ url: 'https://a.md/', title: 'https://a.md/' }), false);
  assert.equal(hasReadableTitle({ url: 'https://a.md/', title: 'Fisc' }), true);
});

test('cluster groups close vectors and drops lone ones', () => {
  const vectors = [[1, 0], [0.9, 0.1], [0, 1], [0.1, 0.9], [-1, 0]];
  const groups = cluster(vectors, 0.7).map((group) => [...group].sort());
  assert.deepEqual(groups, [[0, 1], [2, 3]]);
});

test('centroid is a unit vector between its members', () => {
  const [x, y] = centroid([[1, 0], [0, 1]]);
  assert.ok(Math.abs(x - y) < 1e-9);
  assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-9);
});

test('label prefers what repeats in the group and is rare elsewhere', () => {
  const group = ['Chatbot | AI SDK', 'useChat | AI SDK', 'Agents guide | IBM'];
  const other = ['Front End Interview', 'Coding Interview'];
  assert.equal(labelFor(group, [...group, ...other]), 'AI SDK');
});

test('label falls back to a title when nothing repeats', () => {
  assert.equal(labelFor(['Netflix', 'Disney Plus'], ['Netflix', 'Disney Plus']), 'Netflix');
});

test('cluster gives the same groups as averaging every pair from scratch', () => {
  const naive = (vectors, linkage) => {
    const groups = vectors.map((_, i) => [i]);
    const average = (a, b) => {
      let sum = 0;
      for (const i of a) for (const j of b) sum += cosine(vectors[i], vectors[j]);
      return sum / (a.length * b.length);
    };
    for (;;) {
      let best = { score: -Infinity };
      for (let a = 0; a < groups.length; a += 1) {
        for (let b = a + 1; b < groups.length; b += 1) {
          const score = average(groups[a], groups[b]);
          if (score > best.score) best = { score, a, b };
        }
      }
      if (best.score < linkage) break;
      groups[best.a].push(...groups[best.b]);
      groups.splice(best.b, 1);
    }
    return groups.filter((group) => group.length > 1).sort((a, b) => b.length - a.length);
  };
  // Seeded, so that a failure can be reproduced.
  let seed = 42;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const unit = () => {
    const vector = Array.from({ length: 8 }, random);
    const length = Math.hypot(...vector);
    return vector.map((value) => value / length);
  };
  const vectors = Array.from({ length: 60 }, unit);
  const canonical = (groups) => groups.map((group) => [...group].sort((a, b) => a - b));
  for (const linkage of [0.2, 0.4, 0.6]) {
    assert.deepEqual(canonical(cluster(vectors, linkage)), canonical(naive(vectors, linkage)));
  }
});

test('the latest answer about a tab replaces the earlier one', () => {
  const topic = [1, 0];
  const page = [0, 1];
  const other = [0.6, 0.8];
  const liked = learn({ positives: [topic, other], negatives: [page] }, page, true);
  assert.deepEqual(liked, { positives: [topic, other, page], negatives: [] });
  const disliked = learn(liked, page, false);
  assert.deepEqual(disliked, { positives: [topic, other], negatives: [page] });
});

test('the topic itself is never dropped from the examples', () => {
  const topic = [1, 0];
  assert.deepEqual(learn({ positives: [topic], negatives: [] }, [1, 0], false).positives, [topic]);
});

test('a dismissed tab hands over to the closest tab outside the off group', () => {
  const tabs = [
    { id: 1, index: 0, groupId: -1 },
    { id: 2, index: 1, groupId: 20 },
    { id: 3, index: 2, groupId: -1 },
    { id: 4, index: 3, groupId: 10 },
  ];
  assert.equal(neighbour(tabs[2], tabs, session).id, 4);
  assert.equal(neighbour({ id: 1, index: 0 }, [tabs[0], tabs[1]], session), undefined);
});

test('leftover groups are recognised by title, the user groups are not', () => {
  assert.equal(isOwnGroupTitle('💤 Не по теме'), true);
  assert.equal(isOwnGroupTitle('💤 Off topic · 3'), true);
  assert.equal(isOwnGroupTitle('Не по теме'), false);
  assert.equal(isOwnGroupTitle('🎯 налоги Молдовы'), true);
  assert.equal(isOwnGroupTitle('Работа'), false);
  assert.equal(isOwnGroupTitle(undefined), false);
});

test('lists keep on-topic tabs by score and recently left off-topic tabs first', () => {
  const tabs = [
    { id: 1, on: true, score: 0.5 },
    { id: 2, on: true, score: 0.9 },
    { id: 3, on: false, score: 0.1 },
    { id: 4, on: false, score: 0.3 },
    { id: 5, on: false, score: 0.01, leftAt: 100 },
    { id: 6, on: false, score: 0.02, leftAt: 200 },
  ];
  const { on, off } = tabLists(tabs);
  assert.deepEqual(on.map(({ id }) => id), [2, 1]);
  assert.deepEqual(off.map(({ id }) => id), [6, 5, 4, 3]);
});
