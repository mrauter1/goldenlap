#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const smoke = process.argv.includes('--smoke');
const production = process.argv.includes('--expect-production');

function run(command, args) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run('node', ['tools/check-built-artifact.js', ...(production ? ['--expect-production'] : [])]);
run('node', ['tools/parity-check.js']);
run('node', ['tools/parity-check.js', 'golden-lap.html']);
if (!smoke) {
  run('node', ['tools/trackscore.js']);
  run('node', ['tools/racecraft-check.js']);
  run('node', ['tools/racecraft-edge-check.js']);
  run('node', ['tools/racecraft-followup-check.js', '--mode', 'baseline']);
  run('node', ['tools/racecraft-ui-check.js']);
}
console.log(`\nBrowser ${smoke ? 'smoke' : 'suite'} OK${production ? ' (production)' : ''}`);
