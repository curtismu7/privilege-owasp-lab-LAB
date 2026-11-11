import test from 'node:test';
import assert from 'node:assert/strict';
import { isLoopbackHost, assertBindAllowed, bindHost, portProblem, resolvePort, isReservedHost, scanHosts, scanKeys, cleanText, hostCheck, sameOriginWrites } from '../src/safety.js';

test('loopback names', () => {
  for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]']) assert.ok(isLoopbackHost(h), h);
  for (const h of ['0.0.0.0', '192.168.1.5', 'example.com', 'localhost.evil.invalid']) assert.ok(!isLoopbackHost(h), h);
});

test('bind: loopback only unless POWASP_BIND is set', () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('127.0.0.1', {}), '127.0.0.1');
  assert.equal(assertBindAllowed('0.0.0.0', { POWASP_BIND: '0.0.0.0' }), '0.0.0.0');
});

test('ports: 7811 only, never a reserved or another app\'s one', () => {
  assert.equal(portProblem(7811), null);
  for (const p of [5000, 7720, 7800, 7805, 7807, 7700, 8080, 5173, 3900, 4000, 4400, 4510, 4600, 4601, 4840, 18080, 19080, 19090]) assert.ok(portProblem(p), String(p));
  assert.ok(portProblem(NaN));
  assert.equal(resolvePort({}), 7811);
  assert.equal(resolvePort({ PORT: '7811' }), 7811);
  assert.throws(() => resolvePort({ PORT: '7800' })); // observability-lab owns 7800
  assert.throws(() => resolvePort({ PORT: '7807' }));
});

test('reserved hosts and the host scan', () => {
  assert.ok(isReservedHost('a.b.invalid')); assert.ok(isReservedHost('mcp.northwind.example')); assert.ok(!isReservedHost('example.com'), 'the rulebook allows only .example and .invalid'); assert.ok(!isReservedHost('example.org')); assert.ok(!isReservedHost('sub.example.com'));
  assert.deepEqual(scanHosts('https://as.example.invalid/x and mail a@agent.example and http://localhost:7811/'), []);
  assert.deepEqual(scanHosts('authz warm (http://authz.example:9001)'), [], 'a URL in parentheses keeps its host clean');
  assert.deepEqual(scanHosts('authz warm (http://real-host.test:9001)'), ['real-host.test'], 'and a real host in parentheses is still caught');
  assert.deepEqual(scanHosts('https://example.com/mcp'), ['example.com']);
  assert.deepEqual(scanHosts('see https://real.com/x and 10.1.2.3'), ['10.1.2.3', 'real.com']);
});

test('key scan: only sk-MOCK- values are allowed in shipped text', () => {
  assert.deepEqual(scanKeys('sk-MOCK-ABCDEF and sk-MOCK-REAL-UPSTREAM-PLACEHOLDER'), []);
  assert.equal(scanKeys('key sk-proj-abcdefghijklmnop1234').length, 1);
  assert.equal(scanKeys('sk-ant-api03-abcdefghijkl').length, 1);
});

test('cleanText strips control and bidi characters and caps the length', () => {
  assert.equal(cleanText('a\u0000b\nc‮d', 80), 'a b c d');
  assert.equal(cleanText('x'.repeat(100), 10).length, 10);
  assert.equal(cleanText(undefined), '');
});

const run = (mw, req) => { const out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } }; mw(req, res, () => { out.next = true; }); return out; };

test('hostCheck refuses a non-loopback Host (DNS rebinding)', () => {
  assert.ok(run(hostCheck, { headers: { host: 'localhost:7811' } }).next);
  assert.ok(run(hostCheck, { headers: { host: '[::1]:7811' } }).next);
  assert.equal(run(hostCheck, { headers: { host: 'evil.example.invalid:7811' } }).status, 403);
  assert.equal(run(hostCheck, { headers: {} }).status, 403);
});

test('sameOriginWrites: GET passes, cross-origin and cross-site writes refused', () => {
  const h = { host: 'localhost:7811' };
  assert.ok(run(sameOriginWrites, { method: 'GET', headers: { ...h, origin: 'http://evil.example.invalid' } }).next);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: h }).next, 'no Origin (curl) is allowed');
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:7811' } }).next);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'http://localhost:9999' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'POST', headers: { ...h, origin: 'null' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'DELETE', headers: { ...h, 'sec-fetch-site': 'cross-site' } }).status, 403);
  assert.equal(run(sameOriginWrites, { method: 'PUT', headers: { ...h, 'sec-fetch-site': 'same-site' } }).status, 403);
  assert.ok(run(sameOriginWrites, { method: 'POST', headers: { ...h, 'sec-fetch-site': 'same-origin' } }).next);
});

test('a public origin is never same-origin: there is no hosted build, so only the request Host (or the proxy\'s X-Forwarded-Host) counts', () => {
  const post = (origin, extra = {}) => run(sameOriginWrites, { method: 'POST', headers: { host: '127.0.0.1:7811', origin, ...extra } });
  assert.equal(post('https://app.demo.example').status, 403);
  assert.equal(post('not a url').status, 403);
  assert.ok(post('http://127.0.0.1:7811').next);
});

test('X-Forwarded-Host is honoured only when it names a configured LAB_ALLOWED_HOSTS host', () => {
  const saved = process.env.LAB_ALLOWED_HOSTS;
  const post = (origin, extra = {}) => run(sameOriginWrites, { method: 'POST', headers: { host: 'pingcli-lab.proxy.example:7811', origin, ...extra } });
  try {
    delete process.env.LAB_ALLOWED_HOSTS;
    assert.equal(post('https://proxy.example:8443', { 'x-forwarded-host': 'proxy.example:8443' }).status, 403, 'not configured: ignored');
    assert.equal(post('https://evil.example', { 'x-forwarded-host': 'evil.example' }).status, 403, 'a client cannot make its own origin same-origin');
    process.env.LAB_ALLOWED_HOSTS = 'pingcli-lab.proxy.example,proxy.example';
    assert.ok(post('https://proxy.example:8443', { 'x-forwarded-host': 'proxy.example:8443' }).next, 'behind the shared lab-proxy');
    assert.equal(post('https://evil.example', { 'x-forwarded-host': 'evil.example' }).status, 403, 'still not for an unlisted name');
    assert.equal(post('https://proxy.example:8443', { 'x-forwarded-host': 'proxy.example:8443', 'sec-fetch-site': 'cross-site' }).status, 403);
  } finally { if (saved === undefined) delete process.env.LAB_ALLOWED_HOSTS; else process.env.LAB_ALLOWED_HOSTS = saved; }
});

test('sameOriginOnly applies the same check to GETs that start a process', async () => {
  const { sameOriginOnly } = await import('../src/safety.js');
  const get = (headers) => run(sameOriginOnly, { method: 'GET', headers: { host: '127.0.0.1:7811', ...headers } });
  assert.ok(get({}).next);
  assert.ok(get({ 'sec-fetch-site': 'same-origin' }).next);
  assert.ok(get({ 'sec-fetch-site': 'none' }).next);
  for (const h of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example' }, { origin: 'null' }]) assert.equal(get(h).status, 403, JSON.stringify(h));
});

test('review fixes: octets above 255 are not loopback; 4840 is reserved; control and bidi characters are stripped', async () => {
  assert.equal(isLoopbackHost('127.999.999.999'), false);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('127.255.255.255'), true);
  assert.ok(portProblem(4840));
  const { loadCast } = await import('../src/cast.js');
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pad-')), 'customer.config.json');
  fs.writeFileSync(f, JSON.stringify({ cast: { org: 'Acme\u202eevil' } }));
  assert.ok(!/\u202e/.test(loadCast(f).castOrg));
  assert.match(loadCast(f).castOrg, /^Acme/);
});

test('hostCheck: LAB_ALLOWED_HOSTS adds a name; a bad entry is refused', () => {
  const saved = process.env.LAB_ALLOWED_HOSTS;
  try {
    process.env.LAB_ALLOWED_HOSTS = 'pingcli-lab.local.example';
    assert.ok(run(hostCheck, { headers: { host: 'pingcli-lab.local.example:8443' } }).next);
    assert.equal(run(hostCheck, { headers: { host: 'other.local.example' } }).status, 403);
    process.env.LAB_ALLOWED_HOSTS = 'bad host!';
    assert.throws(() => run(hostCheck, { headers: { host: 'x' } }), /LAB_ALLOWED_HOSTS/);
  } finally { if (saved === undefined) delete process.env.LAB_ALLOWED_HOSTS; else process.env.LAB_ALLOWED_HOSTS = saved; }
});
