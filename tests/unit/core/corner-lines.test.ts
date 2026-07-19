import { describe, expect, test } from 'bun:test';
import {
  evaluateCornerLine,
  installCornerLineLibrary,
  materializeCornerLine,
  sampleCornerLineEta,
  sampleCornerLineEtaAnalytic
} from '../../../src/core/corner-lines';
import { PHYS } from '../../../src/core/physics';
import { normalLateralIsLegal } from '../../../src/core/surface';
import type { CornerLinePairProfile, TrackProfile } from '../../../src/core/model';
import { TRACK_PROFILES } from '../../../src/data/track-profiles';
import { PIT_TEAMS, TRACK_DEFS } from '../../../src/data/tracks';
import { buildTrackDefinition } from '../../../src/game/tracks';

describe('cached per-corner alternate line library', () => {
  test('natural spline samples are finite and C2-continuous at every profile knot', () => {
    const built = buildTrackDefinition(TRACK_DEFS[0]!, PIT_TEAMS, { requireProfile: true });
    const epsilonIndex = 1e-6;
    for (const corner of built.tr.corners) {
      const pair = corner.alternateLines!;
      for (const line of [
        pair.inside.idealRejoin,
        pair.inside.sustainedOffset,
        pair.outside.idealRejoin,
        pair.outside.sustainedOffset
      ]) {
        const start = sampleCornerLineEtaAnalytic(
          built.tr,
          corner,
          line,
          corner.approachI
        );
        const end = sampleCornerLineEtaAnalytic(
          built.tr,
          corner,
          line,
          corner.exitI
        );
        const terminalEta = line.terminal === 'sustained-offset'
          ? line.points[0]!.eta
          : 0;
        expect(start.eta).toBeCloseTo(terminalEta, 12);
        expect(end.eta).toBeCloseTo(terminalEta, 12);
        if (line.terminal === 'sustained-offset') {
          expect(start.firstDerivative).toBe(0);
          expect(end.firstDerivative).toBeCloseTo(0, 12);
        }
        expect(start.secondDerivative).toBe(0);
        expect(end.secondDerivative).toBeCloseTo(0, 12);
        const afterExit = sampleCornerLineEtaAnalytic(
          built.tr,
          corner,
          line,
          corner.exitI + 1
        );
        expect(afterExit.eta).toBeCloseTo(terminalEta, 12);
        expect(afterExit.firstDerivative).toBeCloseTo(0, 12);
        expect(afterExit.secondDerivative).toBeCloseTo(0, 12);
        expect(sampleCornerLineEta(
          built.tr,
          corner,
          line,
          corner.apexI
        )).toBe(sampleCornerLineEtaAnalytic(
          built.tr,
          corner,
          line,
          corner.apexI
        ).eta);

        for (const point of line.points) {
          const sample = sampleCornerLineEtaAnalytic(
            built.tr,
            corner,
            line,
            point.index
          );
          expect(sample.eta).toBeCloseTo(point.eta, 12);
          expect(Number.isFinite(sample.firstDerivative)).toBe(true);
          expect(Number.isFinite(sample.secondDerivative)).toBe(true);
        }
        for (const point of line.points.slice(1, -1)) {
          const before = sampleCornerLineEtaAnalytic(
            built.tr,
            corner,
            line,
            point.index - epsilonIndex
          );
          const after = sampleCornerLineEtaAnalytic(
            built.tr,
            corner,
            line,
            point.index + epsilonIndex
          );
          expect(before.eta).toBeCloseTo(after.eta, 5);
          expect(before.firstDerivative).toBeCloseTo(after.firstDerivative, 5);
          expect(before.secondDerivative).toBeCloseTo(after.secondDerivative, 5);
        }
      }
    }
  });

  test('covers every semantic corner with finite, legal, timed inside/outside geometry', () => {
    for (const definition of TRACK_DEFS) {
      const built = buildTrackDefinition(definition, PIT_TEAMS, { requireProfile: true });
      const profile = TRACK_PROFILES.find(candidate =>
        candidate.trackId === definition.id
      )! as TrackProfile;
      expect(profile.cornerLines?.length).toBe(built.tr.corners.length);
      for (const corner of built.tr.corners) {
        const pair = profile.cornerLines!.find(candidate =>
          candidate.cornerId === corner.id
        )! as CornerLinePairProfile;
        expect(corner.alternateLines?.inside).toBe(pair.inside);
        expect(corner.alternateLines?.outside).toBe(pair.outside);
        const apexInside = built.tr.idealPath.off[corner.apexI]! +
          pair.inside.idealRejoin.points.find(point =>
            point.index === corner.apexI
          )!.eta;
        const apexOutside = built.tr.idealPath.off[corner.apexI]! +
          pair.outside.idealRejoin.points.find(point =>
            point.index === corner.apexI
          )!.eta;
        expect(corner.side * (apexInside - apexOutside)).toBeGreaterThanOrEqual(
          PHYS.carWid - 1e-8
        );
        for (const line of [
          pair.inside.idealRejoin,
          pair.inside.sustainedOffset,
          pair.outside.idealRejoin,
          pair.outside.sustainedOffset
        ]) {
          if (line.terminal === 'ideal-rejoin') {
            expect(line.points.length).toBe(6);
            expect(line.points[0]).toEqual({ index: corner.approachI, eta: 0 });
            expect(line.points.at(-1)).toEqual({ index: corner.exitI, eta: 0 });
          } else {
            expect(line.points.map(point => point.index)).toEqual([
              corner.approachI,
              corner.turnInI,
              corner.apexI,
              corner.exitI
            ]);
            expect(line.points[0]!.eta).toBe(line.points[1]!.eta);
            expect(line.points[0]!.eta).toBe(line.points.at(-1)!.eta);
          }
          const path = materializeCornerLine(built.tr, corner, line);
          for (let index = 0; index < built.tr.n; index++) {
            expect(Number.isFinite(path.k[index]!)).toBe(true);
            expect(Number.isFinite(path.ds[index]!)).toBe(true);
            expect(Number.isFinite(path.v[index]!)).toBe(true);
            expect(normalLateralIsLegal(built.tr, index, path.off[index]!)).toBe(true);
          }
          const evaluated = evaluateCornerLine(built.tr, corner, line);
          expect(evaluated.brakeI).toBe(line.brakeI);
          expect(Math.abs(evaluated.apexSpeed - line.apexSpeed)).toBeLessThanOrEqual(1e-8);
          expect(Math.abs(
            evaluated.cornerTimeSeconds - line.cornerTimeSeconds
          )).toBeLessThanOrEqual(1e-8);
          expect(Math.abs(
            evaluated.lapTimeLossSeconds - line.lapTimeLossSeconds
          )).toBeLessThanOrEqual(1e-8);
        }
      }
    }
  }, 30_000);

  test('covers every corner that can fit the physical scalar agreement', () => {
    const centreClearance = PHYS.carWid;
    for (const definition of TRACK_DEFS) {
      const built = buildTrackDefinition(definition, PIT_TEAMS, {
        requireProfile: true
      });
      for (const corner of built.tr.corners) {
        const pair = corner.alternateLines!;
        const lower = corner.side > 0
          ? pair.outside.sustainedOffset
          : pair.inside.sustainedOffset;
        const upper = corner.side > 0
          ? pair.inside.sustainedOffset
          : pair.outside.sustainedOffset;
        const count = (
          corner.exitI - corner.approachI + built.tr.n
        ) % built.tr.n;
        let surfaceLower = -Infinity;
        let surfaceUpper = Infinity;
        let lowerMaximum = -Infinity;
        let upperMinimum = Infinity;
        for (let delta = 0; delta <= count; delta++) {
          const index = (corner.approachI + delta) % built.tr.n;
          const ideal = built.tr.idealPath.off[index]!;
          surfaceLower = Math.max(
            surfaceLower,
            built.tr.surface.normalMinimum[index]! - ideal
          );
          surfaceUpper = Math.min(
            surfaceUpper,
            built.tr.surface.normalMaximum[index]! - ideal
          );
          lowerMaximum = Math.max(
            lowerMaximum,
            sampleCornerLineEta(built.tr, corner, lower, index)
          );
          upperMinimum = Math.min(
            upperMinimum,
            sampleCornerLineEta(built.tr, corner, upper, index)
          );
        }
        expect(upperMinimum - lowerMaximum >= centreClearance - 1e-9).toBe(
          surfaceUpper - surfaceLower >= centreClearance - 1e-9
        );
      }
    }
  });

  test('rejects missing coverage and a line that does not rejoin the ideal authority', () => {
    const built = buildTrackDefinition(TRACK_DEFS[0]!, PIT_TEAMS, { requireProfile: true });
    const library = TRACK_PROFILES[0]!.cornerLines as readonly CornerLinePairProfile[];
    expect(() => installCornerLineLibrary(built.tr, library.slice(1))).toThrow('coverage');
    const first = library[0]!;
    const corrupt: CornerLinePairProfile = {
      ...first,
      inside: {
        ...first.inside,
        idealRejoin: {
          ...first.inside.idealRejoin,
          points: first.inside.idealRejoin.points.map((point, index) =>
            index === 0 ? { ...point, eta: PHYS.carWid } : point
          )
        }
      }
    };
    expect(() => installCornerLineLibrary(
      built.tr,
      [corrupt, ...library.slice(1)]
    )).toThrow('join the ideal line');
  });
});
