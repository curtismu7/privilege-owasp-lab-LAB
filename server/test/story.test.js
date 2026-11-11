import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CAST_TOKENS, DEFAULT_CAST, VERTICALS, fill, loadCast, unfilled } from '../src/cast.js';
import { buildStory, rawStory, renderTalkTrackMarkdown } from '../src/story.js';
import { DATASETS } from '../src/commands.js';
import { BANNER, FACTS, SCENARIOS } from '../src/storyData.js';
import { rawDiagram } from '../src/diagramData.js';

test('every {{token}} in the story and the diagram is defined in every vertical pack; three verticals', () => {
  assert.deepEqual(Object.keys(VERTICALS), ['banking', 'healthcare', 'retail']);
  const text = JSON.stringify([rawStory(), rawDiagram('coverage-flow')]);
  assert.ok(/\{\{cast/.test(text));
  for (const [name, cast] of Object.entries(VERTICALS)) {
    assert.deepEqual(unfilled(text, cast), [], name);
    for (const t of CAST_TOKENS) assert.equal(typeof cast[t], 'string', `${name}.${t}`);
  }
  assert.ok(!JSON.stringify(buildStory(DEFAULT_CAST)).includes('{{'));
});

test('an undefined token is caught', () => {
  assert.deepEqual(unfilled('Hello {{castOrg}} and {{castNope}}', DEFAULT_CAST), ['castNope']);
  assert.deepEqual(unfilled('{{seed}}', DEFAULT_CAST), ['seed'], 'only string cast tokens fill');
  assert.equal(fill('{{castNope}}', DEFAULT_CAST), '{{castNope}}');
});

test('docs/talk-track.md is exactly what the data generates (no drift)', () => {
  const doc = fs.readFileSync(new URL('../../docs/talk-track.md', import.meta.url), 'utf8');
  assert.equal(doc, renderTalkTrackMarkdown(DEFAULT_CAST));
});

test('scenarios name allow-listed datasets; facts carry a status, and observed ones name their AI-DEMO2 source', () => {
  assert.ok(SCENARIOS.length >= 5);
  for (const sc of SCENARIOS) assert.ok(Object.hasOwn(DATASETS, sc.commandKey), sc.id);
  const ok = new Set(['observed-in-AI-DEMO2', 'captured', 'UNVERIFIED', 'lab']);
  for (const f of FACTS) {
    assert.ok(ok.has(f.status), f.id);
    if (f.status === 'observed-in-AI-DEMO2') { assert.match(f.source, /^AI-DEMO2 [\w/.-]+$/); assert.match(f.text, /static in this lab|deck/); }
  }
});

test('the honesty banner is defined server-side for both modes and says what is simulated', () => {
  assert.match(BANNER.mock, /^MOCK: no PingOne tenant is contacted and nothing leaves this machine/);
  assert.match(BANNER.real, /^REAL: /);
  assert.match(BANNER.real, /write-only/);
  assert.match(BANNER.mock, /not an OWASP rating/);
});

test('the two stated gaps are labelled as gaps, never as full coverage', () => {
  const gapIds = ['asi04', 'asi06'];
  for (const id of gapIds) assert.equal(DATASETS[id].mock, 'category');
  const text = JSON.stringify(SCENARIOS) + JSON.stringify(FACTS);
  assert.match(text, /fingerprint pinning/);
  assert.match(text, /gateway integration is in progress/i);
});

test('customer.config can only set org, admin, envName and host, as short plain text with no URL or markup', () => {
  const file = new URL('../../.tmp-cast.json', import.meta.url).pathname;
  fs.writeFileSync(file, JSON.stringify({ cast: { org: 'Acme https://evil.example/x', admin: 'Pat Lee', envName: 'a@b.c', host: 'Bad Host!', seed: { users: [] }, other: 'x' } }));
  try {
    const cast = loadCast(file, 'banking');
    assert.equal(cast.castOrg, VERTICALS.banking.castOrg, 'an org with a URL is ignored');
    assert.equal(cast.castAdmin, 'Pat Lee');
    assert.equal(cast.castEnvName, VERTICALS.banking.castEnvName);
    assert.equal(cast.castHost, VERTICALS.banking.castHost);
    assert.equal(cast.seed, VERTICALS.banking.seed, 'the seed is never taken from the file');
  } finally { fs.rmSync(file, { force: true }); }
});
