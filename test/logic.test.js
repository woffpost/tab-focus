import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoThreshold, centroid, cluster, hasReadableTitle, labelFor, isManaged, judge, placement } from '../src/logic.js';

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
