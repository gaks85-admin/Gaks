export interface MatchResult {
  matched: boolean;
  matchedPhrase: string;
  canonicalRule: string;
  confidence: number;
}

function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchPhraseWithBoundaries(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const escaped = escapeRegExp(phrase.toLowerCase());
  const prefix = isWordChar(phrase[0]) ? '\\b' : '';
  const suffix = isWordChar(phrase[phrase.length - 1]) ? '\\b' : '';
  const regex = new RegExp(`${prefix}${escaped}${suffix}`, 'i');
  return regex.test(text);
}

export function isNegativeOrExclusionContext(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const lowerText = text.toLowerCase();
  const lowerPhrase = phrase.toLowerCase();
  
  // Find all match indices
  let searchPos = 0;
  let matchFound = false;
  let allMatchesNegative = true;

  const negativePatterns = [
    'filter out', 'ignore', 'avoid', 'do not', "don't", 'without', 'exclude',
    'excluding', 'never', 'already retested', 'already touched', 'already filled',
    'already mitigated', 'no retest', 'not required'
  ];

  while (true) {
    const idx = lowerText.indexOf(lowerPhrase, searchPos);
    if (idx === -1) break;
    matchFound = true;

    // Extract up to 80 chars preceding the match, limited to current sentence/line
    const clauseStart = Math.max(0, idx - 80);
    const precedingClause = lowerText.substring(clauseStart, idx);
    const lastSentenceBoundary = Math.max(
      precedingClause.lastIndexOf('.'),
      precedingClause.lastIndexOf(';'),
      precedingClause.lastIndexOf('\n')
    );
    const relevantClause = lastSentenceBoundary !== -1 
      ? precedingClause.substring(lastSentenceBoundary + 1) 
      : precedingClause;

    const isNeg = negativePatterns.some(pat => relevantClause.includes(pat));
    if (!isNeg) {
      allMatchesNegative = false;
    }
    searchPos = idx + lowerPhrase.length;
  }

  return matchFound && allMatchesNegative;
}

export function findSynonymMatch(text: string, synonyms: string[], canonicalKey: string, baseConfidence = 0.9): MatchResult {
  const normalizedInput = text.toLowerCase();
  for (const synonym of synonyms) {
    if (matchPhraseWithBoundaries(normalizedInput, synonym)) {
      if (isNegativeOrExclusionContext(text, synonym)) {
        continue; // Skip negative/exclusion matches
      }
      return {
        matched: true,
        matchedPhrase: synonym,
        canonicalRule: canonicalKey,
        confidence: baseConfidence
      };
    }
  }
  return { matched: false, matchedPhrase: '', canonicalRule: canonicalKey, confidence: 0 };
}
