// One Express app. /api = health, info, the Mock/Real toggle, the command catalog, one run (SSE stream or JSON),
// version, story, diagram, runs and reset. Per workspace id (X-Workspace): recent runs and one run in flight.
// Loopback Host check and same-origin writes on everything. Serves web/dist when it exists (step 2 adds the page).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginOnly, sameOriginWrites } from './safety.js';
import { createHealth } from './health.js';
import { mountShelfRoute } from './shelfLink.js';
import { loadCast, verticalFrom, VERTICALS, fill } from './cast.js';
import { binaryFrom, modeFrom, realConfigFrom, realProblemFrom, settingsFrom } from './config.js';
import { COMMANDS, buildPrereqs, labelFor, lookupCommand } from './commands.js';
import { MOCK_API_HOST, MOCK_AUTH_HOST, MOCK_VERSION, mockChunks, mockEnvId, mockOutput } from './mockOutput.js';
import { createRealRunner } from './realRunner.js';
import { buildStory } from './story.js';
import { BANNER } from './storyData.js';
import { DIAGRAM_NAMES, buildDiagram } from './diagramData.js';
import { buildRunHops, newTrace } from './trace.js';
import { enrichRunHops } from './hopCatalog.js';
import { createWorkspaces, workspaceFrom } from './workspaces.js';
import { parseJsonLoose } from './readable.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = process.env.WEB_DIST || path.resolve(HERE, '../../web/dist');
const CONFIG = process.env.CUSTOMER_CONFIG || path.resolve(HERE, '../../customer.config.json');
export const PINNED_VERSION = 'static-deck-2026-11-02';

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal?.aborted || ms <= 0) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

// pingcli often exits 0 with status:"error" in its JSON envelope: report that as a failure.
const envelopeExit = (text, exitCode) => {
  if (exitCode !== 0) return exitCode;
  const parsed = parseJsonLoose(text);
  return parsed && typeof parsed === 'object' && parsed.status === 'error' ? 1 : 0;
};

export function createApp({
  health, configFile = CONFIG, env = process.env, settingsFile, now = Date.now,
  workspaces = createWorkspaces({ now }), mockDelayMs = 60, runnerOptions = {}, commands = COMMANDS,
} = {}) {
  // Real settings are read once at start. The object holding the secret stays inside the runner.
  const settings = settingsFrom(env, settingsFile);
  const bin = binaryFrom(env);
  const realCfg = realConfigFrom(settings, bin);
  const realHowTo = realProblemFrom(settings, bin);
  const runner = realCfg ? createRealRunner(realCfg, runnerOptions) : null;
  let mode = modeFrom(env, runner !== null); // rule 19: starts from the launch mode, switches without a restart
  const healthRouter = health || createHealth({ runtime: () => (mode === 'real' ? 'live' : 'offline') });

  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple'); // no nested objects from the query string
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '4kb' }));
  api.use('/health', healthRouter.router);
  mountShelfRoute(api, { env });
  const castFor = (req) => loadCast(configFile, verticalFrom(req.query.vertical));
  const envIdFor = (cast) => (mode === 'real' ? realCfg.envId : mockEnvId(cast));

  api.get('/info', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cast = castFor(req);
    res.json({
      mode, source: mode, simulated: mode === 'mock', realAvailable: runner !== null, realHowTo,
      banner: fill(BANNER[mode], cast), pinnedVersion: PINNED_VERSION,
      // Never the client id or secret: only where Real points.
      real: realCfg ? { region: realCfg.region, rootDomain: realCfg.rootDomain } : null,
      signIn: 'none: this lab does not sign anyone in (no persona picker); the header shows the mode',
    });
  });

  // Rule 19: exactly { source: "mock"|"real" }; 409 when Real is not configured.
  api.post('/mode', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !['mock', 'real'].includes(body.source)) {
      return res.status(400).json({ error: 'bad_source', detail: 'body must be exactly { source: "mock" | "real" }' });
    }
    if (body.source === 'real' && !runner) return res.status(409).json({ error: 'real_not_configured', detail: realHowTo });
    if (body.source !== mode) {
      mode = body.source;
      workspaces.abortAll();
      // The Real session ends: none of its runs spawns again, its children are killed and awaited, then the private
      // profile and token store are removed.
      await runner?.dispose();
    }
    return res.json({ source: mode });
  });

  api.get('/commands', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const envId = envIdFor(castFor(req));
    res.json(Object.keys(commands).map((key) => {
      const cmd = commands[key];
      return { key, title: cmd.title, category: cmd.category, label: labelFor(cmd), runnable: cmd.runnable, auth: Boolean(cmd.auth), prereqs: buildPrereqs(cmd, { source: mode, envId }) };
    }));
  });

  const withWorkspace = (handler) => (req, res) => {
    const ws = workspaceFrom(req);
    if (!ws) return res.status(400).json({ error: 'bad_workspace' });
    res.set('Cache-Control', 'no-store');
    return handler(ws, req, res);
  };
  const lookupError = (res, found) => res.status(found.status).json(Object.fromEntries(Object.entries(found).filter(([k]) => k !== 'status')));

  // Mock: canned output in a few chunks with a small delay; the first auth command of a session "logs in" once.
  async function runMock(key, cmd, cast, ws, onText, signal) {
    const out = mockOutput(key, cast);
    const state = workspaces.state(ws);
    const authFresh = Boolean(cmd.auth) && !state.mockAuthed;
    if (cmd.auth) state.mockAuthed = true;
    for (const chunk of mockChunks(out.text)) {
      await sleep(mockDelayMs, signal);
      if (signal.aborted) return { exitCode: 1, error: 'stopped', authFresh };
      onText(chunk);
    }
    return { exitCode: out.exitCode, authFresh };
  }

  // One run in the current mode. onText gets the (scrubbed, in Real) output as it arrives.
  async function runOne({ ws, key, cmd, cast, onText, signal }) {
    if (mode === 'mock') {
      const r = await runMock(key, cmd, cast, ws, onText, signal);
      return { ...r, argv: null };
    }
    const r = await runner.run(cmd, { onText, signal });
    return { exitCode: r.exitCode, error: r.error, truncated: r.truncated, argv: r.argv, authFresh: Boolean(r.auth?.fresh) };
  }

  const hopsFor = ({ trace, source, key, cmd, envId, result, bytes, transport }) => {
    const uri = source === 'real' ? 'live-coverage-evidence' : (cmd.mock === 'live-evidence' ? 'live-coverage-evidence' : 'coverage-datasets');
    const domain = source === 'real' ? realCfg.rootDomain : null;
    return enrichRunHops(buildRunHops({
      trace, source, commandKey: key, label: labelFor(cmd), argv: result.argv || [], exitCode: result.exitCode, bytes,
      authHost: domain ? `auth.${domain}` : MOCK_AUTH_HOST, apiHost: domain ? `api.${domain}` : MOCK_API_HOST,
      envId, uri, authFresh: result.authFresh, transport,
    }), source);
  };

  // GETs that start pingcli are refused cross-site too (a cross-site page could otherwise start a Real run).
  api.get('/stream', sameOriginOnly, withWorkspace(async (ws, req, res) => {
    const found = lookupCommand(req.query.commandKey, commands);
    if (found.error) return lookupError(res, found);
    const ctl = workspaces.begin(ws);
    if (!ctl) return res.status(409).json({ error: 'run_in_progress', detail: 'One run at a time per workspace. Wait for it to finish or Reset.' });
    const { key, ds: cmd } = found;
    const source = mode;
    const cast = castFor(req);
    const envId = envIdFor(cast);
    const trace = newTrace(req.headers.traceparent);
    res.status(200);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', traceparent: `00-${trace.traceId}-${trace.span()}-01` });
    res.flushHeaders();
    // The client went away: stop the child (Real) or the replay (Mock).
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    const send = (event, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    send('meta', { command: labelFor(cmd), commandKey: key, auth: Boolean(cmd.auth), prereqs: buildPrereqs(cmd, { source, envId }), source, simulated: source === 'mock', workspace: ws, traceId: trace.traceId });
    let bytes = 0; let text = '';
    let result;
    try {
      result = await runOne({ ws, key, cmd, cast, signal: ctl.signal, onText: (t) => { bytes += Buffer.byteLength(t); if (text.length < 65_536) text += t; send('chunk', { text: t }); } });
    } catch {
      result = { exitCode: 1, error: 'internal_error', argv: null };
    } finally { workspaces.end(ws, ctl); }
    const exitCode = envelopeExit(text, result.exitCode);
    const hops = hopsFor({ trace, source, key, cmd, envId, result, bytes, transport: 'stream' });
    workspaces.record(ws, { commandKey: key, source, exitCode, bytes });
    send('done', { exitCode, source, traceId: trace.traceId, hops, ...(result.truncated ? { truncated: true } : {}), ...(result.error ? { error: result.error } : {}) });
    if (!res.destroyed) res.end();
    return undefined;
  }));

  api.post('/run', withWorkspace(async (ws, req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !['commandKey', 'vertical'].includes(k))) {
      return res.status(400).json({ error: 'bad_request', detail: 'body must be { commandKey } (and an optional vertical)' });
    }
    const found = lookupCommand(body.commandKey, commands);
    if (found.error) return lookupError(res, found);
    const ctl = workspaces.begin(ws);
    if (!ctl) return res.status(409).json({ error: 'run_in_progress', detail: 'One run at a time per workspace. Wait for it to finish or Reset.' });
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    const { key, ds: cmd } = found;
    const source = mode;
    const cast = loadCast(configFile, verticalFrom(body.vertical));
    const envId = envIdFor(cast);
    const trace = newTrace(req.headers.traceparent);
    // As in AI-DEMO2: `output` is stdout, or stderr when stdout is empty; stderr is also returned on its own.
    let raw = ''; let errText = '';
    let result;
    try {
      result = await runOne({ ws, key, cmd, cast, signal: ctl.signal, onText: (t, stream) => { if (stream === 'err') errText += t; else raw += t; } });
    } catch {
      result = { exitCode: 1, error: 'internal_error', argv: null };
    } finally { workspaces.end(ws, ctl); }
    let output = raw || errText;
    try { output = JSON.stringify(JSON.parse(output), null, 2); } catch { /* plain text */ }
    const exitCode = envelopeExit(raw, result.exitCode);
    const bytes = Buffer.byteLength(raw) + Buffer.byteLength(errText);
    const hops = hopsFor({ trace, source, key, cmd, envId, result, bytes, transport: 'run' });
    workspaces.record(ws, { commandKey: key, source, exitCode, bytes });
    res.set('traceparent', hops[0].traceparent);
    return res.json({ command: labelFor(cmd), output, ...(raw && errText ? { stderr: errText } : {}), exitCode, source, traceId: trace.traceId, hops, ...(result.truncated ? { truncated: true } : {}), ...(result.error ? { error: result.error } : {}) });
  }));

  api.get('/version', sameOriginOnly, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (mode === 'mock') return res.json({ version: MOCK_VERSION, source: 'mock', note: 'MOCK: the static-deck dataset id; no binary runs in Mock' });
    const v = await runner.version();
    // Real: report the pingcli binary version (the evidence fetch is the pinned read-only shape).
    return v.version ? res.json({ version: v.version, source: 'real', pinned: PINNED_VERSION, matchesPinned: v.version === PINNED_VERSION }) : res.status(503).json({ error: v.error, source: 'real' });
  });

  // customer.config.json is read on every request so editing it shows up on reload.
  api.get('/story', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...buildStory(castFor(req)), verticals: Object.keys(VERTICALS) }); });
  api.get('/diagram', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(buildDiagram(castFor(req), DIAGRAM_NAMES.includes(req.query.name) ? req.query.name : DIAGRAM_NAMES[0])); });
  api.get('/runs', withWorkspace((ws, _req, res) => res.json(workspaces.runs(ws))));
  // Reset stops this workspace's run in flight and clears its runs (the mode stays).
  api.post('/reset', withWorkspace((ws, _req, res) => {
    workspaces.resetWorkspace(ws);
    res.json({ reset: 'ok', workspace: ws });
  }));
  api.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);
  // Errors become short JSON. Express's default handler would send an HTML stack trace with absolute file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode);
    if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
    if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
    return res.status(500).json({ error: 'internal_error' });
  });

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  app.locals.mode = () => mode;
  app.locals.realAvailable = runner !== null;
  app.locals.dispose = async () => { workspaces.abortAll(); healthRouter.stop?.(); await runner?.dispose(); };
  app.locals.disposeSync = () => { workspaces.abortAll(); healthRouter.stop?.(); runner?.disposeSync(); };
  return app;
}

export function startHttpServer({ port, host, app = createApp() } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}/` }));
    server.once('error', reject);
  });
}
