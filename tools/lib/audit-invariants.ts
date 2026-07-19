import type { FocusedSessionSummary, HeadlessRaceSummary } from './headless-sim';

export const HARD_CONTACT_CAP = 30;

function metric(summary: FocusedSessionSummary, name: string): number {
  return summary.metrics[name] ?? 0;
}

export function finiteFocusedSummary(summary: FocusedSessionSummary): boolean {
  return summary.entries.every(entry => [entry.cross, entry.finishPosition, entry.speed,
    entry.lateral, entry.s].every(value => value === null || Number.isFinite(value))) &&
    Object.values(summary.metrics).every(Number.isFinite);
}

export function raceInvariantFailures(summary: HeadlessRaceSummary): string[] {
  const failures: string[] = [];
  if (!summary.finite) failures.push('non-finite-state');
  if (!summary.classificationValid) failures.push('invalid-classification');
  if (summary.metrics.laneUnpinnedEdits > 0 || summary.metrics.laneMaximumPinError > 0)
    failures.push('lane-edit-unpinned');
  if (summary.metrics.maximumCandidates > 6) failures.push('candidate-limit');
  if (summary.metrics.maximumPathsMaterialized > 0) failures.push('materialization-limit');
  if (summary.metrics.unexplainedStalls > 0) failures.push('unexplained-stall');
  if (summary.metrics.pitDeadlocks > 0) failures.push('pit-deadlock');
  if (summary.metrics.pitFalseLeaders > 0) failures.push('pit-false-leader');
  if (summary.metrics.repeatedDefenses > 0) failures.push('repeated-defense');
  if (summary.metrics.softContactConcedes > 0) failures.push('soft-contact-concede');
  if (summary.metrics.hardContacts > HARD_CONTACT_CAP) failures.push('hard-contact-cap');
  // Light contacts are an uncapped racing outcome. They remain observable,
  // but only suspension-damaging impacts can fail the contact guardrail.
  return failures;
}

export function focusedInvariantFailures(summary: FocusedSessionSummary): string[] {
  const failures: string[] = [];
  if (!finiteFocusedSummary(summary)) failures.push('non-finite-state');
  if (metric(summary, 'laneUnpinnedEdits') > 0 ||
      metric(summary, 'laneMaximumPinError') > 0)
    failures.push('lane-edit-unpinned');
  if (metric(summary, 'maximumCandidates') > 6) failures.push('candidate-limit');
  if (metric(summary, 'maximumPathsMaterialized') > 0)
    failures.push('materialization-limit');
  if (metric(summary, 'unexplainedStalls') > 0) failures.push('unexplained-stall');
  if (metric(summary, 'pitDeadlocks') > 0) failures.push('pit-deadlock');
  if (metric(summary, 'pitFalseLeaders') > 0) failures.push('pit-false-leader');
  return failures;
}
