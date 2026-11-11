import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { portProblem } from '../server/src/safety.js';

// Every published port must be bound to loopback on the host. A small line parser (no YAML dependency).
export function publishedPorts(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)ports:\s*$/.exec(lines[i]);
    if (!m) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*["']?([^"'\s#]+)["']?/.exec(lines[j]);
      if (!item || lines[j].search(/\S/) <= m[1].length) break;
      out.push(item[1]);
    }
  }
  return out;
}
const here = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('docker-compose.yml publishes only on 127.0.0.1', () => {
  const ports = publishedPorts(here('docker-compose.yml'));
  assert.ok(ports.length > 0, 'the parser found the published port');
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `${p} must start with 127.0.0.1:`);
});

test('the parser flags an unbound or wildcard publish', () => {
  for (const bad of ['- "7811:7811"', '- "0.0.0.0:7811:7811"', '- 7811', '- "::1:7811:7811"']) {
    const ports = publishedPorts(`services:\n  a:\n    ports:\n      ${bad}\n`);
    assert.equal(ports.length, 1);
    assert.doesNotMatch(ports[0], /^127\.0\.0\.1:/);
  }
});

test('compose default host port and Dockerfile port are 7811 and agree', () => {
  const compose = here('docker-compose.yml');
  const host = Number(/\$\{HOST_PORT:-(\d+)\}/.exec(compose)[1]);
  assert.equal(host, 7811);
  assert.equal(portProblem(host), null);
  const docker = here('Dockerfile');
  const port = Number(/^EXPOSE (\d+)/m.exec(docker)[1]);
  assert.equal(port, 7811);
  assert.match(compose, new RegExp(`:${port}"`));
  assert.match(docker, /^ENV POWASP_BIND=0\.0\.0\.0$/m);
  assert.match(docker, /^USER node$/m);
});

test('the container is locked down: read-only fs with only a tmpfs /tmp, no capabilities, no new privileges, restarts', () => {
  const compose = here('docker-compose.yml');
  assert.match(compose, /read_only: true/);
  assert.match(compose, /tmpfs: \["\/tmp:mode=1777,size=64m"\]/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /restart: unless-stopped/);
  assert.doesNotMatch(compose, /volumes:/, 'nothing from the host is mounted');
});

test('Real settings are passed through from the shell with empty defaults: never a committed value, never baked', () => {
  const compose = here('docker-compose.yml');
  for (const name of ['PINGONE_ENVIRONMENT_ID', 'PINGONE_REGION', 'PINGONE_CLIENT_ID', 'PINGONE_CLIENT_SECRET']) {
    assert.match(compose, new RegExp(`^      ${name}: \\$\\{${name}:-\\}$`, 'm'), `${name} defaults to empty`);
    assert.doesNotMatch(here('Dockerfile'), new RegExp(name), `${name} is not in the image`);
  }
  assert.match(compose, /^      MODE: \$\{POWASP_MODE:-\}$/m);
  assert.match(here('.dockerignore'), /^\.env$/m);
  assert.match(here('.gitignore'), /^\.env$/m);
});
