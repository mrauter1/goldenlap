import { describe, expect, test } from 'bun:test';

import type {
  FocusedSessionSummary,
  HeadlessRaceSummary
} from '../../../tools/lib/headless-sim';
import {
  HARD_CONTACT_CAP,
  focusedInvariantFailures,
  raceInvariantFailures
} from '../../../tools/lib/audit-invariants';

function raceSummary(
  metrics: Record<string, number>
): HeadlessRaceSummary {
  return {
    finite: true,
    classificationValid: true,
    metrics: {
      laneUnpinnedEdits: 0,
      laneMaximumPinError: 0,
      maximumCandidates: 6,
      maximumPathsMaterialized: 0,
      unexplainedStalls: 0,
      pitDeadlocks: 0,
      pitFalseLeaders: 0,
      repeatedDefenses: 0,
      softContactConcedes: 0,
      hardContacts: HARD_CONTACT_CAP,
      ...metrics
    }
  } as unknown as HeadlessRaceSummary;
}

function focusedSummary(
  metrics: Record<string, number>
): FocusedSessionSummary {
  return {
    entries: [{
      cross: 1,
      finishPosition: 1,
      speed: 20,
      lateral: 0,
      s: 10
    }],
    metrics: {
      laneUnpinnedEdits: 0,
      laneMaximumPinError: 0,
      maximumCandidates: 6,
      maximumPathsMaterialized: 0,
      unexplainedStalls: 0,
      pitDeadlocks: 0,
      pitFalseLeaders: 0,
      ...metrics
    }
  } as unknown as FocusedSessionSummary;
}

describe('audit invariant contracts', () => {
  test('ignores the retired path-out-of-bounds summary key in race audits', () => {
    const failures = raceInvariantFailures(raceSummary({
      pathOutOfBoundsRejections: 3,
      pathOutOfBoundsViolations: 9
    }));
    expect(failures).toEqual([]);
  });

  test('ignores the retired path-out-of-bounds summary key in focused audits', () => {
    const failures = focusedInvariantFailures(focusedSummary({
      pathOutOfBoundsRejections: 2,
      pathOutOfBoundsViolations: 7
    }));
    expect(failures).toEqual([]);
  });

  test('still reports active invariant failures after the contract cleanup', () => {
    expect(raceInvariantFailures(raceSummary({
      hardContacts: HARD_CONTACT_CAP + 1
    }))).toContain('hard-contact-cap');
    expect(focusedInvariantFailures(focusedSummary({
      laneMaximumPinError: 0.1
    }))).toContain('lane-edit-unpinned');
  });
});
