import { describe, expect, test } from 'bun:test';
import type {
  FocusedSessionSummary,
  HeadlessRaceSummary
} from '../../../tools/lib/headless-sim';
import {
  aggregatePceScenes,
  PCE_FOCUSED_STEP_SECONDS,
  PCE_FOCUSED_SCENARIOS,
  PCE_FULL_FIELD_STEP_SECONDS,
  summarizeFocusedPceScene,
  summarizeFullFieldPceScene
} from '../../../tools/racecraft-certainty-equivalence-check';

function focusedSummary(): FocusedSessionSummary {
  return {
    scenario: 'faster-behind',
    reason: 'complete',
    simulatedSeconds: 12,
    checksum: 'focused',
    metrics: {
      emergencyAuthorizedGrassCarSeconds: 0.1,
      nonEmergencyGrassCarSeconds: 0.2,
      auditEmergencySurfaceSelections: 2,
      auditEmergencySurfaceAttributionFailures: 0,
      auditStraightPullOutSelections: 2,
      auditStraightPullOutEnvelopeFractionMinimum: 0.25,
      auditStraightPullOutEnvelopeFractionMean: 0.5,
      auditStraightPullOutEnvelopeFractionMaximum: 0.75,
      auditStraightPullOutSignedOffsetMinimumMetres: -2,
      auditStraightPullOutSignedOffsetMaximumMetres: 3,
      maximumContinuousContactDurationSeconds: 0.3,
      auditContestLateralSelections: 7,
      auditContestBrakeSelections: 2,
      auditContestInlineSelections: 1,
      auditAttackInitiations: 3,
      auditAttackCompletions: 1,
      auditEndingBodyClearance: -4,
      auditDerivedFollowBodyFloor: 0.21,
      maximumCandidates: 6,
      pathsMaterialized: 0
    },
    diagnostics: {
      racecraftClaimRevisionReasons: {
        'prediction-source': 1
      }
    }
  } as unknown as FocusedSessionSummary;
}

function raceSummary(): HeadlessRaceSummary {
  return {
    reason: 'complete',
    simulatedSeconds: 90,
    checksum: 'race',
    exposure: {
      emergencyAuthorizedGrassCarSeconds: 0.4,
      nonEmergencyGrassCarSeconds: 0.6
    },
    metrics: {
      emergencySurfaceSelections: 1,
      emergencySurfaceAttributionFailures: 1,
      straightPullOutSelections: 3,
      straightPullOutEnvelopeFractionMinimum: 0.1,
      straightPullOutEnvelopeFractionMean: 0.6,
      straightPullOutEnvelopeFractionMaximum: 1,
      straightPullOutSignedOffsetMinimumMetres: -4,
      straightPullOutSignedOffsetMaximumMetres: 5,
      maximumContinuousContactDurationSeconds: 0.8,
      attackInitiations: 8,
      attackCompletions: 4,
      maximumCandidates: 5,
      pathsMaterialized: 0
    },
    diagnostics: {
      racecraftClaimRevisionReasons: {
        'prediction-source': 2
      }
    }
  } as unknown as HeadlessRaceSummary;
}

describe('P-CE phase probe observer', () => {
  test('retains the prior P-C focused scenario set', () => {
    expect(PCE_FOCUSED_SCENARIOS).toEqual([
      'attack-launch',
      'switchback',
      'faster-behind',
      'side-by-side-corner'
    ]);
    expect(PCE_FOCUSED_STEP_SECONDS).toBe(1 / 120);
    expect(PCE_FULL_FIELD_STEP_SECONDS).toBe(1 / 120);
  });

  test('projects only already-observed P-CE evidence', () => {
    const focused = summarizeFocusedPceScene(focusedSummary());
    const fullField = summarizeFullFieldPceScene(raceSummary());
    expect(focused.followGap).toEqual({
      observationKind: 'endpoint-after-pass',
      endingBodyClearanceMetres: -4,
      derivedBodyClearanceFloorMetres: 0.21
    });
    expect(focused.concessions).toEqual({
      lateralSelections: 7,
      brakeSelections: 2,
      inlineSelections: 1
    });
    expect(fullField.concessions).toBeNull();
    expect(fullField.grass.attributionFailures).toBe(1);

    const aggregate = aggregatePceScenes([focused, fullField]);
    expect(aggregate.grass).toEqual({
      emergencyAuthorizedCarSeconds: 0.5,
      nonEmergencyCarSeconds: 0.8,
      emergencySelections: 3,
      attributionFailures: 1
    });
    expect(aggregate.pullOut.selections).toBe(5);
    expect(aggregate.pullOut.envelopeFraction).toMatchObject({
      minimum: 0.1,
      maximum: 1
    });
    expect(aggregate.pullOut.envelopeFraction.mean).toBeCloseTo(0.56);
    expect(aggregate.pullOut.signedOffsetMetres).toEqual({
      minimum: -4,
      maximum: 5
    });
    expect(aggregate.maximumContinuousContactDurationSeconds).toBe(0.8);
    expect(aggregate.passes).toEqual({ attempted: 11, completed: 5 });
    expect(aggregate.budgets).toEqual({
      maximumCandidates: 6,
      maximumMaterializations: 0
    });
    expect(aggregate.predictionSourceBreaks).toBe(3);
  });
});
