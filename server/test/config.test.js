import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REGION_DOMAINS, binaryFrom, modeFrom, readSettingsFile, realConfigFrom, realProblemFrom, settingsFrom, settingsFilePath } from '../src/config.js';
import { FAKE, newTmpRoot, stubBin } from './helpers.js';

// Per-test temp dirs (pclt- prefix), removed after the run.
const made = [];
const tmp = () => { const d = newTmpRoot(); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

test('MODE: Real when configured, else Mock; only mock/real accepted; Real without config is refused, never a silent fallback', () => {
  assert.equal(modeFrom({}, false), 'mock');
  assert.equal(modeFrom({}, true), 'real');
  assert.equal(modeFrom({ MODE: '' }, true), 'real');
  assert.equal(modeFrom({ MODE: 'mock' }, true), 'mock');
  assert.throws(() => modeFrom({ MODE: 'real' }, false), /not configured/);
  for (const MODE of ['live', 'Mock', 'x']) assert.throws(() => modeFrom({ MODE }, true), /not available/, MODE);
});

test('region maps to the pingcli rootDomain; an unknown region is refused, never guessed', () => {
  assert.deepEqual({ ...REGION_DOMAINS }, { NA: 'pingone.com', EU: 'pingone.eu', CA: 'pingone.ca', AP: 'pingone.asia', ASIA: 'pingone.asia', AU: 'pingone.com.au', SG: 'pingone.sg' });
  const bin = stubBin();
  for (const [region, domain] of Object.entries(REGION_DOMAINS)) assert.equal(realConfigFrom({ ...FAKE, PINGONE_REGION: region.toLowerCase() }, bin).rootDomain, domain);
  for (const bad of ['US', 'NA1', 'eu-west', 'pingone.com', '']) {
    assert.equal(realConfigFrom({ ...FAKE, PINGONE_REGION: bad }, bin), null, bad);
    assert.ok(realProblemFrom({ ...FAKE, PINGONE_REGION: bad }, bin), bad);
  }
});

test('Real problems name the missing setting or binary, never a value', () => {
  const bin = stubBin();
  assert.match(realProblemFrom({ ...FAKE, PINGONE_CLIENT_SECRET: '' }, bin), /PINGONE_CLIENT_SECRET/);
  assert.match(realProblemFrom({ ...FAKE, PINGONE_ENVIRONMENT_ID: 'not-a-uuid/../x' }, bin), /UUID/);
  assert.match(realProblemFrom({ ...FAKE, PINGONE_CLIENT_ID: 'a b"c' }, bin), /client id/);
  assert.match(realProblemFrom({ ...FAKE, PINGONE_CLIENT_SECRET: 'abc\ndef12345' }, bin), /control/);
  assert.match(realProblemFrom(FAKE, null), /pingcli binary/);
  assert.equal(realProblemFrom(FAKE, bin), null);
  for (const v of Object.values(FAKE)) for (const p of [realProblemFrom({ ...FAKE, PINGONE_REGION: 'XX' }, bin), realProblemFrom(FAKE, null)]) assert.ok(!p.includes(v) || v === 'NA', 'a value never appears in the reason');
});

test('settings: the file gives only the four PingOne keys; a non-empty env value wins; nothing is loaded into process.env', () => {
  const f = path.join(tmp(), '.env');
  fs.writeFileSync(f, ['# comment', `PINGONE_ENVIRONMENT_ID=${FAKE.PINGONE_ENVIRONMENT_ID}`, 'export PINGONE_REGION="EU"', `PINGONE_CLIENT_ID='${FAKE.PINGONE_CLIENT_ID}'`, 'PINGONE_CLIENT_SECRET=from-file-secret # trailing', 'OTHER_SECRET=nope'].join('\n'));
  const s = readSettingsFile(f);
  assert.deepEqual(Object.keys(s).sort(), ['PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET', 'PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION']);
  assert.equal(s.PINGONE_REGION, 'EU');
  assert.equal(s.PINGONE_CLIENT_SECRET, 'from-file-secret');
  assert.equal(process.env.OTHER_SECRET, undefined);
  assert.equal(settingsFrom({ PINGONE_REGION: 'CA' }, f).PINGONE_REGION, 'CA');
  assert.equal(settingsFrom({ PINGONE_REGION: '' }, f).PINGONE_REGION, 'EU');
  assert.deepEqual(readSettingsFile('/nonexistent/.env'), {});
  assert.equal(settingsFrom({}, null).PINGONE_CLIENT_SECRET, '');
  assert.equal(settingsFilePath({ STANDALONE_ENV: '/x/y.env', HOME: '/h' }), '/x/y.env');
  assert.equal(settingsFilePath({ HOME: '/h' }), path.join('/h', 'Development', '.env'));
});

test('binary: PINGCLI_BIN must be an absolute path to an executable file; else pingcli on PATH; else none', () => {
  const bin = stubBin();
  assert.equal(binaryFrom({ PINGCLI_BIN: bin }), bin);
  assert.equal(binaryFrom({ PINGCLI_BIN: 'relative/pingcli' }), null);
  assert.equal(binaryFrom({ PINGCLI_BIN: '/nonexistent/pingcli' }), null);
  const d = tmp();
  fs.writeFileSync(path.join(d, 'pingcli'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(binaryFrom({ PATH: `relative${path.delimiter}${d}` }), path.join(d, 'pingcli'));
  fs.chmodSync(path.join(d, 'pingcli'), 0o644);
  assert.equal(binaryFrom({ PATH: d }), null, 'not executable');
  assert.equal(binaryFrom({}), null);
});
