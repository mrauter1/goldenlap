import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { HARD_CONTACT_CAP } from '../../../tools/lib/audit-invariants';
import { productionDistanceEquivalentPasses } from '../../../tools/lib/race-metrics';
import {
  classifyMetric,
  empiricalQuantile,
  empiricalQuantileInterval,
  inverseNormalCdf,
  poissonRateInterval,
  stratify,
  wilsonInterval,
  type MetricPolicy
} from '../../../tools/lib/statistics';

const policy: MetricPolicy = {
  id: 'sample.metric',
  unit: 's',
  scope: 'test',
  aggregation: 'point',
  distribution: 'empirical',
  minimumSamples: 1,
  classification: 'distribution',
  normal: { maximum: 1 },
  acceptable: { maximum: 2 },
  absolute: { maximum: 4 },
  rationale: 'test fixture',
  owner: 'statistics.test'
};

describe('bounded statistical primitives', () => {
  test('computes interpolated empirical quantiles without mutating input', () => {
    const values = [5, 1, 4, 2, 3];
    expect(empiricalQuantile(values, 0)).toBe(1);
    expect(empiricalQuantile(values, 0.5)).toBe(3);
    expect(empiricalQuantile(values, 0.9)).toBeCloseTo(4.6, 12);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });

  test('bounds empirical quantiles with distribution-free order statistics', () => {
    const values = Array.from({ length: 1000 }, (_unused, index) => index + 1);
    const lowTail = empiricalQuantileInterval(values, 0.01);
    expect(lowTail.lower).toBeLessThanOrEqual(empiricalQuantile(values, 0.01));
    expect(lowTail.upper).toBeGreaterThanOrEqual(empiricalQuantile(values, 0.01));
    expect(lowTail.lower).toBeGreaterThanOrEqual(1);
    expect(lowTail.upper).toBeLessThan(30);
    expect(empiricalQuantileInterval([3], 0.95)).toEqual({ lower: 3, upper: 3 });
  });

  test('computes Wilson binomial intervals', () => {
    const interval = wilsonInterval(5, 10);
    expect(interval.lower).toBeCloseTo(0.236593, 5);
    expect(interval.upper).toBeCloseTo(0.763407, 5);
    expect(wilsonInterval(0, 10).lower).toBe(0);
    expect(wilsonInterval(10, 10).upper).toBe(1);
  });

  test('computes finite Poisson rate intervals including zero events', () => {
    const zero = poissonRateInterval(0, 10);
    expect(zero.lower).toBe(0);
    expect(zero.upper).toBeCloseTo(0.368888, 5);
    const nonzero = poissonRateInterval(4, 20);
    expect(nonzero.lower).toBeGreaterThan(0);
    expect(nonzero.lower).toBeLessThan(0.2);
    expect(nonzero.upper).toBeGreaterThan(0.2);
  });

  test('provides accurate normal quantiles used by both intervals', () => {
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959964, 5);
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 12);
  });

  test('classifies normal, acceptable, absolute, and confidence outcomes', () => {
    expect(classifyMetric(policy, { metric: policy.id, value: 0.8 }).status).toBe('green');
    expect(classifyMetric(policy, { metric: policy.id, value: 1.4 }).status).toBe('amber');
    expect(classifyMetric(policy, { metric: policy.id, value: 2.2 }).status).toBe('red');
    expect(classifyMetric(policy, { metric: policy.id, value: 5 }).reason).toContain('absolute');
    expect(classifyMetric(policy, {
      metric: policy.id,
      value: 1.8,
      interval: { lower: 1.4, upper: 2.2 }
    }).status).toBe('inconclusive');
    expect(classifyMetric(policy, {
      metric: policy.id,
      value: 2.5,
      interval: { lower: 2.1, upper: 2.8 }
    }).status).toBe('red');
  });

  test('keeps invariant and target semantics distinct', () => {
    const invariant: MetricPolicy = {
      ...policy,
      id: 'sample.invariant',
      classification: 'invariant',
      normal: { maximum: 0 },
      acceptable: { maximum: 0 },
      absolute: { maximum: 0 }
    };
    const target: MetricPolicy = {
      ...policy,
      id: 'sample.target',
      classification: 'target'
    };
    expect(classifyMetric(invariant, { metric: invariant.id, value: 0 }).status).toBe('green');
    expect(classifyMetric(invariant, { metric: invariant.id, value: 1 }).status).toBe('red');
    expect(classifyMetric(target, { metric: target.id, value: 999 }).status).toBe('green');
  });

  test('reports undersampled distributions as inconclusive without hiding absolute failures', () => {
    const sampledPolicy: MetricPolicy = { ...policy, minimumSamples: 10 };
    const undersampled = classifyMetric(sampledPolicy, {
      metric: sampledPolicy.id,
      value: 0.8,
      samples: 9
    });
    expect(undersampled.status).toBe('inconclusive');
    expect(undersampled.reason).toContain('at least 10 samples');
    expect(classifyMetric(sampledPolicy, {
      metric: sampledPolicy.id,
      value: 5,
      samples: 1
    }).status).toBe('red');
  });

  test('stratifies observations without flattening populations', () => {
    const groups = stratify([
      { track: 'prado', wet: false },
      { track: 'prado', wet: true },
      { track: 'costa', wet: false }
    ], value => `${value.track}:${value.wet ? 'wet' : 'dry'}`);
    expect([...groups.keys()]).toEqual(['prado:dry', 'prado:wet', 'costa:dry']);
    expect(groups.get('prado:dry')?.length).toBe(1);
  });

  test('leaves light contacts uncapped and aligns the sole hard-contact cap', () => {
    const document = JSON.parse(readFileSync(
      'tests/fixtures/calibration/metric-policy.json', 'utf8'
    )) as { policies: MetricPolicy[] };
    const contacts = document.policies.find(candidate =>
      candidate.id === 'race.contacts_per_race');
    const lightContacts = document.policies.find(candidate =>
      candidate.id === 'race.light_contacts_per_race');
    const hardContacts = document.policies.find(candidate =>
      candidate.id === 'race.hard_contacts_per_race');
    expect(contacts).toBeDefined();
    expect(lightContacts).toBeDefined();
    expect(contacts?.classification).toBe('target');
    expect(contacts?.normal).toBeUndefined();
    expect(classifyMetric(contacts!, {
      metric: contacts!.id,
      value: 1_000_000,
      samples: 1
    }).status).toBe('green');
    expect(classifyMetric(lightContacts!, {
      metric: lightContacts!.id,
      value: 1_000_000,
      samples: 1
    }).status).toBe('green');
    expect(hardContacts?.normal?.maximum).toBe(HARD_CONTACT_CAP);
    expect(hardContacts?.acceptable?.maximum).toBe(HARD_CONTACT_CAP);
    expect(hardContacts?.absolute?.maximum).toBe(HARD_CONTACT_CAP);
  });

  test('projects short pass probes through a conservative settling horizon', () => {
    expect(productionDistanceEquivalentPasses(18, 1, 57)).toBeCloseTo(205.2, 8);
    expect(productionDistanceEquivalentPasses(18, 5, 57)).toBeCloseTo(205.2, 8);
    expect(productionDistanceEquivalentPasses(120, 57, 57)).toBe(120);
  });
});
