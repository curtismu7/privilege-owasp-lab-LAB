#!/usr/bin/env node
// FAKE binary that records that it ran (next to this file), so a test can prove Mock never starts a child process.
import fs from 'node:fs';
fs.appendFileSync(new URL('./marker.log', import.meta.url), `${process.argv.slice(2).join(' ')}\n`);
process.stdout.write('pingcli version 1.2.0 (commit: 0)\n');
