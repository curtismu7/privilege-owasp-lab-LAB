import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS } from '../src/cast.js';
import { COMMAND_KEYS } from '../src/commands.js';
import { MOCK_VERSION, mockChunks, mockEnvId, mockOutput, mockUuid } from '../src/mockOutput.js';
import { buildReadableView } from '../src/readable.js';
import { scanHosts, scanKeys } from '../src/safety.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('every dataset has deterministic Mock output in every vertical, with only .example hosts and no keys', () => {
  for (const [name, cast] of Object.entries(VERTICALS)) {
    for (const k of COMMAND_KEYS) {
      const a = mockOutput(k, cast); const b = mockOutput(k, cast);
      assert.equal(a.text, b.text, `${name}/${k} deterministic`);
      assert.equal(a.exitCode, 0);
      assert.ok(a.text.length > 0);
      assert.deepEqual(scanHosts(a.text), [], `${name}/${k} hosts`);
      assert.deepEqual(scanKeys(a.text), []);
    }
  }
  assert.throws(() => mockOutput('__proto__', VERTICALS.retail));
});

test('the coverage table dataset: ten rows, two gaps stated, the ASI08 footnote, and it becomes a table', () => {
  const cast = VERTICALS.banking;
  const j = JSON.parse(mockOutput('coverage-table', cast).text);
  assert.equal(j.schemaVersion, '1.1'); assert.equal(j.status, 'success');
  const rows = j.data.rows;
  assert.equal(rows.length, 10);
  for (const r of rows) assert.match(r.id, /^ASI\d\d$/);
  assert.equal(rows.filter((r) => r.state === 'gap stated').length, 2);
  assert.deepEqual(rows.filter((r) => r.state === 'gap stated').map((r) => r.id), ['ASI04', 'ASI06']);
  assert.match(j.data.footnote, /ASI08.*observability stack/);
  const view = buildReadableView(mockOutput('coverage-table', cast).text);
  assert.equal(view.kind, 'table'); assert.equal(view.rows.length, 10);
});

test('category datasets are key/value forms with the threat, the coverage and, for the gaps, the stated remainder', () => {
  const cast = VERTICALS.healthcare;
  for (const k of COMMAND_KEYS.filter((k) => /^asi\d\d$/.test(k))) {
    const j = JSON.parse(mockOutput(k, cast).text);
    const fields = j.data.fields;
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
    assert.match(byKey.category, new RegExp(`^${k.toUpperCase()} - `));
    assert.ok(['COVERED', 'GAP STATED'].includes(byKey.status), k);
    assert.ok(byKey['the threat'].length > 80, `${k} explains the threat`);
    assert.ok(byKey['how privilege covers it'].length > 20, `${k} says how`);
    const view = buildReadableView(mockOutput(k, cast).text);
    assert.equal(view.kind, 'form');
  }
  const asi04 = Object.fromEntries(JSON.parse(mockOutput('asi04', cast).text).data.fields.map((f) => [f.key, f.value]));
  assert.match(asi04['stated gap'], /fingerprint pinning is pending/i);
  const asi06 = Object.fromEntries(JSON.parse(mockOutput('asi06', cast).text).data.fields.map((f) => [f.key, f.value]));
  assert.match(asi06['stated gap'], /gateway integration is in progress/i);
  const asi03 = Object.fromEntries(JSON.parse(mockOutput('asi03', cast).text).data.fields.map((f) => [f.key, f.value]));
  assert.equal(asi03['stated gap'], undefined, 'full-coverage categories carry no gap field');
});

test('two-layers and live-evidence datasets render; the version is the static deck id, not a pingcli version', () => {
  const cast = VERTICALS.retail;
  assert.equal(buildReadableView(mockOutput('two-layers', cast).text).kind, 'form');
  const live = JSON.parse(mockOutput('live-evidence', cast).text);
  assert.ok(live.data.rows.length >= 4);
  assert.match(mockOutput('two-layers', cast).text, /A2A chokepoint/);
  assert.equal(buildReadableView(mockOutput('live-evidence', cast).text).kind, 'table');
  assert.equal(MOCK_VERSION, 'static-deck-2026-11-02');
});

test('verticals differ; mock UUIDs are stable and v4-shaped; chunks rejoin exactly', () => {
  assert.notEqual(mockOutput('live-evidence', VERTICALS.retail).text, mockOutput('live-evidence', VERTICALS.banking).text);
  assert.equal(mockUuid('a', 1), mockUuid('a', 1));
  assert.match(mockEnvId(VERTICALS.retail), UUID);
  const text = mockOutput('coverage-table', VERTICALS.banking).text;
  const chunks = mockChunks(text);
  assert.ok(chunks.length > 1, 'a table streams in several chunks');
  assert.equal(chunks.join(''), text, 'chunks rejoin byte for byte');
  assert.deepEqual(mockChunks('short\n'), ['short\n'], 'short text is one chunk');
});
