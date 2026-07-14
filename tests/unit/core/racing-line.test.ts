import { describe, expect, test } from 'bun:test';

import type { SampledPath, SpeedProfile, Track } from '../../../src/core/model';
import { PHYS } from '../../../src/core/physics';
import {
  derivePathGeometry,
  detectSemanticCorners,
  frozenCornerCandidates,
  legacyRacingLine,
  racingLine,
  refineSemanticCorners,
  speedProfile
} from '../../../src/core/racing-line';
import { buildTrack } from '../../../src/core/track';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';

interface SemanticTrack {
  track: Track & Required<Pick<Track, 'corners' | 'cornerNext'>>;
  centerProfile: SpeedProfile;
  legacyPath: SampledPath;
  idealPath: SampledPath;
  idealProfile: SpeedProfile;
}

function buildSemanticTrack(definitionIndex: number): SemanticTrack {
  const definition = TRACK_DEFS[definitionIndex]!;
  const track = buildTrack(definition, PIT_TEAMS);
  const centerProfile = speedProfile(track);
  detectSemanticCorners(track, centerProfile);
  const legacyPath = legacyRacingLine(track);
  refineSemanticCorners(track, legacyPath);
  const idealPath = racingLine(track);
  const idealProfile = speedProfile(track, idealPath);
  idealPath.v = idealProfile.v;
  if (!track.corners || !track.cornerNext)
    throw new Error(`Semantic build did not initialize ${definition.id}`);
  return {
    track: track as SemanticTrack['track'],
    centerProfile,
    legacyPath,
    idealPath,
    idealProfile
  };
}

function distanceAhead(track: Track, from: number, to: number): number {
  return ((to - from + track.n) % track.n) * track.step;
}

describe('semantic corner map', () => {
  test('maps every frozen legacy candidate exactly once with stable ids and markers', () => {
    for (let definitionIndex = 0; definitionIndex < TRACK_DEFS.length; definitionIndex++) {
      const first = buildSemanticTrack(definitionIndex);
      const second = buildSemanticTrack(definitionIndex);
      const expectedCandidates = frozenCornerCandidates(first.track, first.legacyPath)
        .map(candidate => candidate.apexI)
        .sort((left, right) => left - right);
      const actualCandidates = first.track.corners
        .flatMap(corner => [...corner.legacyCandidateIndices])
        .sort((left, right) => left - right);
      expect(actualCandidates).toEqual(expectedCandidates);
      expect(new Set(actualCandidates).size).toBe(actualCandidates.length);
      expect(first.track.corners.map(corner => ({
        id: corner.id,
        regionStartI: corner.regionStartI,
        regionEndI: corner.regionEndI,
        approachI: corner.approachI,
        brakeI: corner.brakeI,
        turnInI: corner.turnInI,
        apexI: corner.apexI,
        trackOutI: corner.trackOutI,
        exitI: corner.exitI,
        side: corner.side,
        complexId: corner.complexId,
        planRole: corner.planRole
      }))).toEqual(second.track.corners.map(corner => ({
        id: corner.id,
        regionStartI: corner.regionStartI,
        regionEndI: corner.regionEndI,
        approachI: corner.approachI,
        brakeI: corner.brakeI,
        turnInI: corner.turnInI,
        apexI: corner.apexI,
        trackOutI: corner.trackOutI,
        exitI: corner.exitI,
        side: corner.side,
        complexId: corner.complexId,
        planRole: corner.planRole
      })));
    }
  });

  test('has valid cyclic phase ordering and signed-curvature sides', () => {
    for (let definitionIndex = 0; definitionIndex < TRACK_DEFS.length; definitionIndex++) {
      const { track } = buildSemanticTrack(definitionIndex);
      for (const corner of track.corners) {
        const phases = [
          corner.approachI,
          corner.brakeI,
          corner.turnInI,
          corner.apexI,
          corner.trackOutI,
          corner.exitI
        ];
        for (let index = 0; index < phases.length - 1; index++) {
          const distance = distanceAhead(track, phases[index]!, phases[index + 1]!);
          expect(distance).toBeGreaterThan(0);
          expect(distance).toBeLessThan(track.len / 2);
        }
        expect(Math.sign(track.kSm[corner.apexI]!) || corner.side).toBe(corner.side);
        expect(corner.reason).toContain('signed-curvature-region');
      }
    }
  });
});

describe('explicit ideal line', () => {
  test('meets isolated targets and every declared complex target exactly', () => {
    for (let definitionIndex = 0; definitionIndex < TRACK_DEFS.length; definitionIndex++) {
      const { track, idealPath } = buildSemanticTrack(definitionIndex);
      const usableHalfWidth = track.hw - PHYS.carWid / 2 - 0.6;
      for (const corner of track.corners) {
        expect(idealPath.off[corner.turnInI]!).toBeCloseTo(corner.entryTarget, 10);
        expect(idealPath.off[corner.apexI]!).toBeCloseTo(corner.apexTarget, 10);
        expect(idealPath.off[corner.trackOutI]!).toBeCloseTo(corner.exitTarget, 10);
        if (!corner.isolated) {
          expect(corner.complexId).not.toBeNull();
          expect(corner.compromised).toBe(true);
          expect(corner.planRole).not.toBe('isolated');
          continue;
        }
        const entry = corner.side * idealPath.off[corner.turnInI]! / usableHalfWidth;
        const apex = corner.side * idealPath.off[corner.apexI]! / usableHalfWidth;
        const exit = corner.side * idealPath.off[corner.trackOutI]! / usableHalfWidth;
        expect(entry).toBeLessThanOrEqual(-0.45 + 1e-9);
        expect(apex).toBeGreaterThanOrEqual(0.55 - 1e-9);
        expect(exit).toBeLessThanOrEqual(-0.35 + 1e-9);
      }
    }
  });

  test('is finite, bounded, neutral through pit/start, and no slower than centerline', () => {
    for (let definitionIndex = 0; definitionIndex < TRACK_DEFS.length; definitionIndex++) {
      const { track, centerProfile, idealPath, idealProfile } = buildSemanticTrack(definitionIndex);
      const usableHalfWidth = track.hw - PHYS.carWid / 2 - 0.6;
      expect(idealProfile.lapTime).toBeLessThanOrEqual(centerProfile.lapTime + 1e-6);
      expect(idealPath.off.length).toBe(track.n);
      expect(idealPath.k.length).toBe(track.n);
      expect(idealPath.ds.length).toBe(track.n);
      expect(idealPath.v.length).toBe(track.n);
      for (let index = 0; index < track.n; index++) {
        expect(Number.isFinite(idealPath.off[index]!)).toBe(true);
        expect(Number.isFinite(idealPath.k[index]!)).toBe(true);
        expect(Number.isFinite(idealPath.ds[index]!)).toBe(true);
        expect(Number.isFinite(idealPath.v[index]!)).toBe(true);
        expect(Math.abs(idealPath.off[index]!)).toBeLessThanOrEqual(usableHalfWidth + 1e-6);
        expect(idealPath.ds[index]!).toBeGreaterThan(0.2);
        const s = index * track.step;
        const startDistance = Math.min(s, track.len - s);
        if (startDistance <= 24) expect(Math.abs(idealPath.off[index]!)).toBeLessThan(1e-9);
        const pitStart = ((track.pit.sEntry - 80) % track.len + track.len) % track.len;
        const pitEnd = (track.pit.sExit + 30) % track.len;
        const pitSpan = ((pitEnd - pitStart) % track.len + track.len) % track.len;
        const pitPosition = ((s - pitStart) % track.len + track.len) % track.len;
        if (pitPosition > track.step && pitPosition < pitSpan - track.step)
          expect(Math.abs(idealPath.off[index]!)).toBeLessThan(1e-9);
      }
      const geometry = derivePathGeometry(track, idealPath);
      for (let index = 0; index < track.n; index++) {
        expect(Number.isFinite(geometry.x[index]!)).toBe(true);
        expect(Number.isFinite(geometry.y[index]!)).toBe(true);
        expect(Number.isFinite(geometry.tx[index]!)).toBe(true);
        expect(Number.isFinite(geometry.ty[index]!)).toBe(true);
      }
    }
  });
});
