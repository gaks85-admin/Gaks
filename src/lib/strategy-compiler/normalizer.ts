import { emaSynonyms } from './synonyms/ema.js';
import { isNegativeOrExclusionContext, matchPhraseWithBoundaries, escapeRegExp } from './utils.js';
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
  defaultConfidence = 0.95
): SynonymMatch {
  for (const synonym of synonyms) {
    if (matchPhraseWithBoundaries(originalText, synonym)) {
      if (isNegativeOrExclusionContext(originalText, synonym)) {
        continue;
      }
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

export function isMandatory(originalText: string, matchedPhrase: string): boolean {
  if (!matchedPhrase || !matchedPhrase.trim()) return false;
  
  // Check if phrase is in a negative/exclusion context in the text
  if (isNegativeOrExclusionContext(originalText, matchedPhrase)) {
    return false;
  }

  const normalizedPhrase = normalizeText(matchedPhrase);
  
  // 1. Identify clauses from original text preserving line breaks
  const clauses = originalText.toLowerCase().split(/[\n,.;]|\band\b/);
  
  // Find clause using strict word boundaries
  const targetClauseRaw = clauses.find(c => matchPhraseWithBoundaries(c, matchedPhrase)) || clauses.find(c => normalizeText(c).includes(normalizedPhrase));
  
  if (!targetClauseRaw) return false;
  
  if (isNegativeOrExclusionContext(targetClauseRaw, matchedPhrase)) {
    return false;
  }

  const targetClause = normalizeText(targetClauseRaw);

  const mandatoryKeywords = ['must', 'required', 'mandatory', 'strictly'];
  const optionalKeywords = ['optional', 'confirmation', 'extra', 'additional', 'if possible', 'weighted', 'filter out', 'ignore', 'avoid'];

  const isOptional = optionalKeywords.some(k => {
    const regex = new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i');
    return regex.test(targetClause);
  });
  
  const isMandatoryExplicit = mandatoryKeywords.some(k => {
    const regex = new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i');
    return regex.test(targetClause);
  });

  if (isOptional) return false;
  if (isMandatoryExplicit) return true;

  // Look backwards for immediate section header
  const lines = originalText.split('\n');
  const lineIdx = lines.findIndex(l => matchPhraseWithBoundaries(l, matchedPhrase));
  if (lineIdx !== -1) {
    for (let i = lineIdx - 1; i >= 0; i--) {
      const prevLine = lines[i].trim().toLowerCase();
      if (prevLine.endsWith(':') || prevLine.startsWith('#') || prevLine.startsWith('==')) {
        const hasMandatoryHeader = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(prevLine));
        const hasOptionalHeader = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(prevLine));
        if (hasMandatoryHeader) return true;
        if (hasOptionalHeader) return false;
        break;
      }
    }
  }

  return true; // Default to mandatory if in entry rules
}

export function normalizeRuleId(rawRuleId: string): string {
  if (!rawRuleId) return "";
  const clean = rawRuleId.toLowerCase().trim().replace(/[\s\-_]+/g, '_');
  
  if (clean === 'trendline' || clean === 'trendline_breakout') return 'trendline_breakout';
  if (clean === 'retest' || clean === 'break_and_retest') return 'break_and_retest';
  if (clean === 'bos' || clean === 'break_of_structure') return 'bos';
  if (clean === 'choch' || clean === 'change_of_character') return 'choch';
  if (clean === 'confirmation_candle' || clean === 'confirmation') return 'confirmation_candle';
  if (clean === 'liquidity_sweep' || clean === 'liquidity') return 'liquidity_sweep';
  if (clean === 'fair_value_gap' || clean === 'fvg') return 'fair_value_gap';
  if (clean === 'support' || clean === 'support_zone') return 'support';
  if (clean === 'resistance' || clean === 'resistance_zone') return 'resistance';
  if (clean === 'support_rejection') return 'support_rejection';
  if (clean === 'resistance_rejection') return 'resistance_rejection';
  if (clean === 'support_resistance' || clean === 's_r') return 'support';
  if (clean === 'ema' || clean === 'ema_alignment') return 'ema';
  if (clean === 'rsi' || clean === 'rsi_filter') return 'rsi';
  if (clean === 'macd' || clean === 'macd_filter') return 'macd';
  if (clean === 'atr' || clean === 'atr_volatility_filter') return 'atr';
  if (clean === 'volume_confirmation' || clean === 'volume') return 'volume_confirmation';
  if (clean === 'session' || clean === 'session_filter') return 'session';
  if (clean === 'timeframes' || clean === 'timeframe' || clean === 'timeframe_filter') return 'timeframes';
  if (clean === 'risk_reward' || clean === 'r_r') return 'risk_reward';

  return clean;
}
