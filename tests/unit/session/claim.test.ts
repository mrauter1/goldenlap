import { describe, expect, test } from 'bun:test';

import type { Track } from '../../../src/core/model';
import type { RacecraftClaim } from '../../../src/session/model';
import {
  racecraftClaimAtEvaluationEpoch,
  racecraftTrajectoryProgramFromRows,
  racecraftTrajectoryProgressAtTime,
  racecraftTrajectoryStateAtTime,
  racecraftClaimStateAtTime,
  writeRacecraftClaimTowStateAtTime
} from '../../../src/session/racecraft/claim';

const TRACK = {
  len: 100,
  n: 50,
  step: 2
} as Track;

function claim(
  overrides: Partial<RacecraftClaim> = {}
): RacecraftClaim {
  const centre = overrides.originCentre ?? 0;
  const originS = overrides.originS ?? 99;
  const originSpeed = overrides.originSpeed ?? 10;
  const originHeading =
    overrides.originHeadingOffsetRadians ?? 0;
  return {
    code: 'CAR',
    predictionKey: 'staged-attack:1:1',
    lateralAuthorityRevision: 0,
    longitudinalAuthorityRevision: 0,
    publicationRevision: 0,
    publishedAt: 0,
    originS,
    originCentre: centre,
    originSpeed,
    originHeadingOffsetRadians: originHeading,
    trusted: true,
    mode: 'staged-attack',
    targetCode: 'LEADER',
    cornerId: null,
    selectedPlanNumericId: 1,
    selectedFamilyNumericId: 1,
    selectedLongitudinalProgram: null,
    ownershipAssertion: null,
    defensiveCommitment: null,
    trajectoryTimeOffsetSeconds: 0,
    trajectory: racecraftTrajectoryProgramFromRows(
      TRACK,
      {
        timeSeconds: 0,
        sMetres: originS,
        speedMetresPerSecond: originSpeed,
        lateralMetres: centre,
        headingOffsetRadians: originHeading
      },
      [1, 2].map(time => ({
      timeSeconds: time,
      sMetres: (originS + originSpeed * time) % TRACK.len,
      speedMetresPerSecond: originSpeed,
      lateralMetres: centre,
      headingOffsetRadians: 0
      }))
    ),
    ...overrides
  };
}

describe('immutable publication aging', () => {
  test('ages a consumer view without mutating the publication', () => {
    const publication = claim();
    const originalOrigin = publication.originS;
    const originalFirstProgress =
      publication.trajectory.progressAtStart[0];

    const view = racecraftClaimAtEvaluationEpoch(
      TRACK,
      publication,
      0.5
    ).claim;

    expect(view).not.toBe(publication);
    expect(view.publishedAt).toBe(0.5);
    expect(view.originS).toBeCloseTo(4, 12);
    expect(publication.publishedAt).toBe(0);
    expect(publication.originS).toBe(originalOrigin);
    expect(publication.trajectory.progressAtStart[0])
      .toBe(originalFirstProgress);
    expect(view.trajectory).toBe(publication.trajectory);
  });

  test('interpolates a reanchor seam as a signed correction', () => {
    const publication = claim({
      originS: 40,
      originSpeed: 2,
      trajectory: racecraftTrajectoryProgramFromRows(
        TRACK,
        {
          timeSeconds: 0,
          sMetres: 40,
          speedMetresPerSecond: 2,
          lateralMetres: 0,
          headingOffsetRadians: 0
        },
        [
          {
            timeSeconds: 1,
            sMetres: 42,
            speedMetresPerSecond: 2,
            lateralMetres: 0,
            headingOffsetRadians: 0
          },
          {
            timeSeconds: 2,
            sMetres: 41.9,
            speedMetresPerSecond: 2,
            lateralMetres: 0,
            headingOffsetRadians: 0
          }
        ]
      )
    });
    expect(racecraftClaimStateAtTime(TRACK, publication, 1.5).s)
      .toBeCloseTo(41.95, 12);

    const acrossZero = claim({
      originS: 0.1,
      originSpeed: 0,
      trajectory: racecraftTrajectoryProgramFromRows(
        TRACK,
        {
          timeSeconds: 0,
          sMetres: 0.1,
          speedMetresPerSecond: 0,
          lateralMetres: 0,
          headingOffsetRadians: 0
        },
        [{
          timeSeconds: 1,
          sMetres: 99.9,
          speedMetresPerSecond: 0,
          lateralMetres: 0,
          headingOffsetRadians: 0
        }]
      )
    });
    expect(racecraftClaimStateAtTime(TRACK, acrossZero, 0.5).s)
      .toBeCloseTo(0, 12);
  });

  test('interpolates body orientation across the angular seam', () => {
    const publication = claim({
      originHeadingOffsetRadians: Math.PI - 0.1,
      trajectory: racecraftTrajectoryProgramFromRows(
        TRACK,
        {
          timeSeconds: 0,
          sMetres: 99,
          speedMetresPerSecond: 10,
          lateralMetres: 0,
          headingOffsetRadians: Math.PI - 0.1
        },
        [{
          timeSeconds: 1,
          sMetres: 9,
          speedMetresPerSecond: 10,
          lateralMetres: 0,
          headingOffsetRadians: -Math.PI + 0.1
        }]
      )
    });
    expect(Math.abs(
      racecraftClaimStateAtTime(TRACK, publication, 0.5)
        .headingOffsetRadians
    )).toBeCloseTo(Math.PI, 12);
  });

  test('writes the exact reduced state used by tow lookup', () => {
    const publication = claim({ trajectoryTimeOffsetSeconds: 0.25 });
    const tow = { s: 0, lateral: 0 };
    for (const time of [-1, 0, 0.5, 1.75, 3]) {
      const full = racecraftClaimStateAtTime(
        TRACK,
        publication,
        time
      );
      writeRacecraftClaimTowStateAtTime(
        TRACK,
        publication,
        time,
        tow
      );
      expect(tow.s).toBe(full.s);
      expect(tow.lateral).toBe(full.lateral);
    }
  });

  test('writes the exact reduced progress used by continuous roots', () => {
    const trajectory = claim().trajectory;
    for (const time of [-1, 0, 0.25, 1.5, 3])
      expect(racecraftTrajectoryProgressAtTime(trajectory, time))
        .toBe(
          racecraftTrajectoryStateAtTime(TRACK, trajectory, time)
            .progressMetres
        );
  });
});
