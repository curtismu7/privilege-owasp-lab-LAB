import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, COMMAND_KEYS, buildPrereqs, labelFor, lookupCommand } from '../src/commands.js';

const EXPECTED = ['coverage-table', 'asi01', 'asi02', 'asi03', 'asi04', 'asi05', 'asi06', 'asi07', 'asi08', 'asi09', 'asi10', 'two-layers', 'live-evidence'];

test('the dataset allow-list is exactly the 13 coverage datasets, frozen and prototype-free', () => {
  assert.deepEqual([...COMMAND_KEYS].sort(), [...EXPECTED].sort());
  assert.equal(Object.getPrototypeOf(COMMANDS), null);
  assert.ok(Object.isFrozen(COMMANDS));
});

test('labels never carry a caller value; every dataset is runnable and read-only', () => {
  for (const k of EXPECTED) {
    const ds = COMMANDS[k];
    assert.equal(ds.runnable, true, k);
    assert.equal(typeof ds.title, 'string');
    assert.ok(!/path|query|uri/i.test(JSON.stringify(ds.args ?? {})), k);
  }
  assert.match(labelFor(COMMANDS['coverage-table']), /^privilege-owasp dataset /);
});

test('lookup: missing, unknown, hostile and non-string keys are 400; a hostile key is never echoed', () => {
  assert.deepEqual(lookupCommand(undefined), { status: 400, error: 'missing_dataset_key' });
  assert.deepEqual(lookupCommand(''), { status: 400, error: 'missing_dataset_key' });
  assert.deepEqual(lookupCommand('not_a_real_key'), { status: 400, error: 'unknown_dataset' });
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'x'.repeat(5000), 'asi01; rm -rf /', '$(id)', 'asi01‮', 'ASI01', ['asi01'], { a: 1 }, 42, true]) {
    const r = lookupCommand(bad);
    assert.equal(r.status, 400, String(bad).slice(0, 30));
    assert.ok(!r.ds);
    if (typeof bad !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(bad)) assert.equal(r.datasetKey, undefined, 'not echoed');
  }
});

test('prereqs name the deck, the labelling and (for auth datasets) the Real worker login', () => {
  const p = buildPrereqs(COMMANDS['coverage-table'], { source: 'mock' });
  assert.match(p[0].title, /deck/i);
  assert.ok(p.some((s) => /labell/i.test(s.title)));
  assert.ok(p.some((s) => /Authenticate/.test(s.title) && /Mock: simulated/.test(s.note)));
  for (const step of p) assert.match(step.note || '', /.+/);
});
