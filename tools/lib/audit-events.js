'use strict';

function emitAuditEvent(suite, event, fields = {}) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    source: 'goldenlap-audit',
    suite,
    event,
    ...fields
  })}\n`);
}

module.exports = { emitAuditEvent };
