import {
  prepareHeadlessTrack,
  runFocusedSession,
  runHeadlessRace,
  type FocusedSessionSummary,
  type HeadlessRaceSummary
} from './lib/headless-sim';

export const PCE_PROBE_SEED = 101;
export const PCE_FOCUSED_STEP_SECONDS = 1 / 120;
export const PCE_FULL_FIELD_STEP_SECONDS = 1 / 120;

export const PCE_FOCUSED_SCENARIOS = [
  'attack-launch',
  'switchback',
  'faster-behind',
  'side-by-side-corner'
] as const;

interface PullOutDistribution {
  selections: number;
  envelopeFraction: {
    minimum: number | null;
    mean: number | null;
    maximum: number | null;
  };
  signedOffsetMetres: {
    minimum: number | null;
    maximum: number | null;
  };
}

interface GrassObservation {
  emergencyAuthorizedCarSeconds: number;
  nonEmergencyCarSeconds: number;
  emergencySelections: number;
  attributionFailures: number;
}

interface ConcessionObservation {
  lateralSelections: number;
  brakeSelections: number;
  inlineSelections: number;
}

interface FollowGapObservation {
  observationKind: 'endpoint-after-pass' | 'endpoint-without-settle-proof';
  endingBodyClearanceMetres: number;
  derivedBodyClearanceFloorMetres: number;
}

export interface PceSceneObservation {
  scene: string;
  reason: FocusedSessionSummary['reason'] | HeadlessRaceSummary['reason'];
  simulatedSeconds: number;
  checksum: string;
  grass: GrassObservation;
  pullOut: PullOutDistribution;
  maximumContinuousContactDurationSeconds: number;
  concessions: ConcessionObservation | null;
  passes: {
    attempted: number;
    completed: number;
  };
  followGap: FollowGapObservation | null;
  budgets: {
    maximumCandidates: number;
    maximumMaterializations: number;
  };
  predictionSourceBreaks: number;
}

export interface PceProbeOutput {
  schemaVersion: 1;
  probe: 'p-ce-certainty-equivalence';
  trackId: 'prado';
  seed: number;
  focusedStepSeconds: number;
  fullFieldStepSeconds: number;
  focused: PceSceneObservation[];
  fullField: PceSceneObservation;
  aggregate: {
    grass: GrassObservation;
    pullOut: PullOutDistribution;
    maximumContinuousContactDurationSeconds: number;
    concessions: ConcessionObservation;
    passes: {
      attempted: number;
      completed: number;
    };
    followGap: FollowGapObservation | null;
    budgets: {
      maximumCandidates: number;
      maximumMaterializations: number;
    };
    predictionSourceBreaks: number;
  };
}

function metric(
  summary: FocusedSessionSummary,
  name: string
): number {
  return summary.metrics[name] ?? 0;
}

function observedOrNull(
  selections: number,
  value: number
): number | null {
  return selections > 0 && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function summarizeFocusedPceScene(
  summary: FocusedSessionSummary
): PceSceneObservation {
  const pullOutSelections = metric(
    summary,
    'auditStraightPullOutSelections'
  );
  const attackCompletions = metric(summary, 'auditAttackCompletions');
  const endingBodyClearance = metric(
    summary,
    'auditEndingBodyClearance'
  );
  const isFollowScene = summary.scenario === 'faster-behind' &&
    Number.isFinite(endingBodyClearance) &&
    endingBodyClearance !== -1;
  return {
    scene: summary.scenario,
    reason: summary.reason,
    simulatedSeconds: summary.simulatedSeconds,
    checksum: summary.checksum,
    grass: {
      emergencyAuthorizedCarSeconds: metric(
        summary,
        'emergencyAuthorizedGrassCarSeconds'
      ),
      nonEmergencyCarSeconds: metric(
        summary,
        'nonEmergencyGrassCarSeconds'
      ),
      emergencySelections: metric(
        summary,
        'auditEmergencySurfaceSelections'
      ),
      attributionFailures: metric(
        summary,
        'auditEmergencySurfaceAttributionFailures'
      )
    },
    pullOut: {
      selections: pullOutSelections,
      envelopeFraction: {
        minimum: observedOrNull(
          pullOutSelections,
          metric(summary, 'auditStraightPullOutEnvelopeFractionMinimum')
        ),
        mean: observedOrNull(
          pullOutSelections,
          metric(summary, 'auditStraightPullOutEnvelopeFractionMean')
        ),
        maximum: observedOrNull(
          pullOutSelections,
          metric(summary, 'auditStraightPullOutEnvelopeFractionMaximum')
        )
      },
      signedOffsetMetres: {
        minimum: pullOutSelections > 0
          ? metric(summary, 'auditStraightPullOutSignedOffsetMinimumMetres')
          : null,
        maximum: pullOutSelections > 0
          ? metric(summary, 'auditStraightPullOutSignedOffsetMaximumMetres')
          : null
      }
    },
    maximumContinuousContactDurationSeconds: metric(
      summary,
      'maximumContinuousContactDurationSeconds'
    ),
    concessions: {
      lateralSelections: metric(
        summary,
        'auditContestLateralSelections'
      ),
      brakeSelections: metric(summary, 'auditContestBrakeSelections'),
      inlineSelections: metric(summary, 'auditContestInlineSelections')
    },
    passes: {
      attempted: metric(summary, 'auditAttackInitiations'),
      completed: attackCompletions
    },
    followGap: isFollowScene
      ? {
          // The focused observer exposes the terminal sample, not a
          // stability classifier. Keep that distinction explicit so a pass
          // endpoint cannot be reported as a settled tucked gap.
          observationKind: attackCompletions > 0
            ? 'endpoint-after-pass'
            : 'endpoint-without-settle-proof',
          endingBodyClearanceMetres: endingBodyClearance,
          derivedBodyClearanceFloorMetres: metric(
            summary,
            'auditDerivedFollowBodyFloor'
          )
        }
      : null,
    budgets: {
      maximumCandidates: metric(summary, 'maximumCandidates'),
      maximumMaterializations: metric(summary, 'pathsMaterialized')
    },
    predictionSourceBreaks:
      summary.diagnostics.racecraftClaimRevisionReasons[
        'prediction-source'
      ] ?? 0
  };
}

export function summarizeFullFieldPceScene(
  summary: HeadlessRaceSummary
): PceSceneObservation {
  const pullOutSelections = summary.metrics.straightPullOutSelections;
  return {
    scene: 'full-field-prado',
    reason: summary.reason,
    simulatedSeconds: summary.simulatedSeconds,
    checksum: summary.checksum,
    grass: {
      emergencyAuthorizedCarSeconds:
        summary.exposure.emergencyAuthorizedGrassCarSeconds,
      nonEmergencyCarSeconds:
        summary.exposure.nonEmergencyGrassCarSeconds,
      emergencySelections: summary.metrics.emergencySurfaceSelections,
      attributionFailures:
        summary.metrics.emergencySurfaceAttributionFailures
    },
    pullOut: {
      selections: pullOutSelections,
      envelopeFraction: {
        minimum: observedOrNull(
          pullOutSelections,
          summary.metrics.straightPullOutEnvelopeFractionMinimum
        ),
        mean: observedOrNull(
          pullOutSelections,
          summary.metrics.straightPullOutEnvelopeFractionMean
        ),
        maximum: observedOrNull(
          pullOutSelections,
          summary.metrics.straightPullOutEnvelopeFractionMaximum
        )
      },
      signedOffsetMetres: {
        minimum: pullOutSelections > 0
          ? summary.metrics.straightPullOutSignedOffsetMinimumMetres
          : null,
        maximum: pullOutSelections > 0
          ? summary.metrics.straightPullOutSignedOffsetMaximumMetres
          : null
      }
    },
    maximumContinuousContactDurationSeconds:
      summary.metrics.maximumContinuousContactDurationSeconds,
    concessions: null,
    passes: {
      attempted: summary.metrics.attackInitiations,
      completed: summary.metrics.attackCompletions
    },
    followGap: null,
    budgets: {
      maximumCandidates: summary.metrics.maximumCandidates,
      maximumMaterializations: summary.metrics.pathsMaterialized
    },
    predictionSourceBreaks:
      summary.diagnostics.racecraftClaimRevisionReasons[
        'prediction-source'
      ] ?? 0
  };
}

function aggregatePullOut(
  observations: readonly PceSceneObservation[]
): PullOutDistribution {
  const observed = observations.filter(item => item.pullOut.selections > 0);
  const selections = observed.reduce(
    (sum, item) => sum + item.pullOut.selections,
    0
  );
  if (selections === 0)
    return {
      selections: 0,
      envelopeFraction: {
        minimum: null,
        mean: null,
        maximum: null
      },
      signedOffsetMetres: {
        minimum: null,
        maximum: null
      }
    };
  const envelopeMeans = observed.flatMap(item =>
    item.pullOut.envelopeFraction.mean == null
      ? []
      : [{
          value: item.pullOut.envelopeFraction.mean,
          weight: item.pullOut.selections
        }]);
  const weightedCount = envelopeMeans.reduce(
    (sum, item) => sum + item.weight,
    0
  );
  const minimums = observed.flatMap(item =>
    item.pullOut.envelopeFraction.minimum == null
      ? []
      : [item.pullOut.envelopeFraction.minimum]);
  const maximums = observed.flatMap(item =>
    item.pullOut.envelopeFraction.maximum == null
      ? []
      : [item.pullOut.envelopeFraction.maximum]);
  const signedMinimums = observed.flatMap(item =>
    item.pullOut.signedOffsetMetres.minimum == null
      ? []
      : [item.pullOut.signedOffsetMetres.minimum]);
  const signedMaximums = observed.flatMap(item =>
    item.pullOut.signedOffsetMetres.maximum == null
      ? []
      : [item.pullOut.signedOffsetMetres.maximum]);
  return {
    selections,
    envelopeFraction: {
      minimum: minimums.length ? Math.min(...minimums) : null,
      mean: weightedCount
        ? envelopeMeans.reduce(
            (sum, item) => sum + item.value * item.weight,
            0
          ) / weightedCount
        : null,
      maximum: maximums.length ? Math.max(...maximums) : null
    },
    signedOffsetMetres: {
      minimum: signedMinimums.length ? Math.min(...signedMinimums) : null,
      maximum: signedMaximums.length ? Math.max(...signedMaximums) : null
    }
  };
}

export function aggregatePceScenes(
  observations: readonly PceSceneObservation[]
): PceProbeOutput['aggregate'] {
  return {
    grass: {
      emergencyAuthorizedCarSeconds: observations.reduce(
        (sum, item) => sum + item.grass.emergencyAuthorizedCarSeconds,
        0
      ),
      nonEmergencyCarSeconds: observations.reduce(
        (sum, item) => sum + item.grass.nonEmergencyCarSeconds,
        0
      ),
      emergencySelections: observations.reduce(
        (sum, item) => sum + item.grass.emergencySelections,
        0
      ),
      attributionFailures: observations.reduce(
        (sum, item) => sum + item.grass.attributionFailures,
        0
      )
    },
    pullOut: aggregatePullOut(observations),
    maximumContinuousContactDurationSeconds: observations.reduce(
      (maximum, item) => Math.max(
        maximum,
        item.maximumContinuousContactDurationSeconds
      ),
      0
    ),
    concessions: observations.reduce<ConcessionObservation>(
      (sum, item) => ({
        lateralSelections:
          sum.lateralSelections + (item.concessions?.lateralSelections ?? 0),
        brakeSelections:
          sum.brakeSelections + (item.concessions?.brakeSelections ?? 0),
        inlineSelections:
          sum.inlineSelections + (item.concessions?.inlineSelections ?? 0)
      }),
      {
        lateralSelections: 0,
        brakeSelections: 0,
        inlineSelections: 0
      }
    ),
    passes: {
      attempted: observations.reduce(
        (sum, item) => sum + item.passes.attempted,
        0
      ),
      completed: observations.reduce(
        (sum, item) => sum + item.passes.completed,
        0
      )
    },
    followGap: observations.find(item => item.followGap)?.followGap ?? null,
    budgets: {
      maximumCandidates: observations.reduce(
        (maximum, item) => Math.max(
          maximum,
          item.budgets.maximumCandidates
        ),
        0
      ),
      maximumMaterializations: observations.reduce(
        (maximum, item) => Math.max(
          maximum,
          item.budgets.maximumMaterializations
        ),
        0
      )
    },
    predictionSourceBreaks: observations.reduce(
      (sum, item) => sum + item.predictionSourceBreaks,
      0
    )
  };
}

export function runPcePhaseProbe(): PceProbeOutput {
  const track = prepareHeadlessTrack('prado');
  const focused = PCE_FOCUSED_SCENARIOS.map(scenario =>
    summarizeFocusedPceScene(runFocusedSession(track, {
      scenario,
      seed: PCE_PROBE_SEED,
      step: PCE_FOCUSED_STEP_SECONDS,
      wet: 0,
      stopWhenDecided: true
    }))
  );
  const fullField = summarizeFullFieldPceScene(runHeadlessRace(track, {
    seed: PCE_PROBE_SEED,
    step: PCE_FULL_FIELD_STEP_SECONDS,
    laps: 1,
    wet: 0,
    includeClassificationDiagnostics: true,
    includeLapStrata: true
  }));
  return {
    schemaVersion: 1,
    probe: 'p-ce-certainty-equivalence',
    trackId: 'prado',
    seed: PCE_PROBE_SEED,
    focusedStepSeconds: PCE_FOCUSED_STEP_SECONDS,
    fullFieldStepSeconds: PCE_FULL_FIELD_STEP_SECONDS,
    focused,
    fullField,
    aggregate: aggregatePceScenes([...focused, fullField])
  };
}

if (import.meta.main)
  console.log(JSON.stringify(runPcePhaseProbe(), null, 2));
