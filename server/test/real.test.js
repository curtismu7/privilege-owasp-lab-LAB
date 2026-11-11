// Real mode against FAKE pingcli binaries only (test/fixtures). Never a real tenant, never real credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDS } from '../src/commands.js';
import { REDACTED, childEnv, configYaml, createRealRunner, createScrubber, secretForms, sweepStale } from '../src/realRunner.js';
import { realConfigFrom } from '../src/config.js';
import { spawn, spawnSync } from 'node:child_process';
import { FAKE, isAlive, newTmpRoot, post, readSse, realEnv, sleep, stubBin, waitDead, waitFile, withServer } from './helpers.js';

const readSseText = (text) => readSse({ text: async () => text });

const SECRET = FAKE.PINGONE_CLIENT_SECRET;
const CLIENT = FAKE.PINGONE_CLIENT_ID;
const noSecrets = (text, what) => { assert.ok(!text.includes(SECRET), `${what}: secret leaked`); assert.ok(!text.includes(CLIENT), `${what}: client id leaked`); };

// Captures everything the process logs while fn runs.
async function captureLogs(fn) {
  const lines = []; const saved = {};
  for (const k of ['log', 'error', 'warn', 'info', 'debug']) { saved[k] = console[k]; console[k] = (...a) => lines.push(a.join(' ')); }
  const write = process.stderr.write; process.stderr.write = (c, ...r) => { lines.push(String(c)); return write.call(process.stderr, c, ...r); };
  try { await fn(); } finally { Object.assign(console, saved); process.stderr.write = write; }
  return lines.join('\n');
}

test('scrubber: every split point of the secret across chunks is caught; JSON-escaped forms too', () => {
  const secret = 'S3cr"et/value\\x';
  const text = `before ${secret} middle ${JSON.stringify(secret).slice(1, -1)} after`;
  for (let i = 0; i <= text.length; i++) {
    for (let j = i; j <= text.length; j += 7) {
      const s = createScrubber([secret]);
      const out = s.push(text.slice(0, i)) + s.push(text.slice(i, j)) + s.push(text.slice(j)) + s.flush();
      assert.ok(!out.includes(secret) && !out.includes(JSON.stringify(secret).slice(1, -1)), `split ${i}/${j}`);
      assert.equal(out, `before ${REDACTED} middle ${REDACTED} after`);
    }
  }
  // A very long line without a newline is released in parts, still never with a whole or split secret.
  const long = `${'a'.repeat(70_000)}${secret}${'b'.repeat(70_000)}`;
  for (const at of [69_990, 70_003, 70_010, 70_000 + secret.length]) {
    const s = createScrubber([secret]);
    const first = s.push(long.slice(0, at));
    const out = first + s.push(long.slice(at)) + s.flush();
    assert.ok(!out.includes(secret));
    assert.equal(out.length, long.length - secret.length + REDACTED.length);
  }
  const lines = createScrubber([secret]);
  assert.equal(lines.push('one\ntw'), 'one\n', 'whole lines are released, the unfinished one is held');
  assert.equal(lines.push('o\n'), 'two\n');
  const none = createScrubber([]);
  assert.equal(none.push('abc') + none.flush(), 'abc');
});

test('scrubber forms: Basic-header base64(id:secret), URL- and form-encoded values are all redacted', () => {
  const id = 'client id/1'; const secret = 'p@ss word+=/x';
  const s = createScrubber(secretForms(id, secret));
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const formBasic = Buffer.from(`${encodeURIComponent(id).replace(/%20/g, '+')}:${encodeURIComponent(secret).replace(/%20/g, '+')}`).toString('base64');
  const text = [`Authorization: Basic ${basic}`, `Authorization: Basic ${formBasic}`, `client_secret=${encodeURIComponent(secret)}`, `client_secret=${encodeURIComponent(secret).replace(/%20/g, '+')}`, `id=${encodeURIComponent(id)}`, `url-safe ${Buffer.from(`${id}:${secret}`).toString('base64url')}`].join('\n');
  const out = s.push(`${text}\n`) + s.flush();
  for (const v of [basic, formBasic, encodeURIComponent(secret), encodeURIComponent(id), secret, id, Buffer.from(`${id}:${secret}`).toString('base64url')]) assert.ok(!out.includes(v), v);
  assert.equal(out.split('[redacted]').length - 1, 6);
});

test('config YAML: values are quoted scalars, so a hostile secret cannot add YAML keys', () => {
  const y = configYaml({ clientId: 'id', clientSecret: 'x"\nevil: true', envId: 'e', rootDomain: 'pingone.eu' });
  assert.match(y, /clientSecret: "x\\"\\nevil: true"/);
  assert.doesNotMatch(y, /^\s*evil:/m);
  assert.match(y, /rootDomain: "pingone.eu"/);
  assert.match(y, /grantType: client_credentials/);
});

test('child env is minimal: PATH, HOME, TMPDIR only; no PINGONE_* or PINGCLI_*', () => {
  const env = childEnv('/priv', { PATH: '/bin', PINGONE_CLIENT_SECRET: 'x', PINGCLI_BIN: 'y', AWS_SECRET_ACCESS_KEY: 'z' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/priv', TMPDIR: '/priv' });
});

test('Real stream: auth bootstrap once, private config 600, PINGONE_* stripped, secret and client id scrubbed from every frame and log', async () => {
  let frames = '';
  let envLine;
  const logs = await captureLogs(async () => {
    await withServer(async (url) => {
      const info = await (await fetch(`${url}/api/info`)).json();
      assert.equal(info.source, 'real');
      assert.deepEqual(info.real, { region: 'NA', rootDomain: 'pingone.com' });
      noSecrets(JSON.stringify(info), 'info');
      const res = await fetch(`${url}/api/stream?commandKey=coverage-table`);
      const raw = await res.clone().text();
      frames += raw;
      const ev = await readSse(res);
      assert.equal(ev[0].data.source, 'real');
      assert.equal(ev[0].data.source, 'real');
      const out = ev.filter((e) => e.event === 'chunk').map((e) => e.data.text).join('');
      assert.match(out, /config-mode=600/);
      assert.match(out, /home-has-token=true/, 'auth login ran first and stored its token under the private HOME');
      assert.match(out, /split=\[redacted\]/, 'a secret split across two writes is still scrubbed');
      assert.match(out, /clientSecret: "\[redacted\]"/);
      assert.match(out, /clientID: "\[redacted\]"/);
      envLine = JSON.parse(/^env=(.*)$/m.exec(out)[1]);
      assert.deepEqual(Object.keys(envLine).filter((k) => /^PINGONE_|^POWASP_/.test(k)), []);
      assert.ok(envLine.HOME.includes('privilege-owasp-lab-'), 'HOME is the private dir');
      const args = JSON.parse(/^args=(.*)$/m.exec(out)[1]);
      assert.deepEqual(args, ['pingone', 'api', `environments/${FAKE.PINGONE_ENVIRONMENT_ID}`, '-O', 'json'], 'a fixed, read-only invocation with no caller value');
      const done = ev.at(-1).data;
      assert.equal(done.exitCode, 0);
      assert.equal(done.hops[1].to, 'pingcli');
      assert.match(done.hops[1].request.url, /--config <private>\/config\.yaml/);
      assert.equal(done.hops[2].to, 'pingone-auth');
      assert.equal(done.hops[2].observed, false, 'pingcli traffic is described, not observed');
      assert.match(done.hops[2].request.url, /^https:\/\/auth\.pingone\.com\//);
      assert.equal(done.hops[3].request.headers.authorization, 'Bearer [redacted-jwt]', 'Real redacts tokens');
      assert.ok(done.hops.every((h) => h.mock === false));
      // Second auth command: no second login.
      const ev2 = await readSse(await fetch(`${url}/api/stream?commandKey=asi03`));
      frames += JSON.stringify(ev2);
      assert.deepEqual(ev2.at(-1).data.hops.map((h) => h.to), ['lab', 'pingcli', 'pingone-api']);
      const run = await (await post(url, '/api/run', { commandKey: 'coverage-table' })).json();
      frames += JSON.stringify(run);
      assert.match(run.output, /\[redacted\]/);
      const cmds = await (await fetch(`${url}/api/commands`)).json();
      frames += JSON.stringify(cmds) + JSON.stringify(await (await fetch(`${url}/api/version`)).json()) + JSON.stringify(await (await fetch(`${url}/api/health`)).json());
      // Switching to Mock removes the private dir (config and token store).
      const priv = envLine.HOME;
      assert.equal(fs.statSync(priv).mode & 0o777, 0o700);
      await post(url, '/api/mode', { source: 'mock' });
      assert.equal(fs.existsSync(priv), false, 'removed on mode switch');
    }, { env: realEnv('echo') });
  });
  noSecrets(frames, 'SSE/JSON frames');
  noSecrets(logs, 'logs');
});

test('auth bootstrap failure: reported as exit 1 with the error scrubbed; the next run retries', async () => {
  await withServer(async (url) => {
    const ev = await readSse(await fetch(`${url}/api/stream?commandKey=coverage-table`));
    const out = ev.filter((e) => e.event === 'chunk').map((e) => e.data.text).join('');
    assert.match(out, /auth bootstrap failed/);
    assert.match(out, /invalid_client for client \[redacted\] with secret \[redacted\]/);
    noSecrets(JSON.stringify(ev), 'auth failure');
    assert.equal(ev.at(-1).data.exitCode, 1);
    const ev2 = await readSse(await fetch(`${url}/api/stream?commandKey=asi03`));
    assert.match(ev2.filter((e) => e.event === 'chunk').map((e) => e.data.text).join(''), /auth bootstrap failed/, 'retried, failed again');
    // A command without auth still runs.
    const v = await readSse(await fetch(`${url}/api/stream?commandKey=two-layers`));
    assert.equal(v.at(-1).data.exitCode, 1, 'the authfail stub exits 1 for everything');
  }, { env: realEnv('authfail') });
});

// A runner on its own temp root, disposed and removed afterwards.
async function withRunner(kind, opts, fn) {
  const tmpRoot = newTmpRoot();
  const runner = createRealRunner(realConfigFrom(FAKE, stubBin(kind)), { tmpRoot, ...opts });
  try { await fn(runner, tmpRoot); } finally { await runner.dispose(); fs.rmSync(tmpRoot, { recursive: true, force: true }); }
}

test('Real: timeout and output cap stop the child', async () => {
  await withRunner('hang', { timeoutMs: 1500 }, async (runner) => {
    const t0 = Date.now();
    const r = await runner.run(COMMANDS['live-evidence'], { onText: () => {} });
    assert.ok(Date.now() - t0 < 5000);
    assert.match(r.error, /timed out/);
    const pid = Number(fs.readFileSync(path.join(runner.dir, 'hang.pid'), 'utf8'));
    assert.ok(await waitDead(pid), 'the child is gone');
  });
  await withRunner('flood', { maxBytes: 64 * 1024 }, async (runner) => {
    let got = 0;
    const r = await runner.run(COMMANDS['live-evidence'], { onText: (t) => { got += t.length; } });
    assert.equal(r.truncated, true);
    assert.ok(got <= 64 * 1024 + 2048, `capped near the limit (${got})`);
    assert.match(r.error, /output over/);
  });
});

test('Real: the timeout is a real bound even when a grandchild holds the pipes (the whole process group is killed)', async () => {
  // The dataset command exits at once; the hang case is covered by the second half of this test with graceMs.
  await withRunner('grandchild', { timeoutMs: 1500 }, async (runner, tmpRoot) => {
    const t0 = Date.now();
    const r = await runner.run(COMMANDS['live-evidence'], { onText: () => {} });
    assert.ok(Date.now() - t0 < 5000, `ended after ${Date.now() - t0} ms (the sleep would hold it 40 s)`);
    assert.equal(r.exitCode, 0);
    assert.ok(await waitDead(Number(fs.readFileSync(path.join(path.dirname(runner.dir), 'sleep.pid'), 'utf8'))), 'the grandchild is gone too');
  });
  // The child exits at once but its `sleep 40` keeps the pipes open: the run ends within the exit grace.
  await withRunner('grandchild', { timeoutMs: 10_000, graceMs: 300 }, async (runner, tmpRoot) => {
    const t0 = Date.now();
    const r = await runner.run(COMMANDS['live-evidence'], { onText: () => {} });
    assert.ok(Date.now() - t0 < 5000, `ended after ${Date.now() - t0} ms (the sleep would hold it 40 s)`);
    assert.equal(r.exitCode, 0);
    assert.ok(await waitDead(Number(fs.readFileSync(path.join(path.dirname(runner.dir), 'sleep.pid'), 'utf8'))), 'the orphaned grandchild was killed');
  });
});

test('Real: the client going away kills the child and frees the workspace (per-test temp root)', async () => {
  await withServer(async (url, _app, tmpRoot) => {
    const ctl = new AbortController();
    const res = await fetch(`${url}/api/stream?commandKey=live-evidence`, { signal: ctl.signal });
    const reader = res.body.getReader();
    let seen = '';
    while (!seen.includes('started')) seen += new TextDecoder().decode((await reader.read()).value);
    const dirs = fs.readdirSync(tmpRoot).filter((n) => n.startsWith('privilege-owasp-lab-'));
    assert.equal(dirs.length, 1, 'exactly one private dir, in this test\'s own root');
    const pid = Number(fs.readFileSync(path.join(tmpRoot, dirs[0], 'hang.pid'), 'utf8'));
    assert.ok(isAlive(pid), 'running before the disconnect');
    ctl.abort();
    assert.ok(await waitDead(pid), 'disconnect killed the child');
    await sleep(100);
    const next = await fetch(`${url}/api/stream?commandKey=two-layers`);
    assert.equal(next.status, 200, 'the workspace is free again');
    await next.text();
  }, { env: realEnv('hang') });
});

test('BLOCKING fix: a mode switch during Real auth kills the login, spawns nothing, leaves no dir and ends the stream stopped', async () => {
  await withServer(async (url, _app, tmpRoot) => {
    const res = await fetch(`${url}/api/stream?commandKey=coverage-table`);
    const body = res.text();
    const authPid = Number(await waitFile(path.join(tmpRoot, 'auth.pid')));
    assert.ok(isAlive(authPid), 'login is running');
    assert.equal((await (await post(url, '/api/mode', { source: 'mock' })).json()).source, 'mock');
    assert.equal(isAlive(authPid), false, 'the login child was killed and awaited before /api/mode answered');
    assert.deepEqual(fs.readdirSync(tmpRoot).filter((n) => n.startsWith('privilege-owasp-lab-')), [], 'private dir removed');
    const ev = await readSseText(await body);
    assert.equal(ev.at(-1).data.error, 'stopped');
    assert.equal(ev.at(-1).data.exitCode, 1);
    await sleep(2500); // past the login's own 2 s: nothing may come back to life
    assert.equal(fs.existsSync(path.join(tmpRoot, 'commands.log')), false, 'the users command never ran');
    assert.deepEqual(fs.readdirSync(tmpRoot).filter((n) => n.startsWith('privilege-owasp-lab-')), [], 'no HOME or token store was recreated');
  }, { env: realEnv('slowauth') });
});

test('BLOCKING fix: a client disconnect during Real auth frees the workspace at once and the command never runs', async () => {
  await withServer(async (url, _app, tmpRoot) => {
    const ctl = new AbortController();
    const res = await fetch(`${url}/api/stream?commandKey=coverage-table`, { signal: ctl.signal });
    res.body.getReader().read().catch(() => {});
    const authPid = Number(await waitFile(path.join(tmpRoot, 'auth.pid')));
    ctl.abort();
    assert.ok(await waitDead(authPid, 1500), 'the last waiter left, so the login child was killed');
    const next = await fetch(`${url}/api/version`);
    assert.equal(next.status, 200, 'the lab still answers after the disconnect');
    await next.text();
    await sleep(2500);
    assert.equal(fs.existsSync(path.join(tmpRoot, 'commands.log')), false, 'the dataset command never ran');
  }, { env: realEnv('slowauth') });
});

test('BLOCKING fix: Reset during Real auth stops the run; the next run authenticates again and runs', async () => {
  await withServer(async (url, _app, tmpRoot) => {
    const res = await fetch(`${url}/api/stream?commandKey=coverage-table`);
    const body = res.text();
    await waitFile(path.join(tmpRoot, 'auth.pid'));
    assert.equal((await post(url, '/api/reset', {})).status, 200);
    const ev = await readSseText(await body);
    assert.equal(ev.at(-1).data.error, 'stopped');
    await sleep(2500);
    assert.equal(fs.existsSync(path.join(tmpRoot, 'commands.log')), false, 'the stopped run never spawned its command');
    const again = await readSse(await fetch(`${url}/api/stream?commandKey=coverage-table`));
    assert.equal(again.at(-1).data.exitCode, 0);
    assert.equal(fs.readFileSync(path.join(tmpRoot, 'commands.log'), 'utf8').trim().split('\n').length, 1);
  }, { env: realEnv('slowauth') });
});

test('BLOCKING fix: the runner refuses to spawn once its session ended or its signal fired', async () => {
  await withRunner('echo', {}, async (runner) => {
    const ctl = new AbortController(); ctl.abort();
    const r = await runner.run(COMMANDS['two-layers'], { onText: () => {}, signal: ctl.signal });
    assert.equal(r.error, 'stopped');
    assert.equal(runner.dir, null, 'not even the private dir was created');
    const pending = runner.run(COMMANDS['coverage-table'], { onText: () => {} });
    await runner.dispose();
    assert.equal((await pending).error, 'stopped');
    assert.equal(runner.liveChildren, 0);
  });
});

test('sweepStale removes only our own stale dirs: dead owner pid, or no pid file and older than the process', () => {
  const root = newTmpRoot();
  try {
    const mk = (name, pid, old) => {
      const d = path.join(root, name); fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'config.yaml'), 'x');
      if (pid !== undefined) fs.writeFileSync(path.join(d, 'owner.pid'), String(pid));
      if (old) { const t = new Date(Date.now() - 3_600_000); fs.utimesSync(d, t, t); }
      return d;
    };
    const dead = spawnSync(process.execPath, ['-e', '0']).pid; // a pid that has exited
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    mk('privilege-owasp-lab-dead01', dead);
    mk('privilege-owasp-lab-mine01', process.pid);
    mk('privilege-owasp-lab-live01', live.pid); // another process, still running
    const bare = path.join(root, 'privilege-owasp-lab-bare01'); fs.mkdirSync(bare); fs.writeFileSync(path.join(bare, 'notes.txt'), 'x');
    const t = new Date(Date.now() - 3_600_000); fs.utimesSync(bare, t, t); // old, no pid, no config: not ours
    mk('privilege-owasp-lab-oldnp1', undefined, true);
    mk('privilege-owasp-lab-newnp1', undefined, false);
    mk('privilege-owasp-lab-toolong-name', dead);
    mk('other-dir-abc123', dead);
    fs.symlinkSync(path.join(root, 'other-dir-abc123'), path.join(root, 'privilege-owasp-lab-link01'));
    const removed = sweepStale(root, { startedAt: Date.now() - 60_000 }).sort();
    assert.deepEqual(removed, ['privilege-owasp-lab-dead01', 'privilege-owasp-lab-oldnp1']);
    assert.deepEqual(fs.readdirSync(root).sort(), ['other-dir-abc123', 'privilege-owasp-lab-bare01', 'privilege-owasp-lab-link01', 'privilege-owasp-lab-live01', 'privilege-owasp-lab-mine01', 'privilege-owasp-lab-newnp1', 'privilege-owasp-lab-toolong-name']);
    live.kill();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a caller joining a shared login just after every earlier waiter aborted it gets a fresh login, not "stopped"', async () => {
  await withRunner('slowauth', {}, async (runner, tmpRoot) => {
    const a = new AbortController();
    const first = runner.run(COMMANDS['coverage-table'], { onText: () => {}, signal: a.signal });
    const firstPid = Number(await waitFile(path.join(tmpRoot, 'auth.pid')));
    fs.rmSync(path.join(tmpRoot, 'auth.pid'));
    a.abort(); // A was the only waiter: its login is aborted
    const second = await runner.run(COMMANDS['coverage-table'], { onText: () => {} }); // B joins right away
    assert.equal((await first).error, 'stopped');
    assert.equal(second.error, undefined, 'B was not handed A\'s stop');
    assert.equal(second.exitCode, 0);
    assert.notEqual(Number(fs.readFileSync(path.join(tmpRoot, 'auth.pid'), 'utf8')), firstPid, 'a fresh login ran for B');
    assert.equal(fs.readFileSync(path.join(tmpRoot, 'commands.log'), 'utf8').trim().split('\n').length, 1, 'only B ran its command');
  });
});

test('the private dir records its owner pid, so the start-up sweep never removes a live run', async () => {
  await withRunner('echo', {}, async (runner) => {
    await runner.version();
    assert.equal(fs.readFileSync(path.join(runner.dir, 'owner.pid'), 'utf8'), String(process.pid));
    assert.equal(fs.statSync(path.join(runner.dir, 'owner.pid')).mode & 0o777, 0o600);
  });
});

test('version in Real: one spawn per session, shared by parallel callers', async () => {
  await withServer(async (url, _app, tmpRoot) => {
    const all = await Promise.all(Array.from({ length: 30 }, () => fetch(`${url}/api/version`).then((r) => r.json())));
    assert.ok(all.every((v) => v.version === '1.2.0'));
    assert.equal(fs.readFileSync(path.join(tmpRoot, 'version.log'), 'utf8').trim().split('\n').length, 1);
  }, { env: realEnv('counter') });
});

test('cross-site GETs never start pingcli: stream and version refuse cross-site and same-site fetches and foreign Origins', async () => {
  const marker = new URL('./fixtures/marker.log', import.meta.url);
  fs.rmSync(marker, { force: true });
  try {
    await withServer(async (url) => {
      for (const p of ['/api/stream?commandKey=live-evidence', '/api/version']) {
        for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }]) {
          const r = await fetch(`${url}${p}`, { headers });
          assert.equal(r.status, 403, `${p} ${JSON.stringify(headers)}`);
          assert.equal((await r.json()).error, 'cross_origin');
        }
      }
      assert.equal(fs.existsSync(marker), false, 'no child ran');
      const ok = await fetch(`${url}/api/version`, { headers: { 'sec-fetch-site': 'same-origin' } });
      assert.equal(ok.status, 200);
      assert.equal(fs.existsSync(marker), true, 'a same-origin request does run');
    }, { env: realEnv('marker') });
  } finally { fs.rmSync(marker, { force: true }); }
});

test('POST /api/run keeps stderr out of output (stdout, or stderr when stdout is empty), and returns it separately', async () => {
  await withServer(async (url) => {
    const j = await (await post(url, '/api/run', { commandKey: 'coverage-table' })).json();
    assert.doesNotMatch(j.output, /config<</);
    assert.match(j.stderr, /config<</);
    noSecrets(JSON.stringify(j), 'run');
  }, { env: realEnv('echo') });
  await withServer(async (url) => {
    const j = await (await post(url, '/api/run', { commandKey: 'coverage-table' })).json();
    assert.match(j.output, /auth bootstrap failed/, 'stderr only: it becomes the output');
    assert.equal(j.stderr, undefined);
  }, { env: realEnv('authfail') });
});

test('every dataset runs with the same fixed, read-only, --config invocation; no caller value in argv', async () => {
  await withRunner('echo', {}, async (runner) => {
    for (const key of ['live-evidence', 'coverage-table', 'asi03']) {
      let out = '';
      await runner.run(COMMANDS[key], { onText: (t) => { out += t; } });
      assert.match(out, /^has-config=true$/m);
      const args = JSON.parse(/^args=(.*)$/m.exec(out)[1]);
      assert.deepEqual(args.slice(0, 2), ['pingone', 'api']);
      assert.match(args[2], /^environments\/[0-9a-f-]{36}$/);
      assert.deepEqual(args.slice(3), ['-O', 'json']);
      assert.ok(!out.includes('FAKE-SECRET'), 'no secret in argv');
    }
  });
});

test('no shell anywhere: the runner spawns with shell:false and no source file uses exec() or a shell string', () => {
  const dir = new URL('../src/', import.meta.url);
  const src = fs.readdirSync(dir, { recursive: true }).filter((f) => /\.m?js$/.test(f)).map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  assert.match(src, /spawn\(cfg\.bin, args, \{ shell: false/);
  const imports = [...src.matchAll(/import (.*) from 'node:child_process'/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['{ spawn }'], 'only spawn is imported from child_process');
  assert.doesNotMatch(src, /(?<![.\w])exec(File)?(Sync)?\(|spawnSync|shell:\s*true|\/bin\/sh|(?<![.\w])eval\(|new Function\(/);
});

test('BLOCKING fix: 50000-deep JSON from pingcli streams and runs without crashing the server; /api/run returns it as text', async () => {
  await withServer(async (url) => {
    const ev = await readSse(await fetch(`${url}/api/stream?commandKey=coverage-table`));
    assert.equal(ev.at(-1).event, 'done');
    assert.equal(ev.at(-1).data.exitCode, 0);
    const j = await (await post(url, '/api/run', { commandKey: 'coverage-table' })).json();
    assert.equal(j.exitCode, 0);
    assert.ok(j.output.startsWith('[[[['), 'raw text, not re-serialised');
    assert.equal((await fetch(`${url}/api/health`)).status, 200, 'the server is still up');
  }, { env: realEnv('deep') });
});

test('nit (a): /api/version in Real reports the binary version against the static-deck pin id', async () => {
  await withServer(async (url) => {
    const v = await (await fetch(`${url}/api/version`)).json();
    assert.equal(v.version, '1.1.0');
    assert.equal(v.source, 'real');
    assert.equal(v.pinned, 'static-deck-2026-11-02');
    assert.equal(v.matchesPinned, false);
  }, { env: realEnv('oldver') });
});
