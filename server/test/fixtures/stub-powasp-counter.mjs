#!/usr/bin/env node
// FAKE binary that counts its runs in the test's temp root (version.log), slowly, so parallel callers overlap.
import fs from 'node:fs';
import path from 'node:path';
fs.appendFileSync(path.join(path.dirname(process.env.HOME), 'version.log'), 'x\n');
setTimeout(() => { process.stdout.write('pingcli version 1.2.0 (commit: 0)\n'); }, 300);
