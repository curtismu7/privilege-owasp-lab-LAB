// Preflight checks shared by `npm run doctor` and GET /api/health. Never prints a setting's value, needs no network,
// never runs pingcli. Each check: { id, level: 'pass' | 'info' | 'fail', detail }.
// settingsFile: the settings file to read for Real (null = environment only; tests never read the owner's file).
import { assertBindAllowed, bindHost, portProblem, scanHosts, scanKeys, DEFAULT_PORT, PORT_MIN } from './safety.js';
import { netguardSelfTest } from './netguard.js';
import { DEFAULT_CAST, VERTICALS, unfilled } from './cast.js';
import { buildStory, rawStory } from './story.js';
import { binaryFrom, modeFrom, realProblemFrom, settingsFrom } from './config.js';
import { DIAGRAM_NAMES, buildDiagram, rawDiagram } from './diagramData.js';
import { COMMANDS, COMMAND_KEYS } from './commands.js';
import { mockOutput } from './mockOutput.js';
import { buildReadableView } from './readable.js';

// One scenario against the Mock output: does it show what it says it shows?
export function checkScenario(sc, cast = DEFAULT_CAST) {
  if (!Object.hasOwn(COMMANDS, sc.commandKey)) return [`unknown dataset ${sc.commandKey}`];
  const out = mockOutput(sc.commandKey, cast);
  const view = buildReadableView(out.text);
  const e = sc.expect || {};
  const problems = [];
  if (out.exitCode !== 0) problems.push('mock exit code is not 0');
  if (e.view === 'text' && view !== null) problems.push('expected plain text output');
  if (e.view === 'table' && view?.kind !== 'table') problems.push('expected a table');
  if (e.view === 'form' && view?.kind !== 'form') problems.push('expected a form');
  if (e.minRows !== undefined && (view?.rows?.length ?? 0) < e.minRows) problems.push(`fewer than ${e.minRows} rows`);
  return problems;
}

export async function runChecks({ env = process.env, cast = DEFAULT_CAST, settingsFile = null } = {}) {
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20 ? 'pass' : 'fail', `v${process.versions.node} (need >= 20)`);

  const problem = realProblemFrom(settingsFrom(env, settingsFile), binaryFrom(env));
  try { add('mode', 'pass', `mode=${modeFrom(env, problem === null)}${problem === null ? ' (Real configured)' : ' (Mock only)'}`); }
  catch (e) { add('mode', 'fail', e.message); }
  add('real', 'info', problem === null ? 'Real is configured (values not shown)' : problem);

  try { add('bind', 'pass', `${assertBindAllowed(bindHost(env), env)}${env.POWASP_BIND ? ' (POWASP_BIND opt-in)' : ' (loopback)'}`); }
  catch (e) { add('bind', 'fail', e.message); }

  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  const portBad = portProblem(port);
  add('port-range', portBad ? 'fail' : 'pass', portBad || `${port} is the allocated port ${PORT_MIN} and not reserved`);

  add('commands', COMMAND_KEYS.length === 13 ? 'pass' : 'fail', `${COMMAND_KEYS.length} allow-listed datasets (expected 13)`);
  const noMock = [];
  for (const [name, v] of Object.entries(VERTICALS)) for (const k of COMMAND_KEYS) { try { if (!mockOutput(k, v).text) noMock.push(`${name}/${k}`); } catch { noMock.push(`${name}/${k}`); } }
  add('mock-output', noMock.length ? 'fail' : 'pass', noMock.length ? `no mock output for ${noMock.join(', ')}` : `every command has Mock output in all ${Object.keys(VERTICALS).length} verticals`);

  const raw = rawStory();
  const wrong = raw.scenarios.map((sc) => [sc.id, checkScenario(sc, cast)]).filter(([, p]) => p.length).map(([id, p]) => `${id} (${p.join('; ')})`);
  add('scenarios', raw.scenarios.length >= 5 && !wrong.length ? 'pass' : 'fail', wrong.length ? `scenarios that do not show what they claim: ${wrong.join(', ')}` : `${raw.scenarios.length} scenarios each show what they claim`);
  const unlabelled = raw.facts.filter((f) => !['observed-in-AI-DEMO2', 'captured', 'UNVERIFIED', 'lab'].includes(f.status));
  add('facts-labelled', unlabelled.length ? 'fail' : 'pass', unlabelled.length ? 'a fact has no status label' : 'every fact is labelled observed-in-AI-DEMO2, captured, UNVERIFIED or lab');
  const text = JSON.stringify([raw, DIAGRAM_NAMES.map((n) => rawDiagram(n))]);
  const holes = unfilled(text, DEFAULT_CAST);
  add('story-tokens', holes.length ? 'fail' : 'pass', holes.length ? `unfilled {{tokens}}: ${[...new Set(holes)].join(', ')}` : 'every {{cast}} token is filled');
  const badVert = Object.entries(VERTICALS).filter(([, v]) => unfilled(text, v).length).map(([k]) => k);
  add('verticals', badVert.length ? 'fail' : 'pass', badVert.length ? `verticals missing a token: ${badVert.join(', ')}` : `${Object.keys(VERTICALS).length} vertical packs fill every token`);

  const filled = JSON.stringify([buildStory(cast), COMMAND_KEYS.map((k) => mockOutput(k, cast).text)]);
  const hosts = scanHosts(filled);
  add('story-hosts', hosts.length ? 'fail' : 'pass', hosts.length ? `non-reserved hosts: ${hosts.join(', ')}` : 'every host in the story and the Mock output is .invalid or .example');
  const keys = scanKeys(filled);
  add('story-keys', keys.length ? 'fail' : 'pass', keys.length ? 'key-looking values that are not sk-MOCK-' : 'no key-looking values in the story or the Mock output');
  add('diagrams', DIAGRAM_NAMES.every((n) => buildDiagram(cast, n).steps.length > 0) ? 'pass' : 'fail', `${DIAGRAM_NAMES.length} diagram-studio/1 diagram loads and validates`);

  const ng = await netguardSelfTest();
  add('netguard', ng.ok ? 'pass' : 'fail', ng.ok ? `blocked fetch, socket, socket-by-IP, dns lookup, dns resolve and udp to a non-loopback host (${ng.blocked}/6)` : ng.detail);

  add('tenant', 'pass', 'Mock needs no tenant or credentials and makes no outbound network call; Real runs pingcli (its own network use) with credentials the owner supplies');
  return checks;
}

export const allPassed = (checks) => checks.every((c) => c.level !== 'fail');
