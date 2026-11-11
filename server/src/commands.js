// The dataset allow-list: the same eight datasets as the Privilege OWASP coverage story. No caller-supplied path, query
// or filter is ever read: a caller sends only a key, the datasets are fixed here, and Mock serves them in-process.
// In Real, the read-only PingOne calls are issued by realRunner with fixed arguments, never a caller-supplied URI.
export const KEY_RE = /^[a-z][a-z0-9-]{0,39}$/;

const DEFS = {
  'coverage-table': { title: 'The coverage table', category: 'Overview', auth: true, runnable: true, mock: 'coverage-table', kind: 'table' },
  asi01: { title: 'ASI01: Agent Goal Hijack', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi02: { title: 'ASI02: Tool Misuse and Exploitation', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi03: { title: 'ASI03: Identity and Privilege Abuse', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi04: { title: 'ASI04: Agentic Supply Chain', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi05: { title: 'ASI05: Unexpected Code Execution', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi06: { title: 'ASI06: Memory and Context Poisoning', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi07: { title: 'ASI07: Insecure Inter-Agent Communication', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi08: { title: 'ASI08: Cascading Agent Failures', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi09: { title: 'ASI09: Human-Agent Trust Exploitation', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  asi10: { title: 'ASI10: Rogue Agents', category: 'The ten categories', auth: true, runnable: true, mock: 'category', kind: 'form' },
  'two-layers': { title: 'Gateway vs AIGuard', category: 'Overview', auth: true, runnable: true, mock: 'two-layers', kind: 'form' },
  'live-evidence': { title: 'Live evidence (Real)', category: 'Overview', auth: true, runnable: true, mock: 'live-evidence', kind: 'table' },
};

// A frozen, prototype-free table, so `__proto__`, `constructor` and friends are never a dataset.
export const DATASETS = Object.freeze(Object.assign(Object.create(null), DEFS));
export const DATASET_KEYS = Object.freeze(Object.keys(DEFS));

// What the caller is told: { dataset } or { error, status, ... }. Never echoes a key that is not a plain key.
export function lookupDataset(raw, table = DATASETS) {
  if (raw === undefined || raw === null || raw === '') return { status: 400, error: 'missing_dataset_key' };
  if (typeof raw !== 'string' || !KEY_RE.test(raw)) return { status: 400, error: 'unknown_dataset' };
  if (!Object.hasOwn(table, raw)) return { status: 400, error: 'unknown_dataset' };
  return { key: raw, ds: table[raw] };
}

export const lookupCommand = lookupDataset; // the API routes still speak of commandKey
export const COMMANDS = DATASETS;
export const COMMAND_KEYS = DATASET_KEYS;

// The label is exactly what the browser card shows. In Mock it is a dataset key; the Real runner never takes one.
export const labelFor = (ds) => `privilege-owasp dataset ${ds.mock === 'category' ? 'category' : ds.mock === 'table' || ds.mock === 'two-layers' || ds.mock === 'live-evidence' ? 'overview' : ds.mock}`;

// The setup steps a person needs before this dataset's evidence is meaningful: what the deck is, how the lab reads it.
export function buildPrereqs(ds, { source = 'mock' } = {}) {
  const mock = source === 'mock';
  return [
    {
      title: 'The source deck',
      command: 'Privilege Capability Overview, page 21 (2 Nov 2026)',
      note: mock ? 'Mock: the wording below is the deck wording, served from this lab.' : 'The wording stays the deck wording; Real adds live evidence beside it.',
    },
    {
      title: 'How the claims are labelled',
      command: 'static wording + live evidence',
      note: 'Coverage claims are the deck\'s; explanations are this lab\'s summaries; the gaps are stated, never hidden.',
    },
    ds.auth ? {
      title: 'Authenticate (Real only)',
      command: 'worker client credentials, read-only',
      note: mock ? 'Mock: simulated token request (no network).' : 'Gets a worker access token, non-interactive with client credentials; run once per Real session.',
    } : null,
    { title: 'Run dataset', command: labelFor(ds), note: mock ? 'Mock data appears below.' : 'Live evidence appears below the static claims.' },
  ].filter(Boolean);
}
