import { TRACK_DEFS } from '../../src/data/tracks';
import type { TrackDefinition } from '../../src/shared/types';

const source = TRACK_DEFS[0]!;

/**
 * Tools-only unseen-track fixture. It intentionally has no committed profile
 * and is not part of the production calendar or browser catalog.
 */
export const NEW_TRACK_FIXTURE = {
  ...source,
  id: 'new-track-fixture',
  no: 'T1',
  name: 'Optimizer Cold-Start Fixture',
  country: 'TST',
  width: 12.5,
  seed: 1701,
  meta: {
    archetype: 'optimizer-fixture',
    blurb: 'Non-production geometry used to prove missing-profile cold-start optimization.'
  },
  pts: source.pts.map(([x, y], index) => [
    x * 1.04 + Math.sin(index * 0.37) * 1.2,
    y * 1.10 + Math.cos(index * 0.29) * 0.8
  ] as const)
} satisfies TrackDefinition;
