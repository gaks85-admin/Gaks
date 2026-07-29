import { emaSynonyms } from './synonyms/ema.js';
import { trendlineSynonyms } from './synonyms/trendline.js';
import { supportResistanceSynonyms } from './synonyms/support-resistance.js';
import { volumeSynonyms } from './synonyms/volume.js';
import { bosSynonyms } from './synonyms/bos.js';
import { chochSynonyms } from './synonyms/choch.js';
import { fvgSynonyms } from './synonyms/fvg.js';
import { liquiditySynonyms } from './synonyms/liquidity.js';
import { sessionSynonyms } from './synonyms/session.js';
import { confirmationCandleSynonyms } from './synonyms/confirmation-candle.js';
import { macdSynonyms } from './synonyms/macd.js';
import { rsiSynonyms } from './synonyms/rsi.js';
import { atrSynonyms } from './synonyms/atr.js';
import { riskRewardSynonyms } from './synonyms/risk-reward.js';
import { timeframeSynonyms } from './synonyms/timeframe.js';
import { subjectiveSynonyms, aiOnlySynonyms } from './synonyms/classification.js';

/**
 * Normalizes input text to simplify semantic matching.
 * Implements lowercase, punctuation removal, whitespace normalization, plural handling, and abbreviations.
 */
export function normalizeText(text: string): string {
  if (!text) return "";
  
  // 1. Lowercase
  let normalized = text.toLowerCase();
  
  // 2. Common abbreviations / symbols standardizations BEFORE general punctuation removal
  normalized = normalized.replace(/\bs\/r\b|\bs&r\b|\bsubport\b/g, 'support resistance');
  normalized = normalized.replace(/\bt\/l\b/g, 'trendline');
  normalized = normalized.replace(/\br\/r\b|\br:r\b/g, 'risk reward');
  normalized = normalized.replace(/\bfvg\b/g, 'fair value gap');
  normalized = normalized.replace(/\bbos\b/g, 'break of structure');
  normalized = normalized.replace(/\bchoch\b/g, 'change of character');
  normalized = normalized.replace(/\bma\b/g, 'moving average');
  normalized = normalized.replace(/\bema\b/g, 'exponential moving average');
  normalized = normalized.replace(/\bmacd\b/g, 'moving average convergence divergence');
  normalized = normalized.replace(/\brsi\b/g, 'relative strength index');
  normalized = normalized.replace(/\batr\b/g, 'average true range');
  
  // 3. Remove standard punctuation but keep alphanumeric characters and spaces
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  
  // 4. Plural handling and common word merges
  normalized = normalized.replace(/\btrend\s+line\b/g, 'trendline');
  normalized = normalized.replace(/\btrendlines\b/g, 'trendline');
  normalized = normalized.replace(/\bcandles\b/g, 'candle');
  normalized = normalized.replace(/\bsessions\b/g, 'session');
  normalized = normalized.replace(/\bvolumes\b/g, 'volume');
  normalized = normalized.replace(/\bimbalances\b/g, 'imbalance');
  normalized = normalized.replace(/\bbreakouts\b/g, 'breakout');
  normalized = normalized.replace(/\blevels\b/g, 'level');
  normalized = normalized.replace(/\brejections\b/g, 'rejection');
  normalized = normalized.replace(/\bsweeps\b/g, 'sweep');
  normalized = normalized.replace(/\bgaps\b/g, 'gap');
  
  // 5. Whitespace normalization
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

export interface SynonymMatch {
  matched: boolean;
  matchedPhrase: string;
  canonicalRule: string;
  confidence: number;
}

/**
 * Searches the normalized input text for any of the listed synonyms (also normalized).
 * Returns a SynonymMatch detailing the results.
 */
export function findSynonymMatch(
  originalText: string,
  synonyms: string[],
  canonicalRule: string,
  defaultConfidence: number
): SynonymMatch {
  const normalizedInput = normalizeText(originalText);
  
  for (const synonym of synonyms) {
    const normalizedSynonym = normalizeText(synonym);
    if (normalizedSynonym && normalizedInput.includes(normalizedSynonym)) {
      return {
        matched: true,
        matchedPhrase: synonym,
        canonicalRule,
        confidence: defaultConfidence
      };
    }
  }
  
  return {
    matched: false,
    matchedPhrase: "",
    canonicalRule,
    confidence: 0.0
  };
}
