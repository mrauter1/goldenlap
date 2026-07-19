import { speedProfile } from '../../src/core/racing-line';
import type { BuiltTrack, SampledPath, TrackProfile } from '../../src/core/model';
import { runFocusedSession } from './headless-sim';
import { wilsonInterval } from './statistics';

function builtWithPath(
  built: BuiltTrack,
  path: SampledPath,
  profile: TrackProfile
): BuiltTrack {
  const timing = speedProfile(built.tr, path);
  const corners = built.tr.corners.map(corner => ({
    ...corner,
    entryTarget: path.off[corner.turnInI]!,
    apexTarget: path.off[corner.apexI]!,
    exitTarget: path.off[corner.trackOutI]!
  })) as BuiltTrack['tr']['corners'];
  const track = {
    ...built.tr,
    corners,
    idealPath: path,
    idealTiming: { t: timing.t, lapTime: timing.lapTime },
    trackProfile: profile
  } as BuiltTrack['tr'];
  return { ...built, tr: track };
}

export interface TrackCharacterization {
  provisional: true;
  scenarios: number;
  pairTrials: number;
  pairTrialsWithContact: number;
  contactFraction: number;
  contactInterval: { lower: number; upper: number };
  hardContacts: number;
  obligationObservations: number;
  pitFalseLeaders: number;
  pitDeadlocks: number;
}

export function characterizeTrack(
  built: BuiltTrack,
  path: SampledPath,
  profile: TrackProfile,
  seed: number
): TrackCharacterization {
  const candidate = builtWithPath(built, path, profile);
  const trials = [
    runFocusedSession(candidate, { scenario: 'pair', seed, wet: 0 }),
    runFocusedSession(candidate, { scenario: 'pair', seed: seed + 1, wet: 0.65 }),
    runFocusedSession(candidate, { scenario: 'priority', seed: seed + 2, wet: 0 }),
    runFocusedSession(candidate, { scenario: 'priority', seed: seed + 3, wet: 0.65 }),
    runFocusedSession(candidate, { scenario: 'pit', seed: seed + 4, wet: 0 }),
    runFocusedSession(candidate, { scenario: 'classification', seed: seed + 5, wet: 0 })
  ];
  const pairTrials = trials.slice(0, 2);
  const withContact = pairTrials.filter(trial => trial.metrics.contacts > 0).length;
  return {
    provisional: true,
    scenarios: trials.length,
    pairTrials: pairTrials.length,
    pairTrialsWithContact: withContact,
    contactFraction: withContact / pairTrials.length,
    contactInterval: wilsonInterval(withContact, pairTrials.length),
    hardContacts: trials.reduce((sum, trial) => sum + trial.metrics.hardContacts, 0),
    obligationObservations: trials.reduce(
      (sum, trial) => sum + (trial.metrics.obligationObserved ?? 0), 0
    ),
    pitFalseLeaders: trials.reduce((sum, trial) => sum + trial.metrics.pitFalseLeaders, 0),
    pitDeadlocks: trials.reduce((sum, trial) => sum + trial.metrics.pitDeadlocks, 0)
  };
}
