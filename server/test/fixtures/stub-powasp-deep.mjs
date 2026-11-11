#!/usr/bin/env node
// FAKE binary that prints valid but 50000-deep JSON (JSON.parse copes; JSON.stringify and recursive walks would not).
if (process.argv.includes('login')) { process.stdout.write('ok\n'); process.exit(0); }
process.stdout.write(`${'['.repeat(50000)}${']'.repeat(50000)}\n`);
