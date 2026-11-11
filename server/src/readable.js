// Pure helpers that turn pingcli output into the "easy read" view (a table for lists, a form for one object) and into
// highlighted JSON tokens. Shared by the server (doctor, tests) and the web page (step 2). No Node or DOM imports.
// Re-written from the helpers on the AI-DEMO2 /pingcli page (read-only source, never imported).

// Preferred column order for the results table. Only columns present in the data are used; remaining slots fill with
// the first other primitive fields found, up to MAX_COLUMNS.
export const PREFERRED_COLUMNS = ['id', 'name', 'threat', 'coveredBy', 'state', 'check', 'result', 'username', 'email', 'type', 'region', 'enabled', 'description', 'how'];
export const MAX_COLUMNS = 6;

// Cap for per-token JSON highlighting (history carried over from the AI-DEMO2 page). PingOne list payloads (users, groups,
// apps) routinely exceed this once pretty-printed with _links; colouring every token injects tens of thousands of React
// nodes and can crash the render so the terminal flashes then vanishes. Above the cap the JSON is still pretty-printed,
// but as a single text node.
//
// 8000 is empirically derived, not a guess. Do not raise it without a measurement. In AI-DEMO2 the cap was walked down
// twice for the same crash: introduced at 24000, then lowered 24000 -> 8000 because 24000 was NOT low enough (real list
// payloads still wiped the terminal). It was later raised to 40000 on the strength of a comment alone (no test, no
// measurement): 5x the value proven safe and 1.67x the value already proven insufficient, the same regression a third
// time, so it was reverted to 8000. The renderer is unchanged (still one element per token), so nothing about the
// original crash has been fixed; only the cap keeps it away.
export const JSON_HIGHLIGHT_MAX_CHARS = 8000;

const isObj = (v) => v !== null && typeof v === 'object';

// Deeper JSON than this is not "structured output" here: it is shown as raw text. JSON.parse copes with deep nesting, but
// JSON.stringify and any recursive walk overflow the stack (a 50000-deep array blanked the page in review), so every
// path that would recurse checks the depth first, with an iterative walk.
export const MAX_JSON_DEPTH = 200;
export function jsonDepthOver(value, limit = MAX_JSON_DEPTH) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (!isObj(v)) continue;
    if (d > limit) return true;
    for (const k of Object.keys(v)) stack.push([v[k], d + 1]);
  }
  return false;
}
// JSON.parse, then null when it is not JSON or too deep to treat as structured.
function parseBounded(text) {
  let v;
  try { v = JSON.parse(text); } catch { return undefined; }
  return jsonDepthOver(v) ? undefined : v;
}

// Parse JSON, tolerating CLI noise before or after a single object/array.
export function parseJsonLoose(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const whole = parseBounded(raw);
  if (whole !== undefined) return whole;
  const startObj = raw.indexOf('{');
  const startArr = raw.indexOf('[');
  let start = -1;
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) start = startObj;
  else if (startArr >= 0) start = startArr;
  if (start < 0) return null;
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (end <= start) return null;
  const inner = parseBounded(raw.slice(start, end + 1));
  return inner === undefined ? null : inner;
}

// Unwrap pingcli / management-API list payloads into a plain array: a top-level data array (environments list), else the
// first array under data._embedded or a root _embedded (pingone api). null when there is no list.
export function extractResultRows(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!isObj(parsed)) return null;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (isObj(parsed.data) && Array.isArray(parsed.data.rows)) return parsed.data.rows;
  const candidates = [];
  if (isObj(parsed.data) && isObj(parsed.data._embedded)) candidates.push(parsed.data._embedded);
  if (isObj(parsed._embedded)) candidates.push(parsed._embedded);
  for (const embedded of candidates) {
    const key = Object.keys(embedded).find((k) => Array.isArray(embedded[k]));
    if (key) return embedded[key];
  }
  return null;
}

// One list item for the table: primitives only; _links and other nested objects dropped; name.formatted promoted.
export function flattenResultRow(item) {
  const flat = {};
  if (!isObj(item) || Array.isArray(item)) return flat;
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith('_') || k === '__proto__') continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) { flat[k] = v; continue; }
    if (k === 'name' && isObj(v) && typeof v.formatted === 'string') flat.name = v.formatted;
  }
  return flat;
}

export function tableFromRows(dataRows, status = '', message = '') {
  const rows = dataRows.map(flattenResultRow);
  const present = new Set();
  for (const row of rows) for (const k of Object.keys(row)) present.add(k);
  const columns = PREFERRED_COLUMNS.filter((c) => present.has(c));
  for (const k of present) {
    if (columns.length >= MAX_COLUMNS) break;
    if (!columns.includes(k)) columns.push(k);
  }
  return { kind: 'table', status: String(status), message: String(message), columns: columns.slice(0, MAX_COLUMNS), rows };
}

// { status, message, columns, rows } for a list payload, else null.
export function parsePingcliResults(raw) {
  const parsed = parseJsonLoose(raw);
  if (!isObj(parsed)) return null;
  const dataRows = extractResultRows(parsed);
  if (!dataRows) return null;
  const { kind: _kind, ...table } = tableFromRows(dataRows, parsed.status || '', parsed.message || '');
  return table;
}

const formFields = (obj) => Object.entries(flattenResultRow(obj)).map(([key, value]) => ({ key, value: value === null || value === undefined ? '' : String(value) }));

// The easy-read model: { kind: 'table', ... } for lists, { kind: 'form', fields } for one object. null only for non-JSON.
export function buildReadableView(raw) {
  const parsed = parseJsonLoose(raw);
  if (!isObj(parsed)) return null;
  const status = parsed.status || '';
  const dataRows = extractResultRows(parsed);
  if (dataRows) return tableFromRows(dataRows, status, parsed.message || '');
  if (isObj(parsed.data) && Array.isArray(parsed.data.fields) && parsed.data.fields.every((f) => isObj(f) && typeof f.key === 'string')) {
    const fields = parsed.data.fields.map((f) => ({ key: String(f.key), value: f.value === null || f.value === undefined ? '' : String(f.value) }));
    if (fields.length) return { kind: 'form', status: String(status), message: String(parsed.message || ''), fields };
  }
  if (isObj(parsed.data) && !Array.isArray(parsed.data) && !parsed.data._embedded) {
    const fields = formFields(parsed.data);
    if (fields.length) return { kind: 'form', status: String(status), message: String(parsed.message || ''), fields };
  }
  const fields = formFields(parsed);
  if (fields.length) return { kind: 'form', status: String(status), message: String(parsed.message || ''), fields };
  // Valid JSON with nothing flattenable: still a compact summary, so the easy-read toggle never vanishes.
  return { kind: 'form', status: String(status), message: String(parsed.message || 'Structured JSON'), fields: [{ key: 'type', value: Array.isArray(parsed) ? 'array' : 'object' }] };
}

// JSON -> tokens for highlighting: [{ text, cls }] where cls is j-key, j-str, j-num, j-bool, j-null or null (plain text).
// Not JSON (mid-stream or plain text) or nested deeper than MAX_JSON_DEPTH: null, so the caller shows raw text. Over the cap: one plain token of the pretty text.
// The renderer must show `text` as text (React escapes it); nothing here is markup.
export function tokenizeJson(raw) {
  const parsed = parseBounded(raw);
  if (parsed === undefined) return null; // not JSON, or too deep: the caller shows raw text
  let pretty;
  try { pretty = JSON.stringify(parsed, null, 2); } catch { return null; }
  if (pretty === undefined) return null;
  if (pretty.length > JSON_HIGHLIGHT_MAX_CHARS) return [{ text: pretty, cls: null }];
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out = [];
  let last = 0;
  for (let m = re.exec(pretty); m !== null; m = re.exec(pretty)) {
    if (m.index > last) out.push({ text: pretty.slice(last, m.index), cls: null });
    const tok = m[0];
    let cls = 'j-num';
    if (tok[0] === '"') cls = /:$/.test(tok) ? 'j-key' : 'j-str';
    else if (tok === 'true' || tok === 'false') cls = 'j-bool';
    else if (tok === 'null') cls = 'j-null';
    out.push({ text: tok, cls });
    last = m.index + tok.length;
  }
  if (last < pretty.length) out.push({ text: pretty.slice(last), cls: null });
  return out;
}
