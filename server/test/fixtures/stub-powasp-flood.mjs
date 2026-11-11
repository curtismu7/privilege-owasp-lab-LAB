#!/usr/bin/env node
// FAKE binary that prints far more than the output cap.
if (process.argv.includes('auth')) { process.stdout.write('ok\n'); process.exit(0); }
const line = `${'x'.repeat(1023)}\n`;
let n = 0;
const write = () => { while (n < 4096) { n += 1; if (!process.stdout.write(line)) { process.stdout.once('drain', write); return; } } };
write();
