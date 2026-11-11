# Talk track

<!-- Generated from server/src/storyData.js by `npm run talk-track`. Do not edit by hand. -->

## Open

This is Northwind Retail. Jordan Ellis needs to answer one question: what does PingOne Privilege actually cover in the OWASP Agentic AI Top 10? The banner says whether we are in Mock or Real.

## The coverage table

Start with the slide-21 table: ten rows, one per ASI category. Green pills for full coverage, amber for the two stated gaps. The footnote says ASI08 is met by real-time event data to your observability stack.

## Read a category

Open ASI03. The card explains the threat in plain language, names Gateway + AIGuard, and says how: per-user virtual keys, least-privilege scopes, RBAC, live revocation.

## Name the gaps

ASI04 and ASI06 carry gap chips. Fingerprint pinning is pending; memory-write inspection runs in AIGuard today and the gateway integration is in progress. A lab that hides a gap is not a lab you can trust.

## Follow the hops

Open the hops: browser to lab, lab to the dataset, and in Real one read-only call to your PingOne environment with a worker token. In Mock the last hop is simulated and says so.

## Close

Eight categories fully covered, two with a stated gap, every claim traceable to the deck or labelled UNVERIFIED. Switch to Real to add live evidence from your own environment.

## The scenarios

1. **The coverage table** (`coverage-table`). Start with the slide-21 table: all ten ASI categories, who covers each (Gateway, AIGuard or both), and how - with the two stated gaps in amber. *Coverage is claimed per category with a named component, and the gaps are stated, not hidden.*
2. **ASI01: Agent Goal Hijack** (`asi01`). An attacker smuggles instructions into content the agent reads and steers it away from its real goal. AIGuard inspects prompts and retrieved content before the agent acts. *Catch smuggled instructions at the input boundary, before they become agent behaviour.*
3. **ASI03: Identity and Privilege Abuse** (`asi03`). Agents act with credentials; an over-privileged agent turns a compromise into a privilege compromise. Privilege re-binds every call to the human it acts for, narrows scope, and can revoke live. *Per-user virtual keys and least-privilege scopes make agent compromise survivable.*
4. **ASI04: Agentic Supply Chain** (`asi04`). Malicious tool definitions and typosquatted tools install attacker behaviour before a run. AIGuard detects both; fingerprint pinning is the stated remaining gap. *A stated gap is a control too: say what is not covered yet.*
5. **ASI06: Memory and Context Poisoning** (`asi06`). A planted fact in agent memory becomes a standing backdoor across sessions. Memory-write inspection ships in AIGuard; gateway integration is in progress. *Inspect what is written to memory, not only what is read.*
6. **ASI08: Cascading Agent Failures** (`asi08`). One runaway agent amplifies through the chain until a small failure is an outage or a bill. The gateway caps rate and budget, trips a circuit breaker, and streams events to your SIEM. *Cap what any one agent can consume before the chain amplifies.*
7. **ASI10: Rogue Agents** (`asi10`). Unregistered agents have no owner, scope or audit trail. No agent reaches a model, tool or peer without a valid scoped key. *Registration is the only way onto the network.*
8. **Gateway vs AIGuard** (`two-layers`). The gateway proves who the agent is and what it may do; AIGuard inspects what flows through. ASI03 and ASI07 need both. *Identity enforcement and content inspection are different layers with different jobs.*
