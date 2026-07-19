import {
  RACECRAFT_RESOLUTION_DEFAULTS,
  type RacecraftResolution,
  withRacecraftResolution
} from '../src/session/racecraft/config';
import {
  prepareHeadlessTrack,
  runFocusedSession,
  type FocusedSessionSummary
} from './lib/headless-sim';

interface ResolutionCase {
  id: 'stations-24';
  override: Partial<RacecraftResolution>;
}

const CASES: readonly ResolutionCase[] = [
  {
    id: 'stations-24',
    override: { stationSamples: 24 }
  }
];

function metric(summary: FocusedSessionSummary, key: string): number {
  return summary.metrics[key] ?? 0;
}

function compactOutcome(
  summary: FocusedSessionSummary
): Record<string, unknown> {
  return {
    status: summary.reason === 'complete' ? 'complete' : 'incomplete',
    reason: summary.reason,
    verdict: summary.audit?.verdict ?? 'undecided',
    verdictReason: summary.audit?.reason ?? '',
    steps: summary.steps,
    simulatedSeconds: summary.simulatedSeconds,
    leaderMaximumCommandDeviation:
      metric(summary, 'auditLeaderMaximumCommandDeviation'),
    leaderFollowerBrakeEvents:
      metric(summary, 'auditLeaderFollowerBrakeEvents'),
    endingBodyClearance:
      metric(summary, 'auditEndingBodyClearance'),
    derivedFollowBodyFloor:
      metric(summary, 'auditDerivedFollowBodyFloor'),
    leaderTrackingErrorThreshold:
      metric(summary, 'auditLeaderTrackingErrorThreshold'),
    hardContacts: metric(summary, 'hardContacts'),
    maximumCandidates: metric(summary, 'maximumCandidates'),
    pathsMaterialized: metric(summary, 'pathsMaterialized'),
    attackInitiations: metric(summary, 'attackInitiations'),
    attackCompletions: metric(summary, 'attackCompletions'),
    reactionEvents: metric(summary, 'racecraftReactionEvents'),
    liftSamplesOutsideBlue:
      metric(summary, 'racecraftLiftSamplesOutsideBlue'),
    tier0Checks: metric(summary, 'racecraftTier0Checks'),
    tier0Accepted: metric(summary, 'racecraftTier0Accepted'),
    tier0AcceptanceFraction:
      metric(summary, 'racecraftTier0AcceptanceFraction'),
    tier0IdealDominance:
      metric(summary, 'racecraftTier0IdealDominance'),
    tier1Deliberations:
      metric(summary, 'racecraftTier1Deliberations'),
    certificateBreaks: summary.diagnostics.racecraftCertificateBreaks,
    selectedJ: summary.diagnostics.racecraftSelectedJ,
    checksum: summary.checksum
  };
}

const built = prepareHeadlessTrack('prado');
const results = CASES.map(testCase => {
  const resolution = {
    ...RACECRAFT_RESOLUTION_DEFAULTS,
    ...testCase.override
  };
  try {
    return {
      id: testCase.id,
      resolution,
      ...withRacecraftResolution(testCase.override, () =>
        compactOutcome(runFocusedSession(built, {
          scenario: 'faster-behind',
          seed: 101,
          step: 1 / 120,
          wet: 0,
          stopWhenDecided: true
        })))
    };
  } catch (error) {
    return {
      id: testCase.id,
      resolution,
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

console.log(JSON.stringify({
  schemaVersion: 1,
  probe: 'p-b-close-follow',
  trackId: built.def.id,
  scenario: 'faster-behind',
  seed: 101,
  stepSeconds: 1 / 120,
  results
}, null, 2));

if (results.some(result => result.status !== 'complete')) process.exitCode = 1;
