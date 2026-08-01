export function hashSeed(value: string): number {
  let hash = 2_166_136_261

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16_777_619)
  }

  return hash >>> 0
}

export function deterministicInteger(seed: string, maximumExclusive: number): number {
  if (!Number.isInteger(maximumExclusive) || maximumExclusive <= 0) {
    throw new RangeError('maximumExclusive must be a positive integer')
  }
  return hashSeed(seed) % maximumExclusive
}
