/** Normalizes untrusted task text for deterministic phrase matching only. */
export function normalizeSafetyText(...values: readonly string[]): string {
  return values
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function containsAnySafetyPhrase(
  normalizedText: string,
  phrases: readonly string[]
): boolean {
  return phrases.some((phrase) => normalizedText.includes(normalizeSafetyText(phrase)))
}
