import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { validateDemos } from './lib/shelf-registry-rules.mjs';

// The shelf's own rules (vendored from demo-shelf-LAB origin/main with its tag list), so an entry the shelf would
// refuse at start-up fails here first: description and name up to 300 characters, tags from data/tags.json, origin url.
const read = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const entry = JSON.parse(read('../docs/shelf-entry.json'));
// The shelf resolves a relative composeFile from its demo root; any absolute root stands in for it here.
const DEMO_ROOT = '/demo-root';
const tagIds = new Set(JSON.parse(read('./lib/shelf-tags.json')).groups.flatMap((g) => g.tags.map((t) => t.id)));

test('docs/shelf-entry.json passes the shelf registry rules, with tags checked against the shelf tag list', () => {
  assert.doesNotThrow(() => validateDemos(entry.demos, { tagIds, demoRoot: DEMO_ROOT }), (e) => e.errors?.join('; '));
  const [d] = entry.demos;
  assert.ok(d.description.length <= 300, `description is ${d.description.length} characters`);
  assert.deepEqual(d.tags, ['pingone-privilege', 'ai-agent-security', 'agent-identity', 'authorization-policy', 'learning', 'simulated', 'real']);
  assert.equal(d.repo, 'https://github.com/curtismu7/privilege-owasp-lab-LAB', 'the repo field stays in the repo copy');
});

test('the vendored rules refuse what the shelf refused: an over-long description and unknown tags', () => {
  const [d] = entry.demos;
  const errors = (demo) => { try { validateDemos([demo], { tagIds, demoRoot: DEMO_ROOT }); return []; } catch (e) { return e.errors || [String(e)]; } };
  assert.match(errors({ ...d, description: 'x'.repeat(301) }).join('\n'), /up to 300 characters/);
  assert.match(errors({ ...d, tags: ['pingcli', 'automation'] }).join('\n'), /unknown tags "pingcli", "automation"/);
  assert.match(errors({ ...d, url: 'http://evil.example:7811' }).join('\n'), /not loopback/);
});
