#!/usr/bin/env node
// FAKE binary that starts `sleep 40` sharing its stdout/stderr, then either exits at once (agent-skills list: the
// grandchild keeps the pipes open) or hangs (anything else). Writes the sleep pid to the test's temp root.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('--version') || args.includes('login')) { process.stdout.write('pingcli version 1.2.0 (commit: 0)\n'); process.exit(0); }
const sl = spawn('sleep', ['40'], { stdio: 'inherit' });
fs.writeFileSync(path.join(path.dirname(process.env.HOME), 'sleep.pid'), String(sl.pid));
process.stdout.write('started\n');
if (args.includes('list') || args.includes('-O')) process.exit(0);
setInterval(() => {}, 1000);
