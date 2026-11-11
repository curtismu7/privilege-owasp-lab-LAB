// Deployment configuration and the Mock/Real toggle (rule 19).
// Mock is fully offline and the default when Real is not configured. Real (owner-run) runs the real pingcli binary with
// worker client credentials from the one settings file (~/Development/.env, or STANDALONE_ENV) or from the process
// environment (Docker: compose passes them through from the shell). Only whether a setting is usable is ever reported:
// the client id and secret are write-only and never leave this module except into the private pingcli config file.
import fs from 'node:fs';
import path from 'node:path';

export const SETTING_KEYS = ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET'];

// PINGONE_REGION -> pingcli rootDomain. Anything else is refused, never guessed.
export const REGION_DOMAINS = Object.freeze({ NA: 'pingone.com', EU: 'pingone.eu', CA: 'pingone.ca', AP: 'pingone.asia', ASIA: 'pingone.asia', AU: 'pingone.com.au', SG: 'pingone.sg' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID = /^[A-Za-z0-9._-]{8,128}$/;

export const settingsFilePath = (env = process.env) => env.STANDALONE_ENV || path.join(env.HOME || '', 'Development', '.env');

// Reads ONLY the four PingOne keys from a dotenv file. Never loads the file into process.env, never logs a value.
export function readSettingsFile(file) {
  const out = {};
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !SETTING_KEYS.includes(m[1])) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

// The effective settings: a non-empty process env value wins over the file.
export function settingsFrom(env = process.env, file = settingsFilePath(env)) {
  const fromFile = file ? readSettingsFile(file) : {};
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, env[k] ? String(env[k]) : (fromFile[k] || '')]));
}

// Is a pingcli binary there? PINGCLI_BIN (an absolute path to an executable file) or `pingcli` on PATH.
export function binaryFrom(env = process.env) {
  const exe = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };
  if (env.PINGCLI_BIN) return path.isAbsolute(env.PINGCLI_BIN) && exe(env.PINGCLI_BIN) ? env.PINGCLI_BIN : null;
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (dir && path.isAbsolute(dir) && exe(path.join(dir, 'pingcli'))) return path.join(dir, 'pingcli');
  }
  return null;
}

// Why Real is unavailable, in words the toggle's tooltip can show (never a value). null when Real is usable.
export function realProblemFrom(settings, bin) {
  const missing = SETTING_KEYS.filter((k) => !settings[k]);
  if (missing.length) return `Real needs ${missing.join(', ')} in ~/Development/.env (or STANDALONE_ENV, or the Docker environment). Mock keeps working.`;
  if (!UUID.test(settings.PINGONE_ENVIRONMENT_ID)) return 'PINGONE_ENVIRONMENT_ID must be a UUID. Mock keeps working.';
  if (!Object.hasOwn(REGION_DOMAINS, settings.PINGONE_REGION.toUpperCase())) return `PINGONE_REGION must be one of ${Object.keys(REGION_DOMAINS).join(', ')}. Mock keeps working.`;
  if (!CLIENT_ID.test(settings.PINGONE_CLIENT_ID)) return 'PINGONE_CLIENT_ID is not a plain client id. Mock keeps working.';
  if (settings.PINGONE_CLIENT_SECRET.length < 8 || /[\u0000-\u001f\u007f]/.test(settings.PINGONE_CLIENT_SECRET)) return 'PINGONE_CLIENT_SECRET is too short or has control characters. Mock keeps working.';
  if (!bin) return 'Real needs the pingcli binary: the Docker image bakes it; on the host set PINGCLI_BIN to its absolute path or put pingcli on PATH. Mock keeps working.';
  return null;
}

// Everything Real needs, or null. The returned object holds the secret: only realRunner.js may use it.
export function realConfigFrom(settings, bin) {
  if (realProblemFrom(settings, bin)) return null;
  return {
    bin,
    envId: settings.PINGONE_ENVIRONMENT_ID.toLowerCase(),
    region: settings.PINGONE_REGION.toUpperCase(),
    rootDomain: REGION_DOMAINS[settings.PINGONE_REGION.toUpperCase()],
    clientId: settings.PINGONE_CLIENT_ID,
    clientSecret: settings.PINGONE_CLIENT_SECRET,
  };
}

// The launch mode. Default: Real if configured, else Mock. The runtime mode (POST /api/mode) starts from this.
export function modeFrom(env, realAvailable) {
  if (env.MODE === undefined || env.MODE === '') return realAvailable ? 'real' : 'mock';
  const m = env.MODE;
  if (m !== 'mock' && m !== 'real') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: this app has mock and real modes`);
  if (m === 'real' && !realAvailable) throw new Error('MODE=real requested but Real is not configured (see GET /api/info realHowTo)');
  return m;
}
