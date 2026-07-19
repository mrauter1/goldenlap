export type RandomSource = () => number;

let activeSource: RandomSource | null = null;

/** Gameplay random source. Defaults to the host source so browser seed hooks remain compatible. */
export function random(): number {
  return activeSource ? activeSource() : Math.random();
}

/** Run one synchronous simulation with an isolated random stream. */
export function withRandomSource<T>(source: RandomSource, action: () => T): T {
  const previous = activeSource;
  activeSource = source;
  try {
    return action();
  } finally {
    activeSource = previous;
  }
}

export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return (): number => {
    state += 0x6D2B79F5;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
