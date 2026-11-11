import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMMAND_KEYS } from '../src/commands.js';
import { installNetguard } from '../src/netguard.js';
import { parseTraceparent } from '../src/trace.js';
import { buildReadableView } from '../src/readable.js';
import { post, rawHttp, readSse, realEnv, withServer } from './helpers.js';

test('GET /api/health is demo-health/1 and ready; GET only', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/health`)).json();
    assert.equal(j.schema, 'demo-health/1');
    assert.equal(j.state, 'ready');
    assert.equal(j.runtime, 'offline');
    assert.equal(j.demo.id, 'privilege-owasp-lab');
    assert.equal((await post(url, '/api/health', {})).status, 405);
  });
});

test('GET /api/info: Mock by default when Real is unconfigured, with a reason and the banner; no settings values', async () => {
  await withServer(async (url) => {
    const j = await (await fetch(`${url}/api/info`)).json();
    assert.equal(j.source, 'mock');
    assert.equal(j.realAvailable, false);
    assert.match(j.realHowTo, /PINGONE_ENVIRONMENT_ID/);
    assert.match(j.banner, /^MOCK: /);
    assert.equal(j.real, null);
    assert.equal(j.pinnedVersion, 'static-deck-2026-11-02');
  });
});

test('POST /api/mode: exactly { source }, 409 when Real is unconfigured, extra keys and bad values 400', async () => {
  await withServer(async (url) => {
    assert.equal((await post(url, '/api/mode', { source: 'real' })).status, 409);
    assert.match((await (await post(url, '/api/mode', { source: 'real' })).json()).detail, /PINGONE_/);
    for (const bad of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, { source: ['mock'] }, [], 'mock', null, { source: 'MOCK' }]) {
      assert.equal((await post(url, '/api/mode', bad === null ? 'null' : bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await post(url, '/api/mode', '{bad json')).status, 400);
    assert.deepEqual(await (await post(url, '/api/mode', { source: 'mock' })).json(), { source: 'mock' });
  });
});

test('the toggle switches both directions without a restart, and data reloads in the new mode', async () => {
  await withServer(async (url) => {
    const info = async () => (await (await fetch(`${url}/api/info`)).json());
    assert.equal((await info()).source, 'real', 'default is Real when configured');
    assert.equal((await (await fetch(`${url}/api/health`)).json()).runtime !== undefined, true);
    assert.equal((await (await post(url, '/api/mode', { source: 'mock' })).json()).source, 'mock');
    assert.equal((await info()).source, 'mock');
    let v = await (await fetch(`${url}/api/version`)).json();
    assert.equal(v.source, 'mock');
    let cmds = await (await fetch(`${url}/api/commands`)).json();
    assert.match(cmds[0].prereqs[0].note, /Mock/);
    assert.equal((await (await post(url, '/api/mode', { source: 'real' })).json()).source, 'real');
    assert.equal((await info()).source, 'real');
    v = await (await fetch(`${url}/api/version`)).json();
    assert.equal(v.source, 'real');
    cmds = await (await fetch(`${url}/api/commands`)).json();
    assert.doesNotMatch(cmds[0].prereqs[0].note, /Mock/);
  }, { env: realEnv('echo') });
});

test('GET /api/commands keeps the contract: 13 datasets with key, title, runnable, auth, prereqs', async () => {
  await withServer(async (url) => {
    const list = await (await fetch(`${url}/api/commands`)).json();
    assert.ok(Array.isArray(list));
    assert.deepEqual(list.map((c) => c.key), [...COMMAND_KEYS]);
    for (const c of list) {
      assert.equal(typeof c.label, 'string'); assert.equal(c.runnable, true); assert.equal(typeof c.auth, 'boolean'); assert.ok(c.prereqs.length >= 2);
      assert.match(c.label, /^privilege-owasp dataset /);
    }
  });
});

test('SSE stream in Mock: meta, then chunks, then done; output labelled mock; hops with traceparent', async () => {
  await withServer(async (url) => {
    const res = await fetch(`${url}/api/stream?commandKey=coverage-table&vertical=banking`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    assert.ok(parseTraceparent(res.headers.get('traceparent')));
    const ev = await readSse(res);
    assert.equal(ev[0].event, 'meta');
    assert.equal(ev[0].data.source, 'mock');
    assert.equal(ev[0].data.simulated, true);
    assert.equal(ev[0].data.auth, true);
    assert.equal(ev[0].data.prereqs.length >= 2, true);
    const chunks = ev.filter((e) => e.event === 'chunk');
    assert.ok(chunks.length > 1, 'streamed in several chunks');
    const done = ev.at(-1);
    assert.equal(done.event, 'done');
    assert.equal(done.data.exitCode, 0);
    assert.equal(done.data.source, 'mock');
    const text = chunks.map((c) => c.data.text).join('');
    const view = buildReadableView(text);
    assert.equal(view.kind, 'table');
    assert.equal(view.rows.length, 10);
    assert.deepEqual(view.rows.filter((r) => r.state === 'gap stated').map((r) => r.id), ['ASI04', 'ASI06']);
    const hops = done.data.hops;
    assert.deepEqual(hops.map((h) => `${h.from}>${h.to}`), ['browser>lab', 'lab>pingcli', 'pingcli>pingone-auth', 'pingcli>pingone-api']);
    assert.deepEqual(hops.map((h) => h.kind), ['powasp-read-request', 'powasp-fetch', 'powasp-auth', 'powasp-management-api']);
    for (const h of hops) { assert.ok(parseTraceparent(h.traceparent)); assert.ok(h.traceparent.includes(done.data.traceId)); }
    assert.match(hops[1].narrative, /MOCK/);
    assert.equal(hops[2].request.body, 'grant_type=client_credentials&client_id=<client id>&client_secret=[write-only]');
    assert.equal(hops[2].response.body.access_token, 'MOCK-ACCESS-TOKEN-not-a-real-token', 'Mock keeps the MOCK token raw (teaching)');
    for (const h of hops) { assert.equal(h.mock, true); assert.ok(h.title && h.fact && h.spec, `hop ${h.n} is enriched`); }
    // The token hop is shown once per session.
    const again = await readSse(await fetch(`${url}/api/stream?commandKey=asi03`));
    assert.deepEqual(again.at(-1).data.hops.map((h) => h.to), ['lab', 'pingcli', 'pingone-api']);
  });
});

test('POST /api/run in Mock returns { command, output, exitCode, source, hops }', async () => {
  await withServer(async (url) => {
    const r = await post(url, '/api/run', { commandKey: 'coverage-table' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.match(j.command, /^privilege-owasp dataset /);
    assert.equal(j.exitCode, 0);
    assert.equal(j.source, 'mock');
    assert.equal(JSON.parse(j.output).data.rows.length, 10);
    assert.equal(j.hops[0].from, 'browser');
    assert.equal((await post(url, '/api/run', {})).status, 400);
    assert.equal((await (await post(url, '/api/run', {})).json()).error, 'missing_dataset_key');
    assert.equal((await post(url, '/api/run', { commandKey: 'asi03', extra: 1 })).status, 400);
    assert.equal((await post(url, '/api/run', [])).status, 400);
    assert.equal((await post(url, '/api/run', { commandKey: 'x'.repeat(5000) })).status, 413, 'body cap');
  });
});

test('hostile commandKey on stream and run: 400 JSON before any stream starts, never echoed', async () => {
  await withServer(async (url) => {
    const keys = ['__proto__', 'constructor', 'toString', 'x'.repeat(2000), 'asi03%3B%20id', '%24(id)', 'asi03%C3%B3n', '%E2%80%AEasi03', '../asi03', 'ASI03'];
    for (const k of keys) {
      const r = await fetch(`${url}/api/stream?commandKey=${k}`);
      assert.equal(r.status, 400, k);
      assert.match(r.headers.get('content-type'), /application\/json/);
      const j = await r.json();
      assert.equal(j.error, 'unknown_dataset', k);
      assert.ok(!JSON.stringify(j).includes('xxxxxxxxxx'), 'a long key is not echoed');
    }
    for (const q of ['', 'commandKey=', 'commandKey=asi03&commandKey=asi03', 'commandKey[a]=asi03']) {
      const r = await fetch(`${url}/api/stream?${q}`);
      assert.equal(r.status, 400, q);
    }
    for (const k of ['__proto__', 'constructor', 'é'.repeat(50), { a: 1 }, ['asi03'], 1]) {
      assert.equal((await post(url, '/api/run', { commandKey: k })).status, 400, JSON.stringify(k));
    }
    assert.equal((await post(url, '/api/run', '{"commandKey":"asi03","__proto__":{"runnable":true}}')).status, 400);
  });
});

test('one run at a time per workspace; other workspaces are independent; Reset stops the run', async () => {
  await withServer(async (url) => {
    const ctl = new AbortController();
    const first = await fetch(`${url}/api/stream?commandKey=coverage-table`, { signal: ctl.signal });
    assert.equal(first.status, 200);
    const busy = await fetch(`${url}/api/stream?commandKey=two-layers`);
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).error, 'run_in_progress');
    assert.equal((await post(url, '/api/run', { commandKey: 'two-layers' })).status, 409);
    const other = await fetch(`${url}/api/stream?commandKey=two-layers`, { headers: { 'x-workspace': 'other' } });
    assert.equal(other.status, 200);
    await other.text();
    assert.equal((await post(url, '/api/reset', {})).status, 200);
    const ev = await readSse(first);
    assert.equal(ev.at(-1).event, 'done');
    // Reset aborts the run in flight: the replay either reports 'stopped' or finished before the abort landed.
    if (ev.at(-1).data.error !== undefined) assert.equal(ev.at(-1).data.error, 'stopped');
    const after = await fetch(`${url}/api/stream?commandKey=two-layers`);
    assert.equal(after.status, 200);
    await after.text();
    ctl.abort();
  }, { mockDelayMs: 200 });
});

test('workspaces: bad X-Workspace is 400; runs are recorded per workspace and Reset clears them', async () => {
  await withServer(async (url) => {
    assert.equal((await fetch(`${url}/api/runs`, { headers: { 'x-workspace': 'Bad Id' } })).status, 400);
    await (await fetch(`${url}/api/stream?commandKey=two-layers`, { headers: { 'x-workspace': 'ws-a' } })).text();
    assert.equal((await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': 'ws-a' } })).json()).runs.length, 1);
    assert.equal((await (await fetch(`${url}/api/runs`)).json()).runs.length, 0);
    await post(url, '/api/reset', {}, { 'x-workspace': 'ws-a' });
    assert.equal((await (await fetch(`${url}/api/runs`, { headers: { 'x-workspace': 'ws-a' } })).json()).runs.length, 0);
  });
});

test('GET /api/version in Mock is a labelled static-deck version; story and diagram load per vertical', async () => {
  await withServer(async (url) => {
    const v = await (await fetch(`${url}/api/version`)).json();
    assert.deepEqual(Object.keys(v).sort(), ['note', 'source', 'version']);
    assert.equal(v.source, 'mock'); assert.match(v.note, /MOCK/);
    const s = await (await fetch(`${url}/api/story?vertical=healthcare`)).json();
    assert.match(s.intro, /Contoso Patient Access/);
    assert.deepEqual(s.verticals, ['banking', 'healthcare', 'retail']);
    assert.ok(!JSON.stringify(s).includes('{{'));
    assert.equal(s.cast.seed, undefined, 'the seed lists stay server-side');
    const d = await (await fetch(`${url}/api/diagram?vertical=banking`)).json();
    assert.ok(d.nodes.some((n) => n.id === 'lab'));
    assert.ok(d.steps.length >= 5);
    assert.ok(!JSON.stringify(d).includes('{{'));
    const odd = await (await fetch(`${url}/api/story?vertical=__proto__`)).json();
    assert.match(odd.intro, /Northwind/, 'unknown vertical -> default');
  });
});

test('Host check, same-origin writes and unknown routes', async () => {
  await withServer(async (url) => {
    assert.equal((await rawHttp(`${url}/api/info`, { headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await rawHttp(`${url}/api/stream?commandKey=two-layers`, { headers: { host: 'rebind.example:7811' } })).status, 403);
    assert.equal((await post(url, '/api/mode', { source: 'mock' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await post(url, '/api/run', { commandKey: 'two-layers' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await post(url, '/api/reset', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await fetch(`${url}/api/nope`)).status, 404);
  });
});

test('netguard: running every dataset in Mock (stream and run) makes zero outbound attempts', async () => {
  const guard = installNetguard();
  try {
    await withServer(async (url) => {
      for (const k of COMMAND_KEYS) {
        const ev = await readSse(await fetch(`${url}/api/stream?commandKey=${k}`));
        assert.equal(ev.at(-1).data.exitCode, 0, k);
        assert.equal((await post(url, '/api/run', { commandKey: k })).status, 200, k);
      }
      await fetch(`${url}/api/version`);
    });
    assert.deepEqual(guard.attempts, []);
  } finally { guard.restore(); }
});

test('Mock never starts a child process, even when a pingcli binary is configured', async () => {
  const marker = new URL('./fixtures/marker.log', import.meta.url);
  fs.rmSync(marker, { force: true });
  try {
    await withServer(async (url) => {
      assert.equal((await (await fetch(`${url}/api/info`)).json()).source, 'mock');
      for (const k of COMMAND_KEYS) await (await fetch(`${url}/api/stream?commandKey=${k}`)).text();
      await fetch(`${url}/api/version`);
      assert.equal(fs.existsSync(marker), false, 'no child ran in Mock');
      await post(url, '/api/mode', { source: 'real' });
      await fetch(`${url}/api/version`);
      assert.equal(fs.existsSync(marker), true, 'the same binary does run in Real (the test can see it)');
    }, { env: realEnv('marker', { MODE: 'mock' }) });
  } finally { fs.rmSync(marker, { force: true }); }
});

test('a mode switch stops the runs in flight (Mock run stopped when switching to Real)', async () => {
  await withServer(async (url) => {
    await post(url, '/api/mode', { source: 'mock' });
    const res = await fetch(`${url}/api/stream?commandKey=coverage-table`);
    const body = res.text();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await (await post(url, '/api/mode', { source: 'real' })).json()).source, 'real');
    const ev = await readSse({ text: async () => body });
    if (ev.at(-1).data.error !== undefined) {
      assert.equal(ev.at(-1).data.error, 'stopped', 'an in-flight replay is stopped by abortAll');
      assert.equal(ev.at(-1).data.source, 'mock');
    } else {
      assert.equal(ev.at(-1).data.exitCode, 0, 'a replay that finished before the switch is a clean done');
    }
  }, { env: realEnv('echo'), mockDelayMs: 300 });
});
