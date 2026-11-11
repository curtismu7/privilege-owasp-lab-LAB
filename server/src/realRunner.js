// Real: runs the pingcli binary for one allow-listed command. Owner-verified only; agents test it with a stub binary.
//  - spawn/execFile with no shell, arguments fixed by commands.js, --config added here.
//  - a fresh private temp dir (0700) per Real session: config.yaml (0600) with the worker credentials, owner.pid, and HOME
//    for the child (pingcli keeps its token store under $HOME/.pingcli). Removed on mode switch and exit, after every child
//    of the session is dead; stale ones from a crashed run are swept at start-up (sweepStale).
//  - the child gets a minimal environment: PATH, HOME, TMPDIR. No PINGONE_* or PINGCLI_* variable ever reaches it.
//  - every byte sent back is scrubbed of the client secret and client id (raw, JSON-, URL- and Basic-header-encoded),
//    even when a value is split across chunks.
//  - each child leads its own process group: timeout, output cap, abort (client gone, Reset, mode switch) kill the group,
//    and a run ends at most EXIT_GRACE_MS after the child exits even if a grandchild still holds its output pipes.
//  - a run started in one Real session never spawns after that session ended (abort or mode switch), including during auth.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// 15 s, as in the AI-DEMO2 source.
export const TIMEOUT_MS = 15_000;
export const EXIT_GRACE_MS = 1000;
export const DIR_PREFIX = 'privilege-owasp-lab-';
const DIR_RE = /^privilege-owasp-lab-[A-Za-z0-9]{6}$/;
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const REDACTED = '[redacted]';

// Streaming scrubber: replaces every secret. It releases whole lines (so stdout and stderr stay in line order when
// interleaved) and holds back the unfinished line; a very long unfinished line is released except for a tail that could
// be the start of a secret split across chunks.
export const LONG_LINE = 64 * 1024;
export function createScrubber(values) {
  const needles = [...new Set(values.filter((v) => typeof v === 'string' && v.length >= 4).flatMap((v) => [v, JSON.stringify(v).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length);
  const hold = needles.length ? Math.max(...needles.map((n) => n.length)) - 1 : 0;
  let buf = '';
  const clean = (s) => needles.reduce((acc, n) => acc.split(n).join(REDACTED), s);
  return {
    push(text) {
      buf = clean(buf + text);
      const nl = buf.lastIndexOf('\n');
      let cut = nl + 1;
      if (buf.length - cut > LONG_LINE) cut = buf.length - hold;
      if (cut <= 0) return '';
      const out = buf.slice(0, cut);
      buf = buf.slice(cut);
      return out;
    },
    flush() { const out = clean(buf); buf = ''; return out; },
    clean,
  };
}

// Every form a credential could take in output: raw, URL-encoded (and form-encoded), and the Basic-auth header value
// base64(id:secret) in both its raw and RFC 6749 form-encoded variants (standard and URL-safe alphabets).
export function secretForms(clientId, clientSecret) {
  const form = (v) => encodeURIComponent(v).replace(/%20/g, '+');
  const b64 = (v) => Buffer.from(v, 'utf8').toString('base64');
  const forms = [clientSecret, clientId, encodeURIComponent(clientSecret), encodeURIComponent(clientId), form(clientSecret), form(clientId)];
  for (const pair of [`${clientId}:${clientSecret}`, `${form(clientId)}:${form(clientSecret)}`]) {
    forms.push(b64(pair), b64(pair).replace(/=+$/, ''), Buffer.from(pair, 'utf8').toString('base64url'));
  }
  return forms;
}

// Removes private dirs a crashed run left behind: only our prefix, only real directories owned by this user, and only
// when they hold config.yaml or owner.pid, and only when the process that made them is gone (owner.pid) or, without a pid
// file, when they predate this process.
export function sweepStale(tmpRoot = os.tmpdir(), { startedAt = Date.now() - process.uptime() * 1000 } = {}) {
  const removed = [];
  let names = [];
  try { names = fs.readdirSync(tmpRoot); } catch { return removed; }
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  for (const name of names) {
    if (!DIR_RE.test(name)) continue;
    const p = path.join(tmpRoot, name);
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) continue;
    // Only a dir that looks like ours: it holds the profile or the owner pid. Anything else with the prefix is left alone.
    if (!fs.existsSync(path.join(p, 'config.yaml')) && !fs.existsSync(path.join(p, 'owner.pid'))) continue;
    let pid = null;
    try { pid = Number(fs.readFileSync(path.join(p, 'owner.pid'), 'utf8')); } catch { /* none */ }
    if (pid && Number.isInteger(pid)) { if (pid === process.pid || alive(pid)) continue; }
    else if (st.mtimeMs >= startedAt) continue;
    fs.rmSync(p, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// The YAML pingcli reads. Values are JSON-quoted (a JSON string is a valid YAML double-quoted scalar).
export function configYaml(cfg) {
  const q = (v) => JSON.stringify(String(v));
  return `activeProfile: default
configModelVersion: 2
default:
    auth:
        storage:
            type: file_system
    service:
        pingOne:
            authentication:
                clientCredentials:
                    clientID: ${q(cfg.clientId)}
                    clientSecret: ${q(cfg.clientSecret)}
                grantType: client_credentials
            enabled: true
            endpoint:
                environmentID: ${q(cfg.envId)}
                rootDomain: ${q(cfg.rootDomain)}
`;
}

export function childEnv(dir, parent = process.env) {
  return { PATH: parent.PATH || '/usr/local/bin:/usr/bin:/bin', HOME: dir, TMPDIR: dir };
}

export function createRealRunner(cfg, { timeoutMs = TIMEOUT_MS, maxBytes = MAX_OUTPUT_BYTES, tmpRoot = os.tmpdir(), graceMs = EXIT_GRACE_MS } = {}) {
  let dir = null;
  let boot = null;
  let gen = 0; // the Real session; dispose() ends it
  let versionCache = null;
  const children = new Set();
  const forms = secretForms(cfg.clientId, cfg.clientSecret);
  const STOPPED = Object.freeze({ exitCode: 1, error: 'stopped', stopped: true });

  function ensureDir() {
    if (dir && fs.existsSync(dir)) return dir;
    dir = fs.mkdtempSync(path.join(tmpRoot, DIR_PREFIX));
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, 'owner.pid'), String(process.pid), { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'config.yaml'), configYaml(cfg), { mode: 0o600 });
    boot = null;
    return dir;
  }

  const killGroup = (child) => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  };

  // One child process in session `myGen`. onText(text, 'out'|'err') receives scrubbed text.
  // Returns { exitCode, truncated, timedOut, stopped, error }. Never spawns once the signal fired or the session ended.
  function runChild(args, { onText = () => {}, signal, myGen } = {}) {
    if (signal?.aborted || myGen !== gen) return Promise.resolve({ ...STOPPED });
    return new Promise((resolve) => {
      const streams = { out: { s: createScrubber(forms), d: new StringDecoder('utf8') }, err: { s: createScrubber(forms), d: new StringDecoder('utf8') } };
      const scrub = createScrubber(forms);
      let bytes = 0; let truncated = false; let timedOut = false; let aborted = false; let settled = false;
      let child;
      try {
        child = spawn(cfg.bin, args, { shell: false, detached: true, env: childEnv(dir), cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) { resolve({ exitCode: 1, error: scrub.clean(e.message) }); return; }
      let markDone;
      const entry = { child, done: new Promise((r) => { markDone = r; }) };
      children.add(entry);
      let grace = null;
      const timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs);
      const onAbort = () => { aborted = true; killGroup(child); };
      signal?.addEventListener('abort', onAbort, { once: true });
      const take = (name) => (chunk) => {
        if (truncated) return;
        bytes += chunk.length;
        if (bytes > maxBytes) { truncated = true; killGroup(child); return; }
        const st = streams[name];
        const out = st.s.push(st.d.write(chunk));
        if (out) onText(out, name);
      };
      child.stdout.on('data', take('out'));
      child.stderr.on('data', take('err'));
      const finish = (result) => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearTimeout(grace); signal?.removeEventListener('abort', onAbort);
        killGroup(child); // anything left in the group (a grandchild holding the pipes) goes too
        child.stdout.destroy(); child.stderr.destroy();
        for (const name of ['out', 'err']) { const st = streams[name]; const rest = st.s.push(st.d.end()) + st.s.flush(); if (rest) onText(rest, name); }
        children.delete(entry); markDone();
        const error = aborted ? 'stopped' : timedOut ? `timed out after ${timeoutMs} ms` : truncated ? `output over ${maxBytes} bytes: stopped` : result.error;
        resolve({ truncated, timedOut, ...(aborted ? { stopped: true } : {}), ...result, ...(error ? { error } : {}) });
      };
      child.on('error', (e) => finish({ exitCode: 1, error: scrub.clean(e.code === 'ENOENT' ? 'pingcli binary not found' : e.message) }));
      // 'close' waits for the pipes; a grandchild could hold them open, so the run ends graceMs after the child exits.
      child.on('exit', (code) => { grace = setTimeout(() => finish({ exitCode: typeof code === 'number' ? code : 1 }), graceMs); });
      child.on('close', (code) => finish({ exitCode: typeof code === 'number' ? code : 1 }));
    });
  }

  const configArgs = () => ['--config', path.join(ensureDir(), 'config.yaml')];

  // `pingcli pingone auth login` once per Real session; concurrent callers share it. A caller that is aborted stops
  // waiting at once; when every waiter is gone the login child is killed. A failure lets the next call retry.
  function ensureAuth(signal, myGen) {
    let created = false;
    // A login whose waiters all left has been aborted; a caller arriving now gets a fresh one instead of its 'stopped'.
    if (!boot || boot.gen !== myGen || boot.ctl.signal.aborted) {
      ensureDir();
      const b = { gen: myGen, ctl: new AbortController(), waiters: 0 };
      let text = '';
      b.promise = runChild([...configArgs(), 'pingone', 'auth', 'login'], { onText: (t) => { text += t; }, signal: b.ctl.signal, myGen }).then((r) => {
        if (r.exitCode === 0) return { ok: true };
        if (boot === b) boot = null;
        return r.stopped ? { ok: false, stopped: true } : { ok: false, error: (text.trim() || r.error || 'auth login failed').slice(0, 4000) };
      });
      boot = b;
      created = true;
    }
    const b = boot;
    b.waiters += 1;
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => { if (done) return; done = true; b.waiters -= 1; signal?.removeEventListener('abort', onAbort); resolve(v); };
      const onAbort = () => { settle({ ok: false, stopped: true }); if (b.waiters === 0) b.ctl.abort(); };
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      b.promise.then((r) => settle(r.ok ? { ok: true, fresh: created } : r));
    });
  }

  async function run(cmd, { onText = () => {}, signal } = {}) {
    const myGen = gen;
    const ended = () => signal?.aborted || myGen !== gen;
    const authArgv = ['pingcli', '--config', '<private>/config.yaml', 'pingone', 'auth', 'login'];
    if (ended()) return { ...STOPPED, auth: null, argv: [] };
    let auth = null;
    if (cmd.auth) {
      auth = await ensureAuth(signal, myGen);
      if (auth.stopped || ended()) return { ...STOPPED, auth: null, argv: authArgv };
      if (!auth.ok) {
        onText(`pingcli auth bootstrap failed:\n${auth.error}\n`, 'err');
        return { exitCode: 1, auth, argv: authArgv };
      }
    }
    if (ended()) return { ...STOPPED, auth, argv: [] }; // nothing below may run once the session or the caller is gone
    // Fixed, read-only invocation: the lab prints the live evidence dataset as JSON. A caller never supplies a URI.
    const args = ['pingone', 'api', `environments/${cfg.envId}`, '-O', 'json'];
    const base = ensureDir();
    const full = [...configArgs(), ...args];
    try {
      const r = await runChild(full, { onText, signal, myGen });
      return { ...r, auth, argv: ['pingcli', ...full.map((a) => (a.startsWith(base) ? `<private>${a.slice(base.length)}` : a))] };
    } finally { /* no sandbox dirs in this lab */ }
  }

  // One --version per session, shared by concurrent callers; an error is not cached.
  function version() {
    if (versionCache && versionCache.gen === gen) return versionCache.promise;
    const myGen = gen;
    ensureDir();
    let text = '';
    const promise = runChild(['--version'], { onText: (t) => { text += t; }, myGen }).then((r) => {
      const m = /pingcli version (\S+)/.exec(text);
      if (m) return { version: m[1] };
      if (versionCache?.promise === promise) versionCache = null;
      return { error: r.error === 'pingcli binary not found' ? 'pingcli binary not installed' : 'unable to determine pingcli version' };
    });
    versionCache = { gen: myGen, promise };
    return promise;
  }

  // Ends the session: no run of it spawns again, every child is killed and awaited, then the private dir is removed.
  async function dispose() {
    gen += 1;
    versionCache = null;
    boot?.ctl.abort();
    boot = null;
    const d = dir;
    dir = null;
    const pending = [...children].map((e) => { killGroup(e.child); return e.done; });
    await Promise.race([Promise.all(pending), new Promise((r) => { setTimeout(r, 3000).unref(); })]);
    if (d) fs.rmSync(d, { recursive: true, force: true });
  }

  // For process exit, where nothing async runs: kill every group, remove the dir.
  function disposeSync() {
    gen += 1;
    for (const e of children) killGroup(e.child);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null; boot = null; versionCache = null;
  }

  return { run, version, dispose, disposeSync, get dir() { return dir; }, get liveChildren() { return children.size; } };
}
