#!/usr/bin/env node
// FAKE binary that never finishes (for timeout and disconnect tests). Writes its pid so a test can check it was killed.
import fs from 'node:fs';
if (process.argv.includes('auth') || process.argv.includes('--version')) { process.stdout.write('pingcli version 1.2.0 (commit: 0)\n'); process.exit(0); }
fs.writeFileSync(`${process.env.HOME}/hang.pid`, String(process.pid));
process.stdout.write('started\n');
setInterval(() => {}, 1000);
