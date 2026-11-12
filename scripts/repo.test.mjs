import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('the files the standalone rules ask for are present', () => {
  for (const f of ['README.md', 'CLAUDE.md', 'LICENSE', 'Dockerfile', 'docker-compose.yml', '.github/workflows/ci.yml', 'docs/talk-track.md', 'docs/safety.md', 'docs/shelf-entry.json', 'customer.config.example.json', 'content-pack.json', 'scripts/doctor.mjs', 'scripts/reset.mjs', 'scripts/check-no-ai-attribution.sh', 'scripts/check-ui-standard.sh', 'web/src/standalone-ui.css']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test('the shelf entry is valid and portable: relative composeFile, loopback url, health path', () => {
  const e = JSON.parse(read('docs/shelf-entry.json')).demos[0];
  assert.equal(e.id, 'privilege-owasp-lab');
  assert.equal(e.kind, 'Tester');
  assert.equal(e.healthPath, '/api/health');
  assert.match(e.url, /^http:\/\/localhost:7811$/);
  assert.equal(e.catalogId, 'D129', 'catalog id assigned by the owner');
  assert.equal(JSON.parse(read('content-pack.json')).demo.catalog, 'D129');
  assert.ok(!path.isAbsolute(e.composeFile), 'composeFile must be relative or a placeholder');
  assert.ok(!/\/Users\//.test(JSON.stringify(e)), 'no absolute home path');
});

test('customer.config.json is git-ignored, and its example only sets the four cast values', () => {
  assert.match(read('.gitignore'), /^customer\.config\.json$/m);
  assert.deepEqual(Object.keys(JSON.parse(read('customer.config.example.json')).cast).sort(), ['admin', 'envName', 'host', 'org']);
});

test('README declares the tier and the honest attributions; no leftover identity is left', () => {
  const readme = read('README.md');
  assert.match(readme, /^Tier: Tester\.$/m);
  assert.match(readme, /Scaffold copied from pingcli-LAB/);
  assert.match(readme, /Derived from the AI-DEMO2 \/privilege-owasp-top10 page \(read-only source, never imported\)/);
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json', 'README.md', 'CLAUDE.md', 'repo.test.mjs', 'lib', 'vendor', 'evidence']); // vendored copies are not ours to rename
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/pingcli-lab|PingCLI Lab|D126|7806/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  assert.deepEqual(hits.filter((h) => !/safety\.test\.js$/.test(h)), [], 'observability identity left in these files');
});

test('no shipped text names a real customer, company or tenant', () => {
  const skip = new Set(['node_modules', 'dist', '.git', 'package-lock.json', 'vendor', 'evidence', 'lib']); // vendored shared copies (their own repos scan them)
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (!['repo.test.mjs', 'story.test.js', 'content-pack.test.mjs'].some((n) => p.endsWith(n))) {
        const t = fs.readFileSync(p, 'utf8').toLowerCase();
        for (const w of ['united airlines', 'mileageplus', 'datapower', 'optum', 'unitedhealth', 'uhg', 'member benefit', 'personal-agent', 'personal agent']) if (t.includes(w)) hits.push(`${path.relative(root, p)}: ${w}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
