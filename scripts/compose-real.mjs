#!/usr/bin/env node
// Docker with Real settings: passes the four PINGONE_* settings from ~/Development/.env (or the file STANDALONE_ENV
// names; a non-empty value already in your shell wins) to `docker compose` through the child's environment only.
// Never prints a value, never writes one to disk or into the repo. Prints which of the four keys are set.
//   node scripts/compose-real.mjs up --build -d          (any docker compose arguments)
//   node scripts/compose-real.mjs --dry-run               (only report which keys are set)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTING_KEYS, settingsFilePath, settingsFrom } from '../server/src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The environment for `docker compose`: the parent's, plus the four settings. Exported for tests.
export function composeEnv(parent = process.env, file = settingsFilePath(parent)) {
  const settings = settingsFrom(parent, file);
  const env = { ...parent };
  for (const k of SETTING_KEYS) env[k] = settings[k];
  return { env, set: SETTING_KEYS.filter((k) => settings[k]) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const { env, set } = composeEnv();
  console.log(`[compose-real] Real settings present: ${set.length ? set.join(', ') : 'none'} (values not shown)${set.length < SETTING_KEYS.length ? ' -- the lab will start in Mock' : ''}`);
  if (args[0] === '--dry-run') process.exit(0);
  const child = spawn('docker', ['compose', ...args], { cwd: ROOT, env, stdio: 'inherit', shell: false });
  child.on('exit', (code) => process.exit(code ?? 1));
}
