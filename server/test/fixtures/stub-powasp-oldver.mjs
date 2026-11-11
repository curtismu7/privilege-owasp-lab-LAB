#!/usr/bin/env node
// FAKE binary that reports an older version than the pinned one.
process.stdout.write('pingcli version 1.1.0 (commit: 0000000000000000000000000000000000000000)\n');
