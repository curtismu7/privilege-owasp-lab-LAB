// The hop catalog this lab enriches its hops with: the shared catalog, vendored from AI-DEMO-Standalone
// shared/hop-detail (src/vendor/hop-catalog.json), which holds this lab's four hop kinds.
import fs from 'node:fs';
import { enrichHop, validateHop } from './vendor/hopDetail.mjs';

export const CATALOG = Object.freeze(JSON.parse(fs.readFileSync(new URL('./vendor/hop-catalog.json', import.meta.url), 'utf8')));
export const LAB_KINDS = ['powasp-read-request', 'powasp-fetch', 'powasp-auth', 'powasp-management-api'];

// Mock keeps MOCK tokens raw (teaching); Real redacts tokens. Secrets are write-only in both.
export const enrichRunHops = (hops, source) => hops.map((h) => enrichHop(h, CATALOG, {}, { tokens: source === 'mock' ? 'raw' : 'redact' }));
export const hopProblems = (hops, source) => hops.flatMap((h) => validateHop(h, CATALOG, { tokens: source === 'mock' ? 'raw' : 'redact' }).map((p) => `hop ${h.n}: ${p}`));
