import { describe, expect, test } from 'bun:test';

import {
  integrateRhythmPlan,
  realizeRhythmPlanV2,
  resolveRhythmPlanV2,
  solveRhythmClosure
} from '../../../src/game/trackgen';

describe('trackgen v2 curvature integration and closure', () => {
  test('integrates every compound lobe to its independent signed turn', () => {
    const plan = resolveRhythmPlanV2('balanced', 9);
    const route = integrateRhythmPlan(plan);
    const group = route.groups.find(item => item.groupId === 'opening-s');

    expect(group).toBeDefined();
    expect(group!.lobes).toHaveLength(2);
    for (const lobe of group!.lobes)
      expect(lobe.realizedAngleDegrees).toBeCloseTo(lobe.targetAngleDegrees, 8);
    expect(group!.lobes[0]!.realizedAngleDegrees).toBeGreaterThan(0);
    expect(group!.lobes[1]!.realizedAngleDegrees).toBeLessThan(0);
  });

  test('closes a known-good route through declared flex without endpoint snapping', () => {
    const plan = resolveRhythmPlanV2('balanced', 0);
    const solved = solveRhythmClosure(plan);
    const geometry = realizeRhythmPlanV2(plan);

    expect(solved.report.converged).toBe(true);
    expect(solved.report.residualAfter.positionMetres).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(solved.report.residualAfter.headingRadians)).toBeLessThanOrEqual(1e-9);
    expect(solved.report.variables.some(variable => Math.abs(variable.delta) > 1e-6)).toBe(true);
    expect(solved.route.points.at(-1)).toEqual({
      x: solved.route.endPose.x,
      y: solved.route.endPose.y
    });
    expect(geometry.points.at(-1)).not.toEqual({ x: 0, y: 0 });
    expect(geometry.endPose).not.toEqual(geometry.startPose);
  }, 30_000);

  test('reports an unsolvable route honestly when no closure authority exists', () => {
    const source = resolveRhythmPlanV2('power', 0);
    const plan = {
      ...source,
      groups: source.groups.map(group => {
        const { flex: _flex, ...withoutFlex } = group;
        return withoutFlex;
      })
    };
    const solved = solveRhythmClosure(plan);

    expect(solved.report.converged).toBe(false);
    expect(solved.report.variables).toHaveLength(0);
    expect(solved.report.residualAfter).toEqual(solved.report.residualBefore);
    expect(solved.report.residualAfter.positionMetres).toBeGreaterThan(1);
  });
});
