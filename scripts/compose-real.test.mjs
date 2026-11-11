import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { composeEnv } from './compose-real.mjs';

const FAKE = 'PINGONE_ENVIRONMENT_ID=00000000-0000-4000-8000-0000000000e1\nPINGONE_REGION=EU\nPINGONE_CLIENT_ID=fake-client-id-0002\nPINGONE_CLIENT_SECRET=FAKE-compose-secret-91b2\nOTHER=nope\n';

test('compose-real: only the four keys come from the settings file; a shell value wins; nothing else is added', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pclt-compose-'));
  try {
    const f = path.join(dir, 'settings.env');
    fs.writeFileSync(f, FAKE);
    const { env, set } = composeEnv({ PATH: '/bin', PINGONE_REGION: 'CA' }, f);
    assert.deepEqual(set, ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET']);
    assert.equal(env.PINGONE_REGION, 'CA');
    assert.equal(env.PINGONE_CLIENT_SECRET, 'FAKE-compose-secret-91b2');
    assert.equal(env.OTHER, undefined);
    assert.equal(env.PATH, '/bin');
    // The CLI prints key names only, never a value, and writes nothing.
    const before = fs.readdirSync(dir);
    const out = execFileSync(process.execPath, [new URL('./compose-real.mjs', import.meta.url).pathname, '--dry-run'], { env: { PATH: process.env.PATH, STANDALONE_ENV: f, HOME: dir }, encoding: 'utf8' });
    assert.match(out, /PINGONE_ENVIRONMENT_ID, PINGONE_REGION, PINGONE_CLIENT_ID, PINGONE_CLIENT_SECRET \(values not shown\)/);
    for (const v of ['FAKE-compose-secret-91b2', 'fake-client-id-0002', '00000000-0000-4000-8000-0000000000e1']) assert.ok(!out.includes(v));
    assert.deepEqual(fs.readdirSync(dir), before);
    const none = execFileSync(process.execPath, [new URL('./compose-real.mjs', import.meta.url).pathname, '--dry-run'], { env: { PATH: process.env.PATH, STANDALONE_ENV: path.join(dir, 'missing.env'), HOME: dir }, encoding: 'utf8' });
    assert.match(none, /none \(values not shown\) -- the lab will start in Mock/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
