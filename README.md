# Privilege OWASP LAB

Tier: Tester.
Repo: https://github.com/curtismu7/privilege-owasp-lab-LAB
Catalog: D129

The OWASP Agentic AI Top 10 (ASI01–ASI10) with what PingOne Privilege covers. The lab serves the slide-21 coverage table from the PingOne Privilege Capability Overview deck (2 Nov 2026): one row per ASI category with the Privilege component that covers it (the Gateway, AIGuard, or both) and how, plus ten explained category cards and the Gateway vs AIGuard split. The two stated gaps (ASI04 fingerprint pinning pending, ASI06 gateway integration in progress) are labelled as gaps, never as coverage.

Derived from the AI-DEMO2 /privilege-owasp-top10 page (read-only source, never imported). Scaffold copied from pingcli-LAB (origin/main, 2026-11-11): its safety, netguard, health, workspace, cast/story, trace, doctor, reset, content-pack and UI-standard pieces were kept and all of its CLI-runner features removed.

**Status:** building: local Docker on port 7811; shelf and lab-proxy registration pending.

## The page

One page with five tabs in the Ping UI standard (dark shell bar with the Ping Red rule, the simulation banner first on every tab and in presenter mode, Mock/Real toggle and theme toggle in the header, usable at 375px):

- **Coverage**: the slide-21 table (ten rows, green pills for full coverage, amber for the two stated gaps, the deck's footnote under the table), the ten category cards each with a "gap stated" chip where the deck states one, and a live-evidence card for Real. Every dataset streams in as server-sent events and renders as the easy-read table or key/value form, always as React text (control, bidi and ANSI escape characters show as visible escapes; output is capped on the client too).
- **Story**: the vertical picker (banking, healthcare, retail), scenarios that open their dataset, and every claim with its status.
- **Diagram**: `coverage-flow` loaded by name from diagram-studio data (movable boxes, Simulate, speed, Reset positions).
- **Trace**: the last run's hops in the shared evidence screens (sequence view, movie reel, step detail) with raw request/response and `traceparent`; Mock hops and tokens are labelled MOCK, Real redacts tokens.
- **Talk track**, presenter mode (P / Esc) and Reset (stops the run, clears output and trace, restores diagram positions).

Shared code vendored, never imported: `web/src/evidence/` and `server/src/vendor/` from AI-DEMO-Standalone `shared/evidence` and `shared/hop-detail`; `scripts/lib/shelf-registry-rules.mjs` and `shelf-tags.json` from demo-shelf-LAB; `web/src/standalone-ui.css` (pinned by `scripts/check-ui-standard.sh`).

## Modes (rule 19: Mock, Real and a runtime toggle)

**Mock (the default when Real is not configured; no tenant, no credentials, no network).** No binary runs and nothing leaves the machine. Every dataset is served in-process from the static deck wording, flavoured by the chosen vertical (banking, healthcare, retail), with made-up ids and `.example` hosts, streamed in a few chunks so it feels live. The live-evidence card replays placeholder checks labelled as pending Real.

**Real (owner-run).** The coverage wording stays the static deck content; Real adds live evidence fetched read-only from your own PingOne environment:

- Settings: `PINGONE_ENVIRONMENT_ID`, `PINGONE_REGION` (NA, EU, CA, AP/ASIA, AU, SG), `PINGONE_CLIENT_ID`, `PINGONE_CLIENT_SECRET`, read from the one settings file `~/Development/.env` (or `STANDALONE_ENV`), or from the process environment (Docker: compose passes them through from your shell or an `.env` beside the compose file; never baked, never committed).
- Invocation: one fixed, read-only management-API call per dataset; no caller-supplied path, query or filter ever reaches the runner.
- The client secret is write-only: never returned, shown, logged or put in a label. See `docs/safety.md` for the private profile, scrubbing, timeouts and limits.

`GET /api/info` reports `source`, `realAvailable` and a non-secret `realHowTo`; `POST /api/mode` with exactly `{ "source": "mock" | "real" }` switches at runtime (409 when Real is not configured). This lab signs nobody in, so there is no persona picker (rule 11 is met by the mode header).

## Honesty

Product claims carry a status in `server/src/storyData.js`: `observed-in-AI-DEMO2` (named source file, still UNVERIFIED here), `UNVERIFIED`, or `lab` (pinned by this lab's tests). The coverage wording is the deck's; the threat explanations are this lab's own plain-language summaries of the OWASP Agentic Security Initiative categories, not OWASP text and not an OWASP rating of Privilege. What Real can fetch is UNVERIFIED until the owner's Real run.

## Run from a clone

Prerequisites: Node 26 or newer. Docker (OrbStack) only if you use the Docker form. Mock works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/curtismu7/privilege-owasp-lab-LAB.git
cd privilege-owasp-lab-LAB
npm ci
npm run build
npm run doctor
npm start
```

Open http://127.0.0.1:7811/ (the server serves the built page itself). `GET /api/health` answers `demo-health/1`. Or with Docker: `docker compose up --build -d` from the same folder.

## Run

- Host: `./scripts/run.sh` (Node 26+), then open http://localhost:7811/.
- Docker (OrbStack): `docker compose up --build -d`, published on `127.0.0.1:7811` only (Mock unless the four settings are in your shell).
- Docker with Real: `npm run docker:up` (`scripts/compose-real.mjs`) passes the four `PINGONE_*` settings from `~/Development/.env` (or `STANDALONE_ENV`; a value already in your shell wins) to `docker compose` through its environment only. It prints which keys are set, never a value, and writes nothing.
- Test: `npm test` (server: `node --test test/*.test.js`, a glob; web: vitest; scripts: `node --test scripts/*.test.mjs`). Browser check: start the lab, then `npm run e2e` (Playwright headless Chromium; `npx playwright install chromium-headless-shell` once; `SHOT_DIR=` saves screenshots). Preflight: `npm run doctor`. Reset: `npm run reset`. Talk track: `npm run talk-track`. Content pack: `npm run content-pack`.

## API

`GET /api/commands` (13 datasets: `[{ key, title, category, label, runnable, auth, prereqs }]`), `GET /api/stream?commandKey=` (SSE: `meta`, `chunk`..., `done` with `exitCode`, `source` and the trace hops), `POST /api/run` `{ commandKey }` -> `{ command, output, exitCode, source, hops }`, `GET /api/version`, `GET /api/health` (`demo-health/1`), `GET /api/info`, `POST /api/mode`, `POST /api/reset`, `GET /api/runs`, `GET /api/story?vertical=`, `GET /api/diagram?name=coverage-flow`, `GET /api/shelf`. Unknown keys are 400. State is per workspace (`X-Workspace`, default `default`). Every run carries a W3C `traceparent` per hop with the raw request and response.

## Catalog

Catalog id **D129** (assigned 2026-11-12): in the shelf entry and the Learning Hub content pack.

## Ports, and what to do if the port is taken

```
Ports: privilege-owasp-lab-LAB listens on 7811 only (allocated with npm run ports -- --next in demo-shelf-LAB).
Docker publishes it on 127.0.0.1:7811 only.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7811 -sTCP:LISTEN -n -P
2. If it is an old copy of this lab (npm start), stop that process: kill <PID>.
   If it is this lab's container: docker compose down (from this folder).
3. If it is something else, stop it. The lab refuses any other port on purpose
   (one port per app; npm run doctor says so), so free 7811 rather than moving the lab.
4. Then start again: npm start, or docker compose up -d.
```

---

## If the Privilege desktop agent shows "unregistered"

The PingOne Privilege **desktop app** (the one serving the local console at
`https://local.procyon.ai:8643`) stays registered with the Ping cloud through a background
agent (`ping-helper`). When that agent's device record is deleted or unapproved on the cloud
side, every Privilege app on this machine loses Real mode: the local console stops serving,
connections time out, and the desktop app shows the agent as **unregistered**.

### How to tell this is what happened

1. **The desktop app says the agent is unregistered** (banner or the agent status panel), or its
   diagnostics print `✖ Found N errors` with `Device … not found`.
2. **The local console is down with it**: `https://local.procyon.ai:8643` does not answer
   (connection refused / timeout) even though the PingOne Privilege app is running.
3. **The agent log loops on one error.** Check `/Library/Logs/Procyon/procyon-agent.log`:

   ```
   Error getting the device: HTTP error: 500 Internal Server Error
   Body: { "error": "Device <base64-id> not found", "code": 2, ... }
   ```

   repeated every ~2 seconds. That single line is the tell: the agent is asking the cloud
   about a device record the cloud no longer has. (A one-off is harmless — it is the endless
   repetition that means unregistered.)

### Why it happens

- The cloud side **deletes or disables the device record** (an admin action in the console, a
  tenant sync, or a guard tripping after network churn). The agent cannot re-create it by
  itself: it re-registers only on an enable/disable cycle, and re-registration **waits for a
  human to approve the new device** in the console.
- Network/VPN blips to `privilege.pingone.com` (`lookup … no such host` in the same log) force
  re-registrations and can churn the device identity, making the window for this bigger.

### How to fix it

1. Open the **PingOne Privilege** desktop app and make sure it is running.
2. Sign in to the **cloud console**: `https://console.pingone.com/?env=<your-privilege-env-id>`
   → launch **PingOne Privilege** → open the **Devices** page.
3. Find this machine's device (`DeviceName: mac-…`, type MAC). It is either:
   - **pending approval** — click **Approve** (the agent's certificate request is waiting;
     this is the usual state after a delete), or
   - **missing entirely** — in the desktop app toggle the agent **off and on** (or quit and
     reopen the app) so it mints a fresh certificate request, then approve it in the console.
4. The agent picks up the approval within seconds (watch
   `/Library/Logs/Procyon/procyon-agent.log` for `Device registered with controller`), and the
   local console at `local.procyon.ai:8643` starts serving again. Real mode in this app works
   immediately after — no restart of the app needed.

### If it comes back

The device being deleted repeatedly is a **console-side action** (admin, sync sweep, or a
server-side guard after repeated network drops). Note the times from
`grep "Delete request recieved" /Library/Logs/Procyon/procyon-agent*.log` and raise it with
 whoever administers the Privilege tenant — re-approving treats the symptom; the deletes have
 to stop for it to stay fixed.
