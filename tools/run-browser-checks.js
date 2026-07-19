#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { emitAuditEvent } = require('./lib/audit-events');
const root = path.resolve(__dirname, '..');
const smoke = process.argv.includes('--smoke');
const production = process.argv.includes('--expect-production');

function run(command, args) {
  const caseId = args[0] || command;
  emitAuditEvent('browser-checks', 'case-start', {
    phase: smoke ? 'smoke' : 'suite', caseId, status: 'running'
  });
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    emitAuditEvent('browser-checks', 'failure', {
      caseId, status: 'failed', message: result.error.message
    });
    throw result.error;
  }
  emitAuditEvent('browser-checks', 'case-result', {
    phase: smoke ? 'smoke' : 'suite',
    caseId,
    status: result.status === 0 ? 'green' : 'failed',
    exitCode: result.status
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

emitAuditEvent('browser-checks', 'suite-start', {
  mode: smoke ? 'smoke' : 'full', production, status: 'running'
});

run('node', ['tools/check-built-artifact.js', ...(production ? ['--expect-production'] : [])]);
run('node', ['tools/parity-check.js']);
run('node', ['tools/parity-check.js', 'golden-lap.html']);
run('node', ['tools/track-studio-check.js']);
if (!smoke) {
  run('node', ['tools/trackscore.js']);
}
console.log(`\nBrowser ${smoke ? 'smoke' : 'suite'} OK${production ? ' (production)' : ''}`);
emitAuditEvent('browser-checks', 'suite-result', {
  mode: smoke ? 'smoke' : 'full', production, status: 'green'
});
