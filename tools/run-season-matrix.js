#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');

function run(args) {
  console.log(`\n> node ${args.join(' ')}`);
  const result = spawnSync('node', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(['tools/check-built-artifact.js']);
for (const seed of [1, 2, 3]) {
  run(['tools/race-sim.js', '--seed', String(seed), '--dry', '--strict']);
  run(['tools/race-sim.js', '--seed', String(seed), '--rain', '--strict']);
}
console.log('\nSeason matrix OK: all calendar tracks × 3 seeds × dry/rain');
