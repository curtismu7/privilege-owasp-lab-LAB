import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';

// env: the settings the app sees (never process.env, and settingsFile defaults to none), so a developer's real
// PingOne settings or ~/Development/.env can never reach a test.
// Every server gets its own temp root for Real's private dirs (fn's third argument), removed afterwards, so tests never
// share or leave privilege-owasp-lab-* dirs in the system temp dir.
export async function withServer(fn, { configFile = '/nonexistent/customer.config.json', env = {}, settingsFile = null, mockDelayMs = 0, runnerOptions = {}, commands } = {}) {
  const health = createHealth({ intervalMs: 3_600_000 });
  await health.ready;
  const tmpRoot = newTmpRoot();
  const app = createApp({ health, configFile, env, settingsFile, mockDelayMs, runnerOptions: { tmpRoot, ...runnerOptions }, ...(commands ? { commands } : {}) });
  const { server, url } = await startHttpServer({ port: 0, host: '127.0.0.1', app });
  try { await fn(url.replace(/\/$/, ''), app, tmpRoot); } finally {
    await app.locals.dispose(); health.stop(); server.closeAllConnections?.(); await new Promise((r) => server.close(r));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// A private temp root for one test (prefix pclt-, never the app's own privilege-owasp-lab- prefix).
export const newTmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pclt-'));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function waitDead(pid, ms = 3000) { for (let t = 0; t < ms && isAlive(pid); t += 50) await sleep(50); return !isAlive(pid); }

export const post = (url, path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

// Reads a whole SSE response into [{ event, data }].
export async function readSse(res) {
  const text = await res.text();
  return text.split('\n\n').filter((b) => b.trim()).map((b) => {
    const event = /^event: (.*)$/m.exec(b)?.[1];
    const data = /^data: (.*)$/m.exec(b)?.[1];
    return { event, data: data ? JSON.parse(data) : null, raw: b };
  });
}

// fetch cannot set Host; node:http can.
export function rawHttp(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, agent: false }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

// A FAKE binary for Real-mode tests (never a real tenant). `kind` picks a stub in test/fixtures.
// Test-only credentials: obviously fake values that never resemble a real tenant.
export const FAKE = Object.freeze({
  PINGONE_ENVIRONMENT_ID: '00000000-0000-4000-8000-0000000000e1',
  PINGONE_REGION: 'NA',
  PINGONE_CLIENT_ID: 'fake-client-id-0001',
  PINGONE_CLIENT_SECRET: 'FAKE-SECRET-do-not-leak-7f3a9c',
});
export function stubBin(kind = 'echo') {
  const p = fileURLToPath(new URL(`./fixtures/stub-powasp-${kind}.mjs`, import.meta.url));
  fs.chmodSync(p, 0o755);
  return p;
}
export const realEnv = (kind = 'echo', extra = {}) => ({ ...FAKE, PINGCLI_BIN: stubBin(kind), PATH: process.env.PATH, ...extra });
export async function waitFile(file, ms = 8000) { for (let t = 0; t < ms; t += 50) { if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8'); await sleep(50); } throw new Error(`timed out waiting for ${path.basename(file)}`); }
