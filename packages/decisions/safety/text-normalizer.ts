export type SafetyIntentPattern = Readonly<{
  objectTerms: readonly string[]
  actionTerms: readonly string[]
  contextTerms?: readonly string[]
  maxDistanceCharacters?: number
}>

export type SafetyTextMatch = Readonly<{
  start: number
  end: number
}>

const NEGATED_INTENT_PATTERNS = [
  /(?:필요|요청|대상)(?:은|는|이|가)?\s*없/u,
  /(?:요청|대상|응급\s*상황)(?:은|는|이|가)?\s*아니/u,
  /(?:현금\s*인출|계좌\s*이체|약\s*복용\s*보조|아동\s*단독\s*돌봄|실내\s*출입)(?:은|는|이|가)?\s*아니/u,
  /(?:말고|제외(?:해|하|되|된|하고)?)/u,
  /(?:안|않아도)\s*(?:해|돼|됩니다)/u,
  /(?:원하지|바라지)\s*않/u,
  /(?:건|것|상태)(?:은|는|이|가)?\s*아니/u,
  /필요하?(?:지)?\s*않/u,
  /(?:인출|출금|뽑|찾|이체|송금|복용|먹이|투약|소독|주사|측정|처치|돌보|돌봐|맡|봐|출입|들어|옮기)(?:을|를)?\s*(?:하|해|이)?(?:지)?\s*(?:않|말|마)/u,
  /안\s*(?:뽑|찾|이체|송금|먹이|투약|소독|주사|측정|돌보|돌봐|봐|들어|옮)/u,
  /(?:통증|출혈)(?:은|는|이|가)?\s*없/u
] as const

/** Normalizes untrusted task text for deterministic contextual matching. */
export function normalizeSafetyText(...values: readonly string[]): string {
  return values
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeSafetyClauses(...values: readonly string[]): string[] {
  return values
    .flatMap((value) => value.normalize('NFKC').split(/[.!?。！？;\n]+/u))
    .map((value) => normalizeSafetyText(value))
    .filter((value) => value.length > 0)
}

export function findSafetyTextMatches(
  normalizedText: string,
  directPhrases: readonly string[],
  intentPatterns: readonly SafetyIntentPattern[]
): SafetyTextMatch[] {
  const matches = directPhrases.flatMap((phrase) =>
    findTermOccurrences(normalizedText, normalizeSafetyText(phrase))
  )

  for (const pattern of intentPatterns) {
    if (!hasRequiredContext(normalizedText, pattern.contextTerms)) continue
    const objectMatches = pattern.objectTerms.flatMap((term) =>
      findTermOccurrences(normalizedText, normalizeSafetyText(term))
    )
    const actionMatches = pattern.actionTerms.flatMap((term) =>
      findTermOccurrences(normalizedText, normalizeSafetyText(term))
    )
    const maximumDistance = pattern.maxDistanceCharacters ?? 48

    for (const objectMatch of objectMatches) {
      for (const actionMatch of actionMatches) {
        const distance = actionMatch.start - objectMatch.end
        if (distance < 0 || distance > maximumDistance) continue
        matches.push({ start: objectMatch.start, end: actionMatch.end })
      }
    }
  }

  return uniqueMatches(matches)
}

export function isNegatedSafetyMatch(normalizedText: string, match: SafetyTextMatch): boolean {
  const context = normalizedText.slice(match.start, match.end + 32)
  return NEGATED_INTENT_PATTERNS.some((pattern) => pattern.test(context))
}

function findTermOccurrences(text: string, term: string): SafetyTextMatch[] {
  if (term.length === 0) return []
  const matches: SafetyTextMatch[] = []
  let start = text.indexOf(term)
  while (start >= 0) {
    matches.push({ start, end: start + term.length })
    start = text.indexOf(term, start + 1)
  }
  return matches
}

function hasRequiredContext(text: string, terms: readonly string[] | undefined): boolean {
  return terms === undefined || terms.some((term) => text.includes(normalizeSafetyText(term)))
}

function uniqueMatches(matches: readonly SafetyTextMatch[]): SafetyTextMatch[] {
  const seen = new Set<string>()
  return [...matches]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .filter((match) => {
      const key = `${match.start}:${match.end}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
