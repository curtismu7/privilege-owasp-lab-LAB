import test from 'node:test';
import assert from 'node:assert/strict';
import { JSON_HIGHLIGHT_MAX_CHARS, buildReadableView, extractResultRows, flattenResultRow, parseJsonLoose, parsePingcliResults, tokenizeJson } from '../src/readable.js';

const envelope = (data, extra = {}) => JSON.stringify({ schemaVersion: '1.0', status: 'success', message: 'Read all successful', data, ...extra });

test('parseJsonLoose: plain JSON, JSON with CLI noise around it, and not-JSON', () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('notice: config loaded\n{"a":[1,2]}\ntrailing'), { a: [1, 2] });
  assert.deepEqual(parseJsonLoose('x [1,2] y'), [1, 2]);
  for (const bad of ['', 'Valid Keys:\n- a', '{oops', '}{', null, 42, undefined]) assert.equal(parseJsonLoose(bad), null, String(bad));
});

test('extractResultRows: data array, data._embedded, root _embedded; null otherwise', () => {
  assert.deepEqual(extractResultRows([1]), [1]);
  assert.deepEqual(extractResultRows({ data: [{ id: 1 }] }), [{ id: 1 }]);
  assert.deepEqual(extractResultRows({ data: { _embedded: { users: [{ id: 'u' }] } } }), [{ id: 'u' }]);
  assert.deepEqual(extractResultRows({ _embedded: { groups: [{ id: 'g' }] } }), [{ id: 'g' }]);
  assert.equal(extractResultRows({ foo: 'bar' }), null);
  assert.equal(extractResultRows({ data: null }), null);
  assert.equal(extractResultRows(null), null);
});

test('flattenResultRow: primitives kept, _links and nested dropped, name.formatted promoted, prototype keys ignored', () => {
  assert.deepEqual(flattenResultRow({ _links: { self: {} }, id: 'u', enabled: false, n: null, name: { formatted: 'Ava L', given: 'Ava' }, population: { id: 'p' } }), { id: 'u', enabled: false, n: null, name: 'Ava L' });
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"id":"x"}');
  const flat = flattenResultRow(hostile);
  assert.deepEqual(flat, { id: 'x' });
  assert.equal({}.polluted, undefined);
  assert.deepEqual(flattenResultRow(null), {});
  assert.deepEqual(flattenResultRow([1, 2]), {});
});

test('parsePingcliResults: envelope -> preferred columns, capped at 6, status carried through', () => {
  const r = parsePingcliResults(envelope([{ _links: {}, id: 'env-1', name: 'Prod', region: 'NA', type: 'PRODUCTION', license: { id: 'l' } }, { id: 'env-2', name: 'Dev', region: 'NA', type: 'SANDBOX' }]));
  assert.equal(r.status, 'success');
  assert.deepEqual(r.columns, ['id', 'name', 'type', 'region']);
  assert.deepEqual(r.rows[0], { id: 'env-1', name: 'Prod', region: 'NA', type: 'PRODUCTION' });
  const wide = parsePingcliResults(envelope([{ name: 'a', id: '1', type: 't', region: 'NA', enabled: true, description: 'd', extra1: 'x', extra2: 'y' }]));
  assert.deepEqual(wide.columns, ['id', 'name', 'type', 'region', 'enabled', 'description']);
  assert.equal(parsePingcliResults('Valid Keys:\n- auth.storage.type'), null);
  assert.equal(parsePingcliResults(JSON.stringify({ foo: 'bar' })), null);
  const err = parsePingcliResults(JSON.stringify({ status: 'error', message: '', data: [] }));
  assert.equal(err.status, 'error');
  assert.deepEqual(err.rows, []);
});

test('buildReadableView: table for lists, form for one object, summary for nothing flattenable, null for text', () => {
  assert.equal(buildReadableView(envelope([{ id: '1', name: 'A' }])).kind, 'table');
  const form = buildReadableView(JSON.stringify({ status: 'success', data: { id: 'e', name: 'Env', nested: { x: 1 } } }));
  assert.equal(form.kind, 'form');
  assert.deepEqual(form.fields, [{ key: 'id', value: 'e' }, { key: 'name', value: 'Env' }]);
  assert.deepEqual(buildReadableView(JSON.stringify({ a: 'b', n: null })).fields, [{ key: 'a', value: 'b' }, { key: 'n', value: '' }]);
  const summary = buildReadableView(JSON.stringify({ nested: { deep: true } }));
  assert.deepEqual(summary.fields, [{ key: 'type', value: 'object' }]);
  assert.equal(summary.message, 'Structured JSON');
  assert.equal(buildReadableView('pingcli version 1.2.0'), null);
});

test('tokenizeJson: classes per token, text round-trips, plain text is null, large payloads are one plain token', () => {
  const toks = tokenizeJson('{"a":"x","n":1.5,"t":true,"z":null}');
  assert.equal(toks.map((t) => t.text).join(''), JSON.stringify({ a: 'x', n: 1.5, t: true, z: null }, null, 2));
  assert.deepEqual(toks.filter((t) => t.cls).map((t) => t.cls), ['j-key', 'j-str', 'j-key', 'j-num', 'j-key', 'j-bool', 'j-key', 'j-null']);
  assert.equal(tokenizeJson('not json'), null);
  assert.equal(tokenizeJson('{"a":'), null);
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `g-${i}`, description: 'x'.repeat(200) }));
  const big = tokenizeJson(JSON.stringify({ data: { _embedded: { groups: rows } } }));
  assert.equal(big.length, 1);
  assert.equal(big[0].cls, null);
  assert.ok(big[0].text.length > JSON_HIGHLIGHT_MAX_CHARS);
  assert.equal(JSON_HIGHLIGHT_MAX_CHARS, 8000, 'the cap AI-DEMO2 measured; do not raise without a measurement');
  const markup = tokenizeJson('{"x":"<img src=x onerror=alert(1)>"}');
  assert.ok(markup.some((t) => t.text === '"<img src=x onerror=alert(1)>"' && t.cls === 'j-str'), 'markup stays a text token for the renderer to escape');
});

test('hostile input is bounded: deep nesting and huge strings do not throw', () => {
  const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`;
  assert.doesNotThrow(() => buildReadableView(deep));
  assert.doesNotThrow(() => tokenizeJson(deep));
  const huge = JSON.stringify({ data: [{ name: 'x'.repeat(200_000) }] });
  assert.equal(buildReadableView(huge).rows.length, 1);
  assert.equal(tokenizeJson(huge).length, 1);
});

test('BLOCKING fix: 50000-deep JSON never throws; it is not treated as structured, so the page shows raw text', async () => {
  const { MAX_JSON_DEPTH, jsonDepthOver } = await import('../src/readable.js');
  const deep = `${'['.repeat(50000)}${']'.repeat(50000)}`;
  assert.doesNotThrow(() => JSON.parse(deep), 'JSON.parse copes');
  assert.throws(() => JSON.stringify(JSON.parse(deep), null, 2), RangeError, 'stringify overflows: why the guard exists');
  assert.equal(tokenizeJson(deep), null);
  assert.equal(buildReadableView(deep), null);
  assert.equal(parseJsonLoose(deep), null);
  assert.equal(parsePingcliResults(deep), null);
  const deepObj = `{"data":${'{"a":'.repeat(50000)}1${'}'.repeat(50000)}}`;
  for (const f of [tokenizeJson, buildReadableView, parseJsonLoose]) assert.doesNotThrow(() => f(deepObj));
  assert.equal(buildReadableView(`noise ${deep} noise`), null, 'the loose slice is bounded too');
  // The limit is a depth, not a size: a wide, shallow list still works.
  const wide = JSON.stringify({ data: Array.from({ length: 20000 }, (_, i) => ({ id: i })) });
  assert.equal(buildReadableView(wide).rows.length, 20000);
  const ok = `${'['.repeat(MAX_JSON_DEPTH - 1)}${']'.repeat(MAX_JSON_DEPTH - 1)}`;
  assert.notEqual(tokenizeJson(ok), null, 'just under the limit still highlights');
  assert.equal(jsonDepthOver(JSON.parse(ok)), false);
});
