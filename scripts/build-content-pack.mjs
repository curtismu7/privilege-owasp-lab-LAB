// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the lab.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CAST } from '../server/src/cast.js';
import { buildStory } from '../server/src/story.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// Family-plan catalog id: to be assigned by the owner at ship time (the shelf PR carries it).
export const CATALOG = 'D129';

export function buildPack() {
  const story = buildStory(DEFAULT_CAST);
  const sid = (n) => `S${String(n).padStart(2, '0')}`;
  const terms = {
    'the-coverage-table': ['coverage-table'],
    'asi01-goal-hijack': ['agent-goal-hijack'],
    'asi03-identity-abuse': ['identity-privilege-abuse'],
    'asi04-supply-chain': ['agentic-supply-chain'],
    'asi06-memory-poisoning': ['memory-poisoning'],
    'asi08-cascading-failures': ['cascading-failures'],
    'asi10-rogue-agents': ['rogue-agents'],
    'two-layers': ['gateway', 'aiguard'],
  };
  return {
    schema: 'demo-content-pack/1',
    id: 'privilege-owasp-lab',
    title: 'Privilege OWASP Lab',
    version,
    demo: { id: 'privilege-owasp-lab', name: 'Privilege OWASP Lab', catalog: CATALOG, baseUrl: 'http://localhost:7811', doctor: '/api/health', tags: ['pingone-privilege', 'ai-agent-security', 'agent-identity', 'authorization-policy', 'learning', 'simulated'] },
    glossary: [
      { id: 'coverage-table', term: 'Coverage table (deck p.21)', definition: 'The slide-21 table of the Privilege Capability Overview deck: one row per OWASP Agentic AI Top 10 category, the Privilege component that covers it (Gateway, AIGuard or both), and how, with the two stated gaps (ASI04, ASI06) in amber.', aliases: ['slide-21 table'] },
      { id: 'agent-goal-hijack', term: 'Agent Goal Hijack (ASI01)', definition: 'An attacker smuggles instructions into content the agent reads and steers it away from its real goal. Privilege answers with injection, jailbreak and hidden-instruction detection in AIGuard.', aliases: ['ASI01'] },
      { id: 'identity-privilege-abuse', term: 'Identity and Privilege Abuse (ASI03)', definition: 'Agents acting with over-broad or shared credentials turn a compromise into a privilege compromise. Privilege answers with per-user virtual keys, least-privilege scopes, RBAC and live revocation.', aliases: ['ASI03'] },
      { id: 'agentic-supply-chain', term: 'Agentic Supply Chain (ASI04)', definition: 'Malicious tool definitions and typosquatted tools install attacker behaviour before a run. AIGuard detects both; fingerprint pinning is the stated remaining gap.', aliases: ['ASI04'] },
      { id: 'memory-poisoning', term: 'Memory and Context Poisoning (ASI06)', definition: 'A fact or instruction planted in agent memory changes every future decision. Memory-write inspection ships in AIGuard; gateway integration is in progress.', aliases: ['ASI06'] },
      { id: 'cascading-failures', term: 'Cascading Agent Failures (ASI08)', definition: 'One runaway agent amplifies through the chain. The gateway caps rate and budget, trips a circuit breaker and streams events to the SIEM; behaviour scoring supplements this and ASI10.', aliases: ['ASI08'] },
      { id: 'rogue-agents', term: 'Rogue Agents (ASI10)', definition: 'Unregistered agents have no owner, scope or audit trail. No agent reaches a model, tool or peer without a valid scoped key from the agent registry.', aliases: ['ASI10'] },
      { id: 'gateway', term: 'The Gateway', definition: 'Privilege\'s identity and chokepoint layer: it proves who the agent is and what it may do on every hop.', aliases: ['agent gateway'] },
      { id: 'aiguard', term: 'AIGuard', definition: 'Privilege\'s content and behaviour layer: it inspects prompts, tool requests, tool definitions, code-shaped payloads, memory writes and outputs.', aliases: [] },
    ],
    sources: [
      { id: 'capability-deck', title: 'PingOne Privilege Capability Overview deck (page 21, 2 Nov 2026)', url: 'https://www.pingidentity.com/', kind: 'vendor', use: 'The coverage wording for all ten ASI categories and the two stated gaps.', status: 'read', checked: '2026-11-11' },
      { id: 'owasp-asi', title: 'OWASP Agentic Security Initiative', url: 'https://genai.owasp.org/', kind: 'standard', use: 'The ASI01-ASI10 category definitions the explanations summarise.', status: 'not-read', checked: '2026-11-11' },
    ],
    cards: [
      ...story.scenarios.map((sc, i) => ({ id: `try-${sc.id}`, label: `Scenario ${i + 1}: ${sc.title}`, description: sc.lesson, group: 'try-it', action: { type: 'route', href: `/#scenario-${sc.id}` }, terms: terms[sc.id], story: sid(i + 1) })),
      { id: 'concept-layers', label: 'Gateway vs AIGuard', description: 'Two enforcement layers: who the agent is and what it may do, versus what flows through.', group: 'concept', action: { type: 'route', href: '/#scenario-two-layers' }, terms: ['gateway', 'aiguard'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: story.scenarios.map((sc, i) => ({ id: sid(i + 1), title: sc.title, say: sc.say })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
}
