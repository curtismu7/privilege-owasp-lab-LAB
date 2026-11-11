import { installNetguard } from './netguard.js';
import { startHttpServer, createApp } from './app.js';
import { allPassed, runChecks } from './doctor.js';
import { createHealth } from './health.js';
import { assertBindAllowed, bindHost, resolvePort } from './safety.js';
import { settingsFilePath } from './config.js';
import { sweepStale } from './realRunner.js';

// The in-process guard: this server never opens a non-loopback socket. Real runs pingcli as a CHILD process, which has
// its own network use (PingOne); Mock starts no child at all.
installNetguard(); // before anything else can open a socket

// Private Real dirs a crashed run left behind (they hold a worker profile): ours only, and only when their process is gone.
const swept = sweepStale();
if (swept.length) console.log(`[privilege-owasp-lab] removed ${swept.length} stale private dir(s) from an earlier run`);

const settingsFile = settingsFilePath();
const checks = await runChecks({ settingsFile });
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[privilege-owasp-lab] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
let app = null;
const health = createHealth({ runChecks: () => runChecks({ settingsFile }), runtime: () => (app?.locals.mode() === 'real' ? 'live' : 'offline') });
app = createApp({ health, settingsFile });
const host = assertBindAllowed(bindHost(), process.env);
const { url } = await startHttpServer({ port: resolvePort(), host, app });
// Mode and whether Real is configured only; never a setting's value.
console.log(`[privilege-owasp-lab] lab at ${url} in ${app.locals.mode()} mode (${app.locals.realAvailable ? 'Real configured' : 'Mock only, no outbound network'})`);
console.log(`[privilege-owasp-lab] health: ${url}api/health`);
const stop = () => { app.locals.dispose().finally(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('exit', () => app.locals.disposeSync());
