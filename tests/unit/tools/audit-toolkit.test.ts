import { beforeAll, describe, expect, test } from 'bun:test';

import type { BuiltTrack } from '../../../src/core/model';
import {
  strategyBalance,
  tyreGrip,
  withStrategyBalance
} from '../../../src/session/strategy';
import {
  auditCornerLineLibrary,
  classifyEffectCase,
  runEffectAudit
} from '../../../tools/audit-effects';
import {
  modelTrackStrategy,
  runStrategyModel,
  strategyObjective
} from '../../../tools/strategy-model';
import {
  prepareHeadlessTrack,
  runFocusedSession
} from '../../../tools/lib/headless-sim';

let prado: BuiltTrack;
let nordwald: BuiltTrack;

beforeAll(() => {
  prado = prepareHeadlessTrack('prado');
  nordwald = prepareHeadlessTrack('nordwald');
});

describe('tiered audit toolkit', () => {
  test('uses one bounded production tyre-balance registry and restores overrides', () => {
    const original = strategyBalance().hardFreshGrip;
    const ordinary = tyreGrip({ c: 'H', wear: 0, fit: 0 }, 0);
    const overridden = withStrategyBalance({ hardFreshGrip: 0.95 }, () =>
      tyreGrip({ c: 'H', wear: 0, fit: 0 }, 0));

    expect(ordinary).toBe(original);
    expect(overridden).toBe(0.95);
    expect(strategyBalance().hardFreshGrip).toBe(original);
  });

  test('computes deterministic closed-form schedules and target distance', () => {
    const first = runStrategyModel(['prado']);
    const second = runStrategyModel(['prado']);
    expect(first).toEqual(second);
    expect(first.tracks).toHaveLength(1);
    expect(first.tracks[0]!.bestSoft.stops).toBeGreaterThan(
      first.tracks[0]!.bestHard.stops
    );
    expect(first.tracks[0]!.pitLossSeconds).toBeGreaterThan(0);
    expect(first.objective).toBeGreaterThanOrEqual(0);

    const direct = modelTrackStrategy(prado);
    expect(strategyObjective([direct]).total).toBe(first.objective);
  });

  test('ends a decided light-rub effect probe early and preserves the battle', () => {
    const summary = runFocusedSession(prado, {
      scenario: 'light-rub', seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });
    const verdict = classifyEffectCase(
      { phase: 'G', scenario: 'light-rub', variant: 'low-impulse' },
      summary,
      null
    );

    expect(summary.reason).toBe('complete');
    expect(summary.simulatedSeconds).toBeLessThan(1);
    expect(summary.metrics.contacts).toBeGreaterThan(0);
    expect(summary.metrics.hardContacts).toBe(0);
    expect(summary.metrics.auditContactSeedSeen).toBe(0);
    expect(verdict.status).toBe('green');
  });

  test('distinguishes legal anticipatory defense from a committed-attacker hold', () => {
    const anticipatory = runFocusedSession(prado, {
      scenario: 'defense-legality', defenseVariant: 'anticipatory',
      seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });
    const committed = runFocusedSession(prado, {
      scenario: 'defense-legality', defenseVariant: 'committed',
      seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });

    expect(['green', 'undecided'])
      .toContain(anticipatory.audit?.verdict ?? 'undecided');
    expect(anticipatory.metrics.defenseMoveInBraking).toBe(0);
    expect(committed.audit?.verdict).toBe('green');
    expect(committed.metrics.defenseMoves).toBe(0);
    expect(committed.metrics.defenseMoveInBraking).toBe(0);

    const inconclusive = classifyEffectCase(
      {
        phase: 'L4b',
        scenario: 'defense-legality',
        variant: 'anticipatory-regression'
      },
      {
        ...anticipatory,
        audit: { verdict: 'undecided', reason: 'assertion window exhausted' }
      },
      null
    );
    expect(inconclusive.status).toBe('amber');
  });

  test('observes the evaluator selecting feasible passing space', () => {
    const summary = runFocusedSession(prado, {
      scenario: 'attack-launch', seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });
    const verdict = classifyEffectCase(
      { phase: 'L4', scenario: 'attack-launch', variant: 'tow-until-brake-derived-launch' },
      summary,
      null
    );

    expect(summary.metrics.attackInitiations).toBeGreaterThan(0);
    expect(summary.metrics.candidatesEvaluated).toBeGreaterThan(0);
    expect(summary.metrics.maximumCandidates).toBeLessThanOrEqual(6);
    expect(summary.metrics.maximumPathsMaterialized).toBe(0);
    expect(verdict.status).not.toBe('red');
  });

  test('separates traffic braking from corner braking and retires overlap as a tow gate', () => {
    const alongside = runFocusedSession(prado, {
      scenario: 'alongside-straight', seed: 11, deadlineMs: 5_000,
      stopWhenDecided: true
    });
    const tow = runFocusedSession(prado, {
      scenario: 'tow-run', seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });

    expect(alongside.metrics.brakeWhileAlongside).toBe(0);
    expect(alongside.metrics.hardContacts).toBe(0);
    expect(alongside.metrics.maximumPathsMaterialized).toBe(0);
    expect(tow.metrics.auditMaximumTow).toBeGreaterThan(0);
    expect(classifyEffectCase(
      { phase: 'K', scenario: 'tow-run', variant: 'one-second-gap' },
      tow,
      null
    ).status).toBe('amber');
  });

  test('classifies tucked-follow and battle economy as normalized losses', () => {
    const base = runFocusedSession(prado, {
      scenario: 'light-rub', seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });
    const tucked = {
      ...base,
      scenario: 'tucked-follow' as const,
      audit: { verdict: 'green' as const, reason: 'complete' },
      metrics: {
        ...base.metrics,
        auditFirstMarkerSeconds: 100.9,
        auditSecondMarkerSeconds: 100,
        auditTuckedAuthorityLost: 0
      }
    };
    expect(classifyEffectCase(
      { phase: 'L0', scenario: 'tucked-follow', variant: 'flying-lap' },
      tucked,
      null
    ).status).toBe('green');
    expect(classifyEffectCase(
      { phase: 'L2', scenario: 'tucked-follow', variant: 'single-authority' },
      {
        ...tucked,
        metrics: { ...tucked.metrics, auditTuckedAuthorityLost: 1 }
      },
      null
    ).status).toBe('red');
    expect(classifyEffectCase(
      { phase: 'L0', scenario: 'side-by-side-corner', variant: 'battle-economy' },
      {
        ...tucked,
        scenario: 'side-by-side-corner',
        metrics: {
          ...tucked.metrics,
          auditFirstMarkerSeconds: 10 + base.metrics.auditIdealLapSeconds! * 0.02,
          auditSecondMarkerSeconds: 10.1
        }
      },
      10
    ).status).toBe('green');
  });

  test('uses the same zero-settling clock for solo and paired corner probes', () => {
    const implicit = runFocusedSession(prado, {
      scenario: 'solo-baseline', seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });
    const explicit = runFocusedSession(prado, {
      scenario: 'solo-baseline', seed: 11, deadlineMs: 5_000,
      settlingSeconds: 0, stopWhenDecided: true
    });

    expect(implicit.metrics.auditFirstMarkerSeconds)
      .toBe(explicit.metrics.auditFirstMarkerSeconds);
    expect(implicit.checksum).toBe(explicit.checksum);
  });

  test('treats a non-maneuver L2 lane hop as a zero-tolerance failure', () => {
    const summary = runFocusedSession(prado, {
      scenario: 'defense-legality', defenseVariant: 'anticipatory',
      seed: 11, deadlineMs: 5_000, stopWhenDecided: true
    });
    const hopped = {
      ...summary,
      metrics: {
        ...summary.metrics,
        laneTargetNonManeuverDiscontinuities: 1
      }
    };
    expect(classifyEffectCase(
      { phase: 'L2', scenario: 'defense-legality', variant: 'pinned-defense' },
      hopped,
      null
    ).status).toBe('red');
  });

  test('audits the cached L3 line library from recomputed physical timing', () => {
    const result = auditCornerLineLibrary(prado);
    expect(result.status).toBe('amber');
    expect(result.metrics.cornerLines).toBe(prado.tr.corners.length * 4);
    expect(result.metrics.cornerLineMinimumApexSeparation).toBeGreaterThanOrEqual(2);
    expect(result.metrics.cornerLineMaximumTimingDrift).toBeLessThan(1e-8);
    expect(result.metrics.cornerLineMaximumLapRatio).toBeLessThanOrEqual(1.03);
    expect(result.metrics.cornerLineTypicalLossLines).toBeGreaterThan(0);
  });

  test('records one pass-score host for every L5 maneuver vocabulary case', () => {
    const result = runEffectAudit({
      phases: ['L5'],
      tracks: ['prado', 'nordwald'],
      seedSet: 'custom',
      seeds: [11],
      deadlineMs: 5_000,
      budgetMs: 60_000,
      abortOnRed: false
    }, Date.now, new Map([
      ['prado', prado],
      ['nordwald', nordwald]
    ]));

    expect(result.status).toBe('amber');
    expect(result.failures).toHaveLength(0);
    expect(result.cases).toHaveLength(10);
    for (const vocabulary of [
      'inside', 'outside', 'switchback', 'over-under', 'drag-pass'
    ] as const) {
      expect(result.cases.some(item =>
        item.provenance?.vocabulary === vocabulary
      )).toBe(true);
    }
    expect(new Set(result.cases.map(item => item.provenance?.vocabulary))).toEqual(
      new Set(['inside', 'outside', 'switchback', 'over-under', 'drag-pass'])
    );
    for (const item of result.cases) {
      expect(item.provenance?.cornerId.startsWith(`${item.trackId}-c`)).toBe(true);
      expect(item.provenance?.passScore).toBeGreaterThan(0);
      expect(item.metrics.maximumPathsMaterialized).toBe(0);
      expect(item.metrics.laneTargetNonManeuverDiscontinuities).toBe(0);
    }
  });
});
