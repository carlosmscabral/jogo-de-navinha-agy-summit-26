/**
 * Deterministic PRNG (mulberry32). Chosen because it fits in ten lines,
 * needs no new dependency, and has a period more than sufficient for a
 * 90-second match. It is not cryptographic and doesn't need to be.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom {
  readonly seed: number;
  private readonly rand: () => number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.rand = mulberry32(this.seed);
  }

  next(): number {
    return this.rand();
  }

  /** Integer in [min, max], both inclusive — same semantics as Phaser.Math.Between. */
  between(min: number, max: number): number {
    return Math.floor(this.rand() * (max - min + 1)) + min;
  }

  floatBetween(min: number, max: number): number {
    return this.rand() * (max - min) + min;
  }

  chance(probability: number): boolean {
    return this.rand() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.between(0, items.length - 1)];
  }
}

/** Random seed for a booth match, recorded in telemetry. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
