import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRunHops, formatTraceparent, newTrace, parseTraceparent } from '../src/trace.js';
import { readSse, withServer } from './helpers.js';

const GOOD = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

test('parseTraceparent accepts the W3C shape and refuses everything else', () => {
  assert.deepEqual(parseTraceparent(GOOD), { traceId: '0af7651916cd43dd8448eb211c80319c', parentId: 'b7ad6b7169203331', flags: '01' });
  for (const bad of [undefined, '', 'x', GOOD.toUpperCase(), `00-${'0'.repeat(32)}-b7ad6b7169203331-01`, `00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`, `${GOOD}-extra`, 5, `00-${'a'.repeat(32)}-${'b'.repeat(16)}-ff`]) assert.equal(parseTraceparent(bad), null);
});

test('run hops: one trace id, a distinct valid span per hop; Mock hops are labelled MOCK, Real pingcli hops are not observed', () => {
  const trace = newTrace(GOOD);
  assert.equal(trace.traceId, '0af7651916cd43dd8448eb211c80319c');
  const base = { trace, commandKey: 'coverage-table', label: 'pingcli pingone api environments/e/users -O json', argv: ['pingcli', '--config', '<private>/config.yaml', 'pingone', 'api', 'e', '-O', 'json'], exitCode: 0, bytes: 10, envId: 'e', uri: 'environments/e/users', authFresh: true };
  const mock = buildRunHops({ ...base, source: 'mock', authHost: 'auth.pingone.example', apiHost: 'api.pingone.example' });
  assert.deepEqual(mock.map((h) => h.to), ['lab', 'pingcli', 'pingone-auth', 'pingone-api']);
  assert.match(mock[1].label, /MOCK/);
  assert.ok(mock.every((h) => h.observed === true && h.mock === true));
  assert.deepEqual(mock.map((h) => h.n), [1, 2, 3, 4]);
  const real = buildRunHops({ ...base, source: 'real', authHost: 'auth.x.example', apiHost: 'api.x.example', authFresh: false, transport: 'run' });
  assert.deepEqual(real.map((h) => h.to), ['lab', 'pingcli', 'pingone-api']);
  assert.equal(real[2].observed, false);
  assert.equal(real[0].request.method, 'POST');
  assert.equal(real[0].request.url, '/api/run');
  assert.match(real[1].request.headers.env, /no PINGONE_\* variables/);
  for (const set of [mock, real]) {
    assert.equal(new Set(set.map((h) => h.traceparent)).size, set.length);
    for (const h of set) { assert.ok(parseTraceparent(h.traceparent)); assert.ok(h.traceparent.includes(trace.traceId)); }
  }
  assert.equal(buildRunHops({ ...base, source: 'mock', uri: null }).length, 2, 'no PingOne hop for local commands');
  assert.equal(formatTraceparent('a'.repeat(32), 'b'.repeat(16)), `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
});

test('GET /api/stream returns a traceparent header and continues a valid incoming trace only', async () => {
  await withServer(async (url) => {
    const get = async (headers = {}) => { const r = await fetch(`${url}/api/stream?commandKey=two-layers`, { headers }); const ev = await readSse(r); return { r, done: ev.at(-1).data }; };
    let { r, done } = await get();
    assert.ok(parseTraceparent(r.headers.get('traceparent')));
    assert.match(done.traceId, /^[0-9a-f]{32}$/);
    ({ done } = await get({ traceparent: GOOD }));
    assert.equal(done.traceId, '0af7651916cd43dd8448eb211c80319c');
    ({ done } = await get({ traceparent: 'garbage' }));
    assert.notEqual(done.traceId, '0af7651916cd43dd8448eb211c80319c');
  });
});

test('enriched hops are valid demo-hop/1 for every command in Mock and Real; secrets write-only, Real tokens redacted', async () => {
  const { enrichRunHops, hopProblems, LAB_KINDS, CATALOG } = await import('../src/hopCatalog.js');
  const { validateHop } = await import('../src/vendor/hopDetail.mjs');
  const trace = newTrace();
  for (const source of ['mock', 'real']) {
    const raw = buildRunHops({ trace, source, commandKey: 'coverage-table', label: 'dataset x', argv: ['pingcli', 'x'], exitCode: 0, bytes: 5, authHost: 'auth.x.example', apiHost: 'api.x.example', envId: 'e', uri: 'environments/e/users', authFresh: true });
    const hops = enrichRunHops(raw, source);
    assert.deepEqual(hopProblems(hops, source), [], source);
    const text = JSON.stringify(hops);
    assert.ok(!/client_secret=(?!\[write-only\])/.test(text), 'the secret slot is write-only');
    if (source === 'real') assert.ok(!text.includes('MOCK-ACCESS-TOKEN'));
  }
  for (const k of LAB_KINDS) assert.deepEqual(validateHop({ n: 1, kind: k, label: k, from: 'a', to: 'b', title: CATALOG.kinds[k].title, narrative: k, fact: CATALOG.kinds[k].fact, spec: CATALOG.kinds[k].spec }, CATALOG), [], k);
  const failed = enrichRunHops(buildRunHops({ trace, source: 'mock', commandKey: 'version', label: 'dataset overview', argv: [], exitCode: 1, bytes: 0 }), 'mock');
  assert.equal(failed[1].verdict, 'deny');
  assert.equal(failed[1].fact, 'denied');
});
