const NON_ZERO_DEFAULT_SEED = 0x6d2b79f5;

export interface DeterministicRandomResult {
  readonly state: number;
  readonly value: number;
}

export function nextDeterministicRandom(savedState: number): DeterministicRandomResult {
  let state = (savedState >>> 0) || NON_ZERO_DEFAULT_SEED;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return { state, value: state };
}
