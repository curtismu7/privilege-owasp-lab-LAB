#!/usr/bin/env node
// FAKE binary whose `auth login` takes 2 s and then (re)creates its HOME token store, like the real one would.
// It reports to the test's temp root (the parent of its private HOME): auth.pid when login starts, commands.log for
// every non-auth command that runs. A run that is stopped during auth must leave no command in commands.log.
import fs from 'node:fs';
import path from 'node:path';
const home = process.env.HOME;
const out = path.dirname(home);
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('pingcli version 1.2.0 (commit: 0)\n'); process.exit(0); }
if (args.includes('login')) {
  fs.writeFileSync(path.join(out, 'auth.pid'), String(process.pid));
  setTimeout(() => {
    fs.mkdirSync(path.join(home, '.pingcli'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pingcli', 'credentials'), 'token');
    process.stdout.write('Successfully authenticated with client credentials\n');
    process.exit(0);
  }, 2000);
} else {
  fs.appendFileSync(path.join(out, 'commands.log'), `${args.filter((a) => !a.includes(home)).join(' ')}\n`);
  process.stdout.write('{"schemaVersion":"1.1","status":"success","data":{"_embedded":{"users":[]}}}\n');
}
