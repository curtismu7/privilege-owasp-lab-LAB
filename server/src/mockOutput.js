// Mock: canned Privilege OWASP coverage data for every allow-listed dataset, flavoured by the cast. No binary, no
// network, no tenant. Every coverage claim is the static deck wording (storyData FACTS names its source); every host
// in the data is .example; every id is made up.
import { createHash } from 'node:crypto';
import { DATASETS } from './commands.js';

export const MOCK_VERSION = 'static-deck-2026-11-02';
export const MOCK_API_HOST = 'api.pingone.example';
export const MOCK_AUTH_HOST = 'auth.pingone.example';
const AT = '2026-11-02T09:00:00.000Z';

// A stable fake UUID (v4 layout) from any seed text.
export function mockUuid(...parts) {
  const h = createHash('sha256').update(`privilege-owasp-lab-mock:${parts.join(':')}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const mockEnvId = (cast) => mockUuid('env', cast.castHost);

const CATS = {
  ASI01: { name: 'Agent Goal Hijack', coveredBy: 'AIGuard', state: 'full', how: 'Injection, jailbreak and hidden-instruction detection' },
  ASI02: { name: 'Tool Misuse & Exploitation', coveredBy: 'AIGuard', state: 'full', how: 'Path traversal, destructive commands, SSRF, over-broad scope' },
  ASI03: { name: 'Identity & Privilege Abuse', coveredBy: 'Gateway + AIGuard', state: 'full', how: 'Per-user virtual keys, least-privilege scopes, RBAC, live revocation' },
  ASI04: { name: 'Agentic Supply Chain', coveredBy: 'AIGuard', state: 'gap', how: 'Tool-definition injection and typosquatting; fingerprint pinning pending' },
  ASI05: { name: 'Unexpected Code Execution', coveredBy: 'AIGuard', state: 'full', how: 'Shell metacharacter, template-injection and fetch-and-execute rules' },
  ASI06: { name: 'Memory & Context Poisoning', coveredBy: 'AIGuard', state: 'gap', how: 'Memory-write inspection shipped; gateway integration in progress' },
  ASI07: { name: 'Insecure Inter-Agent Communication', coveredBy: 'Gateway + AIGuard', state: 'full', how: 'A2A chokepoint with dedicated scope; inter-agent abuse rules' },
  ASI08: { name: 'Cascading Agent Failures', coveredBy: 'Gateway', state: 'full', how: 'Rate and budget ceilings; circuit breaker; event stream to SIEM' },
  ASI09: { name: 'Human-Agent Trust Exploitation', coveredBy: 'AIGuard', state: 'full', how: 'Shared jailbreak, exfiltration, prompt-leak and PII rules' },
  ASI10: { name: 'Rogue Agents', coveredBy: 'Gateway', state: 'full', how: 'No agent reaches a model, tool or peer without a valid scoped key' },
};

const THREATS = {
  ASI01: 'An attacker smuggles instructions into content the agent reads - a poisoned web page, a document, an email, a hidden prompt - and steers the agent away from its real goal. The agent obeys the attacker instead of the user, and may start calling tools toward the attacker\'s aim.',
  ASI02: 'The agent has powerful tools - file access, command execution, HTTP fetch - and a hijacked or confused agent turns them against the system: path traversal, destructive shell commands, SSRF to internal services, or calls beyond its scope.',
  ASI03: 'Agents act with credentials. A shared admin key, or privileges that outlive the task, turn a compromise into a privilege compromise: the attacker inherits everything the agent could do.',
  ASI04: 'The agent\'s capabilities arrive from outside: MCP tool definitions, plugins, fetched packages. A malicious tool definition or a typosquatted tool name installs attacker behaviour before the agent ever runs.',
  ASI05: 'Model output or retrieved content contains executable payloads: shell metacharacters, template-injection syntax, or a fetch-and-execute chain that downloads and runs attacker code.',
  ASI06: 'Agents persist what they learn. A fact, preference or instruction planted in memory or context changes every future decision - a single write today becomes a standing backdoor.',
  ASI07: 'Multi-agent systems talk to each other. Without authenticated, scoped channels, anything pretending to be an agent can inject messages, impersonate a peer, or escalate through a more privileged agent.',
  ASI08: 'Agents call agents call tools. One runaway agent amplifies through the chain - retry storms, cost blowouts, tool-call loops - until a small failure is an outage or a runaway bill.',
  ASI09: 'Humans trust their agents. An attacker jailbreaks the agent, makes it leak its system prompt or other users\' data, exfiltrates secrets through its outputs, or abuses the human\'s willingness to approve whatever the agent asks.',
  ASI10: 'Unregistered, unauthenticated or long-forgotten agents: shadow AI with a network connection, no owner, no scope and no audit trail.',
};

const GAPS = {
  ASI04: 'Fingerprint pinning is pending: the gateway detects malicious tool definitions and typosquats, but does not yet pin a verified tool fingerprint per agent.',
  ASI06: 'Gateway integration is in progress: memory-write inspection runs in AIGuard today; wiring it into the gateway path is the remaining work.',
};

const coverageRows = () => Object.entries(CATS).map(([id, c]) => ({
  id, threat: c.name, coveredBy: c.coveredBy, state: c.state === 'gap' ? 'gap stated' : 'covered', how: c.how,
}));

const categoryForm = (asi) => {
  const c = CATS[asi];
  const fields = [
    { key: 'category', value: `${asi} - ${c.name}` },
    { key: 'covered by', value: c.coveredBy },
    { key: 'status', value: c.state === 'gap' ? 'GAP STATED' : 'COVERED' },
    { key: 'the threat', value: THREATS[asi] },
    { key: 'how privilege covers it', value: c.how },
  ];
  if (GAPS[asi]) fields.push({ key: 'stated gap', value: GAPS[asi] });
  return fields;
};

const twoLayersForm = () => [
  { key: 'gateway', value: 'Identity and chokepoint: per-user virtual keys (ASI03), the A2A chokepoint with a dedicated inter-agent scope (ASI07), rate and budget ceilings with a circuit breaker and a SIEM event stream (ASI08), and no-key-no-access (ASI10).' },
  { key: 'aiguard', value: 'Content and behaviour: injection and jailbreak detection (ASI01), tool-use misuse rules (ASI02), tool-definition scanning (ASI04), code-shaped payload rules (ASI05), memory-write inspection (ASI06), and output rules for exfiltration, prompt leakage and PII (ASI09).' },
  { key: 'overlap', value: 'ASI03 and ASI07 need both: the gateway proves identity and enforces scope on the hop, AIGuard inspects what the proven agent asks for. In-gateway behaviour scoring supplements ASI08 and ASI10.' },
];

const liveEvidenceRows = (cast) => [
  { check: 'gateway reachable', source: 'live', result: 'unverified until the owner runs Real', note: `https://${MOCK_API_HOST}` },
  { check: 'coverage table matches the deck', source: 'static', result: '8 of 10 full, 2 gap stated', note: 'deck page 21' },
  { check: 'agent registry answer', source: 'live', result: 'pending Real', note: `${cast.castOrg} environment` },
  { check: 'AIGuard rule set loaded', source: 'live', result: 'pending Real', note: 'read-only query' },
];

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// The whole stdout of one dataset for this cast, plus its exit code. Pure and deterministic.
export function mockOutput(key, cast) {
  const ds = DATASETS[key];
  if (!ds) throw new Error('not an allow-listed dataset');
  switch (ds.mock) {
    case 'coverage-table':
      return { exitCode: 0, text: json({ schemaVersion: '1.1', status: 'success', message: 'OWASP Agentic AI Top 10 coverage (deck p.21)', data: { rows: coverageRows(), footnote: 'ASI08 is met by real-time event data to your observability stack; in-gateway behaviour scoring supplements ASI08 and ASI10.' } }) };
    case 'category': {
      const asi = key.toUpperCase();
      return { exitCode: 0, text: json({ schemaVersion: '1.1', status: 'success', message: `${asi} coverage`, data: { fields: categoryForm(asi), source: 'Privilege Capability Overview deck, page 21' } }) };
    }
    case 'two-layers':
      return { exitCode: 0, text: json({ schemaVersion: '1.1', status: 'success', message: 'Gateway vs AIGuard', data: { fields: twoLayersForm() } }) };
    case 'live-evidence':
      return { exitCode: 0, text: json({ schemaVersion: '1.1', status: 'success', message: 'Live evidence checks', data: { rows: liveEvidenceRows(cast) } }) };
    default: throw new Error('no mock for this dataset');
  }
}

// The mock output cut into a few chunks, so the stream looks like a real run (the delay is added by the caller).
export function mockChunks(text, max = 4) {
  if (text.length < 120) return [text];
  const lines = text.split(/(?<=\n)/);
  const per = Math.ceil(lines.length / max);
  const out = [];
  for (let i = 0; i < lines.length; i += per) out.push(lines.slice(i, i + per).join(''));
  return out;
}
