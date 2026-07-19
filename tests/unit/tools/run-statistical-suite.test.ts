import { describe, expect, test } from 'bun:test';

import type {
  FocusedSessionSummary,
  HeadlessRaceSummary
} from '../../../tools/lib/headless-sim';
import {
  invariantObservations,
  pathBoundCandidateRejectionDiagnostics
} from '../../../tools/run-statistical-suite';

function raceSummary(
  metrics: Record<string, number>,
  options: { finite?: boolean; classificationValid?: boolean } = {}
): HeadlessRaceSummary {
  return {
    finite: options.finite ?? true,
    classificationValid: options.classificationValid ?? true,
    checksum: 'race-checksum',
    metrics: {
      maximumCandidates: 6,
      maximumPathsMaterialized: 0,
      unexplainedStalls: 0,
      pitDeadlocks: 0,
      pitFalseLeaders: 0,
      repeatedDefenses: 0,
      softContactConcedes: 0,
      pathOutOfBoundsRejections: 0,
      ...metrics
    }
  } as unknown as HeadlessRaceSummary;
}

function focusedSummary(
  metrics: Record<string, number>,
  entries: Array<Partial<FocusedSessionSummary['entries'][number]>> = [{
    cross: 1,
    finishPosition: 1,
    speed: 20,
    lateral: 0,
    s: 10
  }]
): FocusedSessionSummary {
  return {
    entries,
    metrics: {
      maximumCandidates: 6,
      maximumPathsMaterialized: 0,
      unexplainedStalls: 0,
      pitDeadlocks: 0,
      pitFalseLeaders: 0,
      ...metrics
    }
  } as unknown as FocusedSessionSummary;
}

describe('run-statistical-suite aggregation', () => {
  test('omits retired geometry-authority invariant rows', () => {
    const observations = invariantObservations(
      [raceSummary({ maximumCandidates: 7 })],
      [focusedSummary({
        pathOutOfBoundsViolations: 9
      })],
      0
    );
    expect(observations.map(observation => observation.metric))
      .not.toContain('invariant.path_out_of_bounds');
    expect(observations.find(observation =>
      observation.metric === 'invariant.maneuver_candidate_limit'
    )).toMatchObject({ value: 1, samples: 2 });
    expect(observations.map(observation => observation.metric))
      .not.toContain('invariant.racecraft_claim_envelope');
  });

  test('reports candidate rejections from the live summary key only', () => {
    const diagnostics = pathBoundCandidateRejectionDiagnostics([
      {
        stratum: 'prado/dry',
        baseSeed: 101,
        replicate: 0,
        summary: raceSummary({
          pathOutOfBoundsRejections: 3,
          pathOutOfBoundsViolations: 11
        })
      },
      {
        stratum: 'villa/wet',
        baseSeed: 202,
        replicate: 1,
        summary: raceSummary({
          pathOutOfBoundsRejections: 0,
          pathOutOfBoundsViolations: 5
        })
      }
    ]);
    expect(diagnostics).toEqual([{
      value: 3,
      stratum: 'prado/dry',
      baseSeed: 101,
      replicate: 0,
      checksum: 'race-checksum'
    }]);
  });
});
