import { beforeAll, describe, expect, test } from 'bun:test';
import type { BuiltTrack } from '../../../src/core/model';
import {
  prepareHeadlessTrack,
  runFocusedSession,
  runHeadlessRace,
  runSingleCar,
  type FocusedScenario
} from '../../../tools/lib/headless-sim';

let prado: BuiltTrack;

beforeAll(() => {
  prado = prepareHeadlessTrack('prado');
});

describe('production-backed headless simulation', () => {
  test('reproduces a finite valid lap for the same seed', () => {
    const first = runSingleCar(prado, { laps: 1, seed: 101 });
    const second = runSingleCar(prado, { laps: 1, seed: 101 });
    expect(first).toEqual(second);
    expect(first.reason).toBe('complete');
    expect(first.validLaps).toBe(1);
    expect(first.invalidLaps).toBe(0);
    expect(first.offCourseSeconds).toBe(0);
    expect(first.finite).toBe(true);
    expect(first.maximumMarkerError).toBeFinite();
  });

  test('honors deterministic step and injected deadline limits', () => {
    const limited = runSingleCar(prado, { laps: 2, seed: 7, maxSteps: 10 });
    expect(limited.reason).toBe('step-limit');
    expect(limited.steps).toBe(10);
    const deadline = runSingleCar(prado, {
      laps: 2,
      seed: 7,
      maxSteps: 100,
      deadlineMs: 0,
      now: () => 42
    });
    expect(deadline.reason).toBe('deadline');
    expect(deadline.steps).toBe(0);
  });

  test('runs focused behavior probes at the production physics cadence', () => {
    const summary = runFocusedSession(prado, {
      scenario: 'near-touch-tow',
      simulatedSeconds: 1,
      seed: 7
    });
    expect(summary.steps).toBe(120);
    expect(summary.simulatedSeconds).toBe(1);
  });

  test('threads the same predictive-safety inventory at 10 and 30 Hz', () => {
    const ten = runFocusedSession(prado, {
      scenario: 'pair',
      simulatedSeconds: 1,
      predictiveSafetyHz: 10,
      seed: 17
    });
    const thirty = runFocusedSession(prado, {
      scenario: 'pair',
      simulatedSeconds: 1,
      predictiveSafetyHz: 30,
      seed: 17
    });

    expect(ten.metrics.predictiveSafetyHz).toBe(10);
    expect(ten.metrics.predictiveSafetyIntervalTicks).toBe(3);
    expect(thirty.metrics.predictiveSafetyHz).toBe(30);
    expect(thirty.metrics.predictiveSafetyIntervalTicks).toBe(1);
    expect(Object.keys(ten.diagnostics.racecraftSafetyPredicateRuns).sort())
      .toEqual(
        Object.keys(thirty.diagnostics.racecraftSafetyPredicateRuns).sort()
      );
    expect(thirty.metrics.racecraftSafetyPasses!)
      .toBe(ten.metrics.racecraftSafetyPasses! * 3);
  });

  test('observes bounded clearance across the physical braking zone', () => {
    const summary = runFocusedSession(prepareHeadlessTrack('anhembi'), {
      scenario: 'near-touch-tow',
      seed: 11,
      stopWhenDecided: true
    });
    expect(summary.metrics.hardContacts).toBe(0);
    expect(Number.isFinite(summary.metrics.auditMinimumStraightBodyClearance))
      .toBe(true);
  });

  test('isolates evaluator-follow loss from lap-boundary pace rolls', () => {
    for (const trackId of ['prado', 'anhembi']) {
      const track = trackId === 'prado'
        ? prado
        : prepareHeadlessTrack(trackId);
      const summaries = [11, 29].map(seed =>
        runFocusedSession(track, {
          scenario: 'tucked-follow',
          seed,
          stopWhenDecided: true
        })
      );
      const losses = summaries.map(summary =>
        (summary.metrics.auditFirstMarkerSeconds! -
          summary.metrics.auditSecondMarkerSeconds!) /
          summary.metrics.auditSecondMarkerSeconds!
      );
      expect(losses[0]).toBe(losses[1]);
      for (const summary of summaries) {
        expect(summary.metrics.auditTuckedAuthorityLost).toBe(0);
        expect(summary.metrics.hardContacts).toBe(0);
      }
    }
  }, 20_000);

  test('runs bounded pair, pit, priority, and classification scenarios reproducibly', () => {
    const scenarios: FocusedScenario[] = ['pair', 'pit', 'priority', 'classification'];
    const first = scenarios.map(scenario => runFocusedSession(prado, { scenario, seed: 211 }));
    const second = scenarios.map(scenario => runFocusedSession(prado, { scenario, seed: 211 }));
    expect(first).toEqual(second);
    expect(first.every(summary => summary.reason === 'complete')).toBe(true);
    for (const summary of first) {
      expect(summary.metrics).toHaveProperty('pathOutOfBoundsRejections');
      expect(summary.metrics).not.toHaveProperty('pathOutOfBoundsViolations');
      for (const retiredMetric of [
        'racecraftClaimConflicts',
        'racecraftPhantomConflicts',
        'racecraftClaimPingPong',
        'racecraftAdapterRung1',
        'racecraftAdapterRung2',
        'racecraftAdapterRung3',
        'racecraftAdapterRung4',
        'defenseDoorOccupiedBlocks',
        'defenseDoorReachabilityBlocks',
        'defenseDoorViolations'
      ])
        expect(summary.metrics).not.toHaveProperty(retiredMetric);
    }
    expect(first[1]!.metrics.pitFalseLeaders).toBe(0);
    expect(first[2]!.metrics.obligationObserved).toBe(1);
    expect(first[3]!.metrics.finished).toBe(2);
    expect(first[3]!.eventTypes).toContain('session-complete:race');
  }, 20_000);

  test('keeps a seeded close duel inside cost-based safety', () => {
    // Pass completion belongs to the active crossing and pull-out probes. This
    // constructed episode checks that replacing protected-pass authority does
    // not bypass claims or hard-contact feasibility.
    const isolatedTrack = prepareHeadlessTrack('prado');
    const summary = runFocusedSession(isolatedTrack, {
      scenario: 'pair',
      phase: 'approach',
      // Start inside the physical overlap window so this probe isolates
      // execution/persistence; eligibility has separate unit coverage.
      initialGapM: 1,
      closingSpeedMps: 3,
      attackerGripScale: 1.06,
      simulatedSeconds: 12,
      seed: 101
    });
    expect(summary.reason).toBe('complete');
    expect(summary.metrics.hardContacts).toBe(0);
    expect(summary.metrics.attackInitiations).toBeGreaterThan(0);
    expect(summary.metrics.maximumCandidates).toBeLessThanOrEqual(6);
    expect(summary.metrics.pathsMaterialized).toBe(0);
  });

  test('selects passing space without legacy launch state', () => {
    const isolatedTrack = prepareHeadlessTrack('prado');
    const summary = runFocusedSession(isolatedTrack, {
      scenario: 'pair',
      phase: 'straight',
      initialGapM: 1,
      closingSpeedMps: 3,
      attackerGripScale: 1.06,
      simulatedSeconds: 2,
      seed: 101
    });
    expect(summary.metrics.candidatesEvaluated).toBeGreaterThan(0);
    expect(summary.metrics.maximumCandidates).toBeLessThanOrEqual(6);
    expect(summary.metrics.pathsMaterialized).toBe(0);
  });

  test('keeps wet evaluator decisions inside the bounded safety contract', () => {
    const summary = runFocusedSession(prepareHeadlessTrack('villa'), {
      scenario: 'pair',
      seed: 703171,
      wet: 0.65,
      phase: 'approach',
      side: -1,
      initialGapM: 3.4,
      closingSpeedMps: 8,
      simulatedSeconds: 6
    });
    expect(summary.metrics.candidatesEvaluated).toBeGreaterThan(0);
    expect(summary.metrics.maximumCandidates).toBeLessThanOrEqual(6);
    expect(summary.metrics.pathsMaterialized).toBe(0);
    expect(summary.metrics.hardContacts).toBe(0);
  });

  test('keeps wet straight obligation yields inside the safety envelope', () => {
    const cases = [
      { track: 'costa', gap: 35, seed: 1228 },
      { track: 'anhembi', gap: 18, seed: 4255 }
    ] as const;
    for (const item of cases) {
      const summary = runFocusedSession(prepareHeadlessTrack(item.track), {
        scenario: 'priority',
        phase: 'straight',
        side: 1,
        closingSpeedMps: 14,
        initialGapM: item.gap,
        priorityReason: 'blue-flag',
        simulatedSeconds: 20,
        seed: item.seed,
        wet: 0.65
      });
      expect(summary.metrics.obligationObserved).toBe(1);
      expect(summary.metrics.hardContacts).toBe(0);
      expect(summary.metrics.maximumCandidates).toBeLessThanOrEqual(6);
      expect(summary.metrics.pathsMaterialized).toBe(0);
    }
  });

  test('completes wet corner priority through the evaluator', () => {
    const cases = [
      { track: 'costa', side: -1 as const, closing: 8, seed: 1352 },
      { track: 'nordwald', side: 1 as const, closing: 14, seed: 2361 }
    ];
    for (const item of cases) {
      const summary = runFocusedSession(prepareHeadlessTrack(item.track), {
        scenario: 'priority',
        phase: 'corner',
        side: item.side,
        closingSpeedMps: item.closing,
        initialGapM: 18,
        priorityReason: 'qualifying',
        qualifyingYieldPhase: 'out',
        simulatedSeconds: 20,
        stopOnPriorityRelease: true,
        seed: item.seed,
        wet: 0.65
      });
      expect(summary.reason).toBe('complete');
      expect(summary.metrics.obligationObserved).toBe(1);
      expect(summary.metrics.maximumCandidates).toBeLessThanOrEqual(6);
      expect(summary.metrics.pathsMaterialized).toBe(0);
    }
  });

  test('runs a deterministic finite full-field race through production session code', () => {
    const first = runHeadlessRace(prado, {
      seed: 101,
      laps: 1,
      wet: 0,
      includeLapStrata: true,
      includeClassificationDiagnostics: true
    });
    const second = runHeadlessRace(prado, {
      seed: 101,
      laps: 1,
      wet: 0,
      includeLapStrata: true,
      includeClassificationDiagnostics: true
    });
    expect(first).toEqual(second);
    expect(first.reason).toBe('complete');
    expect(first.finite).toBe(true);
    expect(first.classificationValid).toBe(true);
    expect(first.metrics.maximumCandidates).toBeLessThanOrEqual(6);
    expect(first.exposure.passAttempts).toBeGreaterThan(0);
    expect(first.exposure.passAttempts).toBe(first.metrics.attackInitiations);
    expect(first.metrics.passSuccesses).toBe(first.metrics.attackCompletions);
    expect(first.metrics.passSuccesses)
      .toBeLessThanOrEqual(first.exposure.passAttempts);
    expect(first.metrics).toHaveProperty('pathOutOfBoundsRejections');
    expect(first.metrics).not.toHaveProperty('pathOutOfBoundsViolations');
    expect(Object.values(first.metrics.cornerPassCounts)
      .reduce((sum, count) => sum + count.attempts, 0))
      .toBe(first.metrics.attackInitiations);
    expect(first.diagnostics.racecraftInteractionSamples).toBeDefined();
    expect(first.diagnostics.racecraftLiftSamples).toBeDefined();
    expect(first.diagnostics.racecraftSelectedJ).toBeDefined();
    expect(first.diagnostics.classification?.length).toBeGreaterThan(0);
    expect(first.lapStrata?.openingLap.carSeconds).toBeGreaterThan(0);
    expect(first.lapStrata?.steadyState.carSeconds).toBe(0);
  }, 60_000);
});
