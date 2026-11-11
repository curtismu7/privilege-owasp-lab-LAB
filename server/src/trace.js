// Rule 14: W3C Trace Context on every hop. One trace id per query; a valid incoming `traceparent` header continues its trace,
// anything else starts a new one. Values are random and carry no meaning outside this app.
import { randomBytes } from 'node:crypto';

const TP = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function parseTraceparent(v) {
  if (typeof v !== 'string' || v.length !== 55) return null;
  const m = TP.exec(v);
  return m && m[1] !== ZERO32 && m[2] !== ZERO16 && m[3] !== 'ff' ? { traceId: m[1], parentId: m[2], flags: m[3] } : null;
}
export const formatTraceparent = (traceId, spanId, flags = '01') => `00-${traceId}-${spanId}-${flags}`;

export function newTrace(incoming, rand = randomBytes) {
  const p = parseTraceparent(incoming);
  const span = () => rand(8).toString('hex').replace(/^0{16}$/, '0000000000000001');
  return { traceId: p ? p.traceId : rand(16).toString('hex').replace(/^0{32}$/, `${'0'.repeat(31)}1`), parentId: p ? p.parentId : null, span };
}

// The hops of one command run, as raw demo-hop/1 hops (AI-DEMO-Standalone shared/hop-detail) that hopCatalog.js enriches
// with the teaching text. Hops 1 and 2 are what this lab did. Hops 3 and 4 are what pingcli does inside: in Mock they are
// simulated (MOCK token, .example hosts); in Real the lab cannot see pingcli's own HTTP traffic, so they are described,
// not observed (`observed: false`), and whether pingcli forwards the traceparent is UNVERIFIED.
// The client secret never appears: the token request carries `client_secret=[write-only]`.
export const MOCK_TOKEN = 'MOCK-ACCESS-TOKEN-not-a-real-token';
export function buildRunHops({ trace, source, commandKey, label, argv, exitCode, bytes, authHost, apiHost, envId, uri, authFresh, transport = 'stream' }) {
  const ids = [trace.span(), trace.span(), trace.span(), trace.span()];
  const tp = (i) => formatTraceparent(trace.traceId, ids[i]);
  const mock = source === 'mock';
  const verdict = exitCode === 0 ? 'ok' : 'deny';
  const hops = [
    { kind: 'powasp-read-request', from: 'browser', to: 'lab', verdict: 'ok', observed: true, traceparent: tp(0),
      label: `The page asks the lab to run one allow-listed command (${commandKey})`,
      request: transport === 'stream'
        ? { method: 'GET', url: `/api/stream?commandKey=${commandKey}`, headers: { traceparent: tp(0) } }
        : { method: 'POST', url: '/api/run', headers: { traceparent: tp(0), 'content-type': 'application/json' }, body: { commandKey } },
      response: { status: 200, headers: { 'content-type': transport === 'stream' ? 'text/event-stream' : 'application/json' }, body: { exitCode, bytes, source } } },
    mock
      ? { kind: 'powasp-fetch', from: 'lab', to: 'pingcli', verdict, observed: true, traceparent: tp(1),
        label: 'MOCK: no binary runs; the lab plays canned pingcli output (in-process, no network)',
        request: { method: 'MOCK', url: `mockOutput(${commandKey})`, body: { asIf: label } }, response: { status: exitCode, body: { exitCode, bytes, note: 'MOCK output' } } }
      : { kind: 'powasp-fetch', from: 'lab', to: 'pingcli', verdict, observed: true, traceparent: tp(1),
        label: 'The lab starts pingcli (no shell, fixed arguments, private config, minimal environment)',
        request: { method: 'SPAWN', url: argv.join(' '), headers: { env: 'PATH, HOME=<private>, TMPDIR=<private> (no PINGONE_* variables)' } },
        response: { status: exitCode, body: { exitCode, bytes, note: 'output scrubbed of the client id and secret' } } },
  ];
  if (uri) {
    const how = mock ? 'MOCK' : 'described, not observed';
    if (authFresh) {
      hops.push({ kind: 'powasp-auth', from: 'pingcli', to: 'pingone-auth', verdict: 'ok', observed: mock, traceparent: tp(2),
        label: `pingcli gets a worker token with client credentials, once per session (${how})`,
        request: { method: 'POST', url: `https://${authHost}/${envId}/as/token`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&client_id=<client id>&client_secret=[write-only]' },
        response: mock ? { status: 200, body: { access_token: MOCK_TOKEN, token_type: 'Bearer', expires_in: 3600 } } : { status: 200, body: { note: 'a worker access token, stored under the private HOME (not shown)' } } });
    }
    hops.push({ kind: 'powasp-management-api', from: 'pingcli', to: 'pingone-api', verdict, observed: mock, traceparent: tp(3),
      label: `pingcli calls the PingOne management API (${how})`,
      request: { method: 'GET', url: `https://${apiHost}/v1/${uri}`, headers: { authorization: `Bearer ${mock ? MOCK_TOKEN : '<worker token>'}` } },
      response: mock ? { status: 200, body: { note: `MOCK: ${bytes} byte(s) of JSON` } } : { status: null, body: { note: 'see the command output' } } });
  }
  return hops.map((h, i) => ({ n: i + 1, mock, ...h }));
}
