#!/usr/bin/env node
// FAKE binary for tests. Behaves like the parts of pingcli the lab uses, and deliberately ECHOES its config file and
// environment back, so a test can prove the lab scrubs the secret and client id and strips PINGONE_* from the child.
import fs from 'node:fs';
const args = process.argv.slice(2);
const at = args.indexOf('--config');
const cfgPath = at >= 0 ? args[at + 1] : null;
const rest = at >= 0 ? [...args.slice(0, at), ...args.slice(at + 2)] : args;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (rest[0] === '--version') { process.stdout.write('pingcli version 1.2.0 (commit: 0000000000000000000000000000000000000000)\n'); process.exit(0); }
const cfg = cfgPath ? fs.readFileSync(cfgPath, 'utf8') : '';
const mode = cfgPath ? (fs.statSync(cfgPath).mode & 0o777).toString(8) : 'none';
if (rest.join(' ') === 'pingone auth login') {
  fs.mkdirSync(`${process.env.HOME}/.pingcli`, { recursive: true });
  fs.writeFileSync(`${process.env.HOME}/.pingcli/credentials`, 'token');
  process.stdout.write('Successfully authenticated with client credentials\n');
  process.exit(0);
}
// The secret, written in pieces across separate writes (and so separate chunks), then whole on stderr.
const secret = /clientSecret: "([^"]*)"/.exec(cfg)?.[1] || '';
process.stdout.write(`has-config=${at >= 0}\nconfig-mode=${mode}\nargs=${JSON.stringify(rest)}\nhome-has-token=${fs.existsSync(`${process.env.HOME}/.pingcli/credentials`)}\n`);
process.stdout.write(`env=${JSON.stringify(process.env)}\n`);
await sleep(30);
process.stdout.write(`split=${secret.slice(0, 5)}`);
await sleep(30);
process.stdout.write(`${secret.slice(5)}\n`);
await sleep(30);
process.stderr.write(`config<<\n${cfg}>>\n`);
process.stdout.write(`${JSON.stringify({ schemaVersion: '1.1', status: 'success', message: 'Custom request successful', data: { _embedded: { users: [{ id: 'u-1', username: 'stub.user' }] } } })}\n`);
