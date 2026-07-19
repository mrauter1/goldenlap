export type AuditEventType =
  | 'suite-start'
  | 'phase-start'
  | 'case-start'
  | 'case-result'
  | 'progress'
  | 'warning'
  | 'failure'
  | 'suite-result';

export interface AuditEventFields {
  phase?: string;
  caseId?: string;
  completed?: number;
  total?: number;
  elapsedMilliseconds?: number;
  status?: 'running' | 'green' | 'amber' | 'red' | 'inconclusive' | 'failed';
  [key: string]: unknown;
}

/**
 * Stream one machine-readable audit event without changing a command's stdout
 * result contract. Stderr is deliberately unbuffered so a caller can stop a
 * long run as soon as a hard invariant fails or a trend becomes unacceptable.
 */
export function emitAuditEvent(
  suite: string,
  event: AuditEventType,
  fields: AuditEventFields = {}
): void {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    source: 'goldenlap-audit',
    suite,
    event,
    ...fields
  })}\n`);
}
