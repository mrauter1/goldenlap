import { beforeAll, describe, expect, test } from 'bun:test';

import { prepareHeadlessTrack } from '../../../src/game/headless-sim';
import type { BuiltTrack } from '../../../src/core/model';
import type { Session } from '../../../src/session/model';
import { stepSession } from '../../../src/session/session';
import { TRAF_DT } from '../../../src/session/strategy';

let built: BuiltTrack;

beforeAll(() => {
  built = prepareHeadlessTrack('prado');
});

function trafficSession(): Session {
  return {
    trk: built.tr,
    entries: [],
    events: [],
    t: 0,
    wet: 0,
    evo: 0,
    mode: 'race',
    phase: 'run',
    uiT: 0,
    trafT: TRAF_DT,
    goT: 0,
    countT: 0,
    _lt: 0,
    laps: 1,
    chequered: false,
    finCount: 0,
    winT: 0,
    endT: 0,
    raining: false,
    rainAt: -1,
    rainEnd: -1
  } as unknown as Session;
}

describe('session traffic cadence', () => {
  test('accumulates timer residue so traffic keeps the declared 30 Hz cadence', () => {
    const session = trafficSession();
    for (let step = 0; step < 121; step++)
      stepSession(session, 1 / 120);
    expect(session.racecraftTrafficEpoch).toBe(29);
  });
});
