// The story as data. Every product claim carries a status: `observed-in-AI-DEMO2` (named source file; still UNVERIFIED
// in this lab), `captured` (output of a real system, no tenant, dated), `UNVERIFIED`, or `lab` (a property of this lab's
// own code, pinned by its tests). The coverage wording is from the PingOne Privilege Capability Overview deck
// (2 Nov 2026, page 21): the OWASP Agentic AI Top 10 table.
export const TITLE = 'Privilege OWASP Lab';
export const INTRO = 'The OWASP Agentic AI Top 10 (ASI01-ASI10) names the ten categories of risk that arise when software agents plan, remember, call tools and talk to each other. This lab walks {{castAdmin}} through each category, explains the threat in plain language, and shows what PingOne Privilege answers with for the {{castEnvName}} environment: the slide-21 coverage table, the ten categories as cards, and the Gateway vs AIGuard split.';

// Simulation honesty banner (rule 2), defined here so every page and presenter mode show the same words.
export const BANNER = {
  mock: "MOCK: no PingOne tenant is contacted and nothing leaves this machine. Every coverage claim is static wording from the Privilege Capability Overview deck (page 21), and the category explanations are this lab's own summaries, not an OWASP rating.",
  real: 'REAL: the coverage wording is the same static deck content, plus live evidence fetched read-only from YOUR PingOne environment with worker client credentials from your settings (the coverage claims themselves are not re-tested live). The client secret is write-only: never shown, logged or returned.',
};

export const FACTS = [
  { id: 'deck-source', status: 'observed-in-AI-DEMO2', source: 'AI-DEMO2 demo_api_ui/src/components/PrivilegeOwaspTop10Page.jsx',
    text: 'The ASI01-ASI10 coverage table and the two stated gaps (ASI04 fingerprint pinning pending, ASI06 gateway integration in progress) come from the Privilege Capability Overview deck, page 21 (2 Nov 2026). Rendered in AI-DEMO2; the wording is static in this lab.' },
  { id: 'owasp-source', status: 'UNVERIFIED',
    text: "The threat explanations are this lab's plain-language summaries of the OWASP Agentic Security Initiative categories, not OWASP text and not an OWASP rating of Privilege." },
  { id: 'gateway-scope', status: 'lab', text: "The lab shows Privilege's coverage claims as the deck states them: Gateway for identity and chokepoint categories (ASI03, ASI07, ASI08, ASI10), AIGuard for content categories (ASI01, ASI02, ASI04, ASI05, ASI06, ASI09), both for ASI03 and ASI07." },
  { id: 'gaps-honest', status: 'lab', text: "ASI04 and ASI06 are shown with a gap chip and the deck's stated remainder, never as full coverage." },
  { id: 'real-evidence', status: 'UNVERIFIED',
    text: "Real mode is intended to add live read-only evidence from your PingOne environment next to the static claims. It is owner-run; what it can fetch is UNVERIFIED until the owner's Real run." },
  { id: 'no-writes', status: 'lab', text: 'The lab makes no write call anywhere: Mock is fully in-process; Real is read-only against the management API with a worker token.' },
];

// Scenarios: one dataset each, in the order a presenter walks them. `expect` is checked by the doctor against the Mock data.
export const SCENARIOS = [
  { id: 'the-coverage-table', title: 'The coverage table', commandKey: 'coverage-table', expect: { view: 'table', minRows: 10 },
    say: 'Start with the slide-21 table: all ten ASI categories, who covers each (Gateway, AIGuard or both), and how - with the two stated gaps in amber.',
    lesson: 'Coverage is claimed per category with a named component, and the gaps are stated, not hidden.' },
  { id: 'asi01-goal-hijack', title: 'ASI01: Agent Goal Hijack', commandKey: 'asi01', expect: { view: 'form' },
    say: 'An attacker smuggles instructions into content the agent reads and steers it away from its real goal. AIGuard inspects prompts and retrieved content before the agent acts.',
    lesson: 'Catch smuggled instructions at the input boundary, before they become agent behaviour.' },
  { id: 'asi03-identity-abuse', title: 'ASI03: Identity and Privilege Abuse', commandKey: 'asi03', expect: { view: 'form' },
    say: 'Agents act with credentials; an over-privileged agent turns a compromise into a privilege compromise. Privilege re-binds every call to the human it acts for, narrows scope, and can revoke live.',
    lesson: 'Per-user virtual keys and least-privilege scopes make agent compromise survivable.' },
  { id: 'asi04-supply-chain', title: 'ASI04: Agentic Supply Chain', commandKey: 'asi04', expect: { view: 'form' },
    say: 'Malicious tool definitions and typosquatted tools install attacker behaviour before a run. AIGuard detects both; fingerprint pinning is the stated remaining gap.',
    lesson: 'A stated gap is a control too: say what is not covered yet.' },
  { id: 'asi06-memory-poisoning', title: 'ASI06: Memory and Context Poisoning', commandKey: 'asi06', expect: { view: 'form' },
    say: 'A planted fact in agent memory becomes a standing backdoor across sessions. Memory-write inspection ships in AIGuard; gateway integration is in progress.',
    lesson: 'Inspect what is written to memory, not only what is read.' },
  { id: 'asi08-cascading-failures', title: 'ASI08: Cascading Agent Failures', commandKey: 'asi08', expect: { view: 'form' },
    say: 'One runaway agent amplifies through the chain until a small failure is an outage or a bill. The gateway caps rate and budget, trips a circuit breaker, and streams events to your SIEM.',
    lesson: 'Cap what any one agent can consume before the chain amplifies.' },
  { id: 'asi10-rogue-agents', title: 'ASI10: Rogue Agents', commandKey: 'asi10', expect: { view: 'form' },
    say: 'Unregistered agents have no owner, scope or audit trail. No agent reaches a model, tool or peer without a valid scoped key.',
    lesson: 'Registration is the only way onto the network.' },
  { id: 'two-layers', title: 'Gateway vs AIGuard', commandKey: 'two-layers', expect: { view: 'form' },
    say: 'The gateway proves who the agent is and what it may do; AIGuard inspects what flows through. ASI03 and ASI07 need both.',
    lesson: 'Identity enforcement and content inspection are different layers with different jobs.' },
];

export const TALK_TRACK = [
  { title: 'Open', say: 'This is {{castOrg}}. {{castAdmin}} needs to answer one question: what does PingOne Privilege actually cover in the OWASP Agentic AI Top 10? The banner says whether we are in Mock or Real.' },
  { title: 'The coverage table', say: 'Start with the slide-21 table: ten rows, one per ASI category. Green pills for full coverage, amber for the two stated gaps. The footnote says ASI08 is met by real-time event data to your observability stack.' },
  { title: 'Read a category', say: 'Open ASI03. The card explains the threat in plain language, names Gateway + AIGuard, and says how: per-user virtual keys, least-privilege scopes, RBAC, live revocation.' },
  { title: 'Name the gaps', say: 'ASI04 and ASI06 carry gap chips. Fingerprint pinning is pending; memory-write inspection runs in AIGuard today and the gateway integration is in progress. A lab that hides a gap is not a lab you can trust.' },
  { title: 'Follow the hops', say: 'Open the hops: browser to lab, lab to the dataset, and in Real one read-only call to your PingOne environment with a worker token. In Mock the last hop is simulated and says so.' },
  { title: 'Close', say: 'Eight categories fully covered, two with a stated gap, every claim traceable to the deck or labelled UNVERIFIED. Switch to Real to add live evidence from your own environment.' },
];
