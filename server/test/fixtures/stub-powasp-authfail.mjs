#!/usr/bin/env node
// FAKE binary whose auth login fails and prints the secret from its config in the error (the lab must scrub it).
import fs from 'node:fs';
const args = process.argv.slice(2);
const cfg = fs.readFileSync(args[args.indexOf('--config') + 1], 'utf8');
const secret = /clientSecret: "([^"]*)"/.exec(cfg)?.[1];
const id = /clientID: "([^"]*)"/.exec(cfg)?.[1];
process.stderr.write(`Error: invalid_client for client ${id} with secret ${secret}\n`);
process.exit(1);
