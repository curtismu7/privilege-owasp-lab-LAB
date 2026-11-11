import test from 'node:test';
import assert from 'node:assert/strict';
import { allPassed, runChecks } from '../src/doctor.js';
import { DEFAULT_CAST } from '../src/cast.js';

test('every doctor check passes on a clean default environment', async () => {
  const checks = await runChecks({ env: {} });
  assert.ok(allPassed(checks), JSON.stringify(checks.filter((c) => c.level === 'fail')));
  for (const id of ['node', 'mode', 'real', 'bind', 'port-range', 'commands', 'mock-output', 'scenarios', 'facts-labelled', 'story-tokens', 'verticals', 'diagrams', 'story-hosts', 'story-keys', 'netguard', 'tenant']) {
    assert.ok(checks.some((c) => c.id === id), id);
  }
});

test('a port other than 7811 fails, and a wildcard bind needs the opt-in', async () => {
  assert.equal((await runChecks({ env: { PORT: '7805' } })).find((c) => c.id === 'port-range').level, 'fail');
  assert.equal((await runChecks({ env: { PORT: '7811', POWASP_BIND: '0.0.0.0' } })).find((c) => c.id === 'bind').level, 'pass');
});

test('MODE other than mock/real fails the doctor, Real without settings is refused, and no value is ever shown', async () => {
  const { realEnv, FAKE } = await import('./helpers.js');
  assert.equal((await runChecks({ env: { MODE: 'live' } })).find((c) => c.id === 'mode').level, 'fail');
  assert.equal((await runChecks({ env: { MODE: 'real' } })).find((c) => c.id === 'mode').level, 'fail');
  const checks = await runChecks({ env: realEnv('echo') });
  const real = checks.find((c) => c.id === 'mode');
  assert.equal(real.level, 'pass');
  assert.match(real.detail, /mode=real.*Real configured/);
  const all = JSON.stringify(checks);
  for (const k of ['PINGONE_CLIENT_SECRET', 'PINGONE_CLIENT_ID', 'PINGONE_ENVIRONMENT_ID']) assert.ok(!all.includes(FAKE[k]), k);
});

test('a scenario that stops showing what it claims is caught by the doctor', async () => {
  const { checkScenario } = await import('../src/doctor.js');
  assert.deepEqual(checkScenario({ commandKey: 'asi03', expect: { view: 'table' } }), ['expected a table']);
  assert.deepEqual(checkScenario({ commandKey: 'coverage-table', expect: { view: 'table', minRows: 50 } }), ['fewer than 50 rows']);
  assert.deepEqual(checkScenario({ commandKey: 'nope' }), ['unknown dataset nope']);
  assert.deepEqual(checkScenario({ commandKey: 'coverage-table', expect: { view: 'table', minRows: 10 } }), []);
  assert.deepEqual(checkScenario({ commandKey: 'asi03', expect: { view: 'form' } }), []);
});

test('the doctor host scan catches a real host in the story', async () => {
  const bad = { ...DEFAULT_CAST, castOrg: 'Acme https://acme-airlines.com/x' };
  const hosts = (await runChecks({ env: {}, cast: bad })).find((c) => c.id === 'story-hosts');
  assert.equal(hosts.level, 'fail');
  assert.match(hosts.detail, /acme-airlines\.com/);
  assert.equal((await runChecks({ env: {} })).find((c) => c.id === 'story-hosts').level, 'pass');
});
