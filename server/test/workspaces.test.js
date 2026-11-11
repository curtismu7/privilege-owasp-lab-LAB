import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RUNS, WORKSPACE_RE, createWorkspaces, workspaceFrom } from '../src/workspaces.js';

test('workspaceFrom defaults, accepts a good id and refuses a bad one', () => {
  assert.equal(workspaceFrom({ headers: {} }), 'default');
  assert.equal(workspaceFrom({ headers: { 'x-workspace': 'abc-1' } }), 'abc-1');
  for (const bad of ['', 'A', 'a b', 'a/b', 'x'.repeat(41), ['a']]) assert.equal(workspaceFrom({ headers: { 'x-workspace': bad } }), null);
  assert.ok(WORKSPACE_RE.test('a'));
});

test('workspaces are isolated, runs are bounded, reset is per workspace', () => {
  const w = createWorkspaces();
  for (let i = 0; i < MAX_RUNS + 5; i++) w.record('a', { scenario: 's', decision: 'denied' });
  w.record('b', { scenario: 's', decision: 'forward' });
  assert.equal(w.runs('a').runs.length, MAX_RUNS);
  w.resetWorkspace('a');
  assert.equal(w.runs('a').runs.length, 0);
  assert.equal(w.runs('b').runs.length, 1);
});

test('one run at a time per workspace; reset aborts the run in flight; abortAll stops every run', () => {
  const w = createWorkspaces();
  const a = w.begin('a');
  assert.ok(a);
  assert.equal(w.begin('a'), null, 'a second run is refused');
  const b = w.begin('b');
  assert.ok(b, 'another workspace is independent');
  w.end('a', a);
  const a2 = w.begin('a');
  assert.ok(a2);
  w.resetWorkspace('a');
  assert.equal(a2.signal.aborted, true);
  assert.ok(w.begin('a'), 'free after reset');
  w.abortAll();
  assert.equal(b.signal.aborted, true);
});

test('a workspace with a run in flight is not expired', () => {
  let t = 0;
  const w = createWorkspaces({ ttlMs: 100, now: () => t });
  const ctl = w.begin('busy');
  t = 500;
  w.state('other');
  assert.equal(w.begin('busy'), null, 'still busy, not evicted');
  w.end('busy', ctl);
});

test('the store expires old workspaces and caps their count', () => {
  let t = 0;
  const w = createWorkspaces({ max: 3, ttlMs: 100, now: () => t });
  for (const id of ['a', 'b', 'c', 'd']) w.record(id, { scenario: 's', decision: 'allow' });
  assert.equal(w.size(), 3);
  t = 500;
  assert.equal(w.runs('d').runs.length, 0);
  assert.equal(w.size(), 0);
});
