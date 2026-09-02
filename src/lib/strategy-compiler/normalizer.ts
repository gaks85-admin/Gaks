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
  normalized = normalized.replace(/\brisk\s*(?:to|&|and|-)\s*reward\b/g, 'risk reward');
  normalized = normalized.replace(/\b(?:\d+\s*:\s*\d+\s*)?(?:rr|r:r|r\/r)\b/g, 'risk reward');
  normalized = normalized.replace(/\bsupply\s*(?:&|\/|and)\s*demand\b/g, 'supply and demand');
  normalized = normalized.replace(/\bs&d\b/g, 'supply and demand');
  normalized = normalized.replace(/\border\s*blocks?\b/g, 'order block');
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

export function extractDedicatedMandatorySection(text: string): string[] | null {
  if (!text) return null;
  const lines = text.split('\n');
  let inMandatorySection = false;
  const dedicatedHeaderLines: string[] = [];
  const labeledItemLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim().toLowerCase();

    // Check if line is a dedicated mandatory section header
    // e.g. "Mandatory rules:", "Madoratory rules;", "Mandatory Rules", "Core Entry Rules (Mandatory):"
    const isSectionHeader = /^(?:(?:mandatory|madoratory)\s+rules?|core\s+mandatory\s+rules?)\s*[:;=-]*$/i.test(trimmed) ||
                            /^(?:core\s+entry\s+rules|entry\s+rules)\s*\((?:mandatory|madoratory)\)\s*[:;=-]*$/i.test(trimmed);

    if (isSectionHeader) {
      inMandatorySection = true;
      dedicatedHeaderLines.length = 0; // If a new dedicated section header appears, it takes precedence
      continue;
    }

    if (inMandatorySection) {
      // Check if a new top-level section started
      const isNewSection = /^[a-z][a-z0-9\s]{2,}\s*[:;=-]$/i.test(trimmed) &&
                           !/^\d+[\.\)]/.test(trimmed) &&
                           !trimmed.startsWith('-') &&
                           !trimmed.startsWith('*');

      if (isNewSection) {
        inMandatorySection = false;
        continue;
      }

      if (trimmed.length > 0) {
        dedicatedHeaderLines.push(trimmed);
      }
    } else {
      // Also catch individually numbered/bulleted lines explicitly labeled as (Mandatory)
      // e.g. "1. Unmitigated Zone Identification (Mandatory):" or "2. Risk & Reward (Mandatory)"
      if (/^\d+[\.\)]\s*.*\((?:mandatory|madoratory)\)/i.test(trimmed)) {
        labeledItemLines.push(trimmed);
      }
    }
  }

  if (dedicatedHeaderLines.length > 0) {
    return dedicatedHeaderLines;
  }

  if (labeledItemLines.length > 0) {
    return labeledItemLines;
  }

  return null;
}

export function isMandatory(originalText: string, matchedPhrase: string): boolean {
  if (!matchedPhrase || !matchedPhrase.trim()) return false;
  
  // Check if phrase is in a negative/exclusion context in the text
  if (isNegativeOrExclusionContext(originalText, matchedPhrase)) {
    return false;
  }

  const normalizedPhrase = normalizeText(matchedPhrase);
  
  const mandatoryKeywords = ['must', 'required', 'mandatory', 'madoratory', 'strictly'];
  const optionalKeywords = ['optional', 'confirmation', 'extra', 'additional', 'if possible', 'weighted', 'filter out', 'ignore', 'avoid'];

  // 0. Dedicated Mandatory Section Isolation
  // If the strategy explicitly contains a dedicated "Mandatory rules:" section,
  // restrict mandatory rule extraction strictly to items specified in that section.
  const dedicatedSectionLines = extractDedicatedMandatorySection(originalText);
  if (dedicatedSectionLines) {
    return dedicatedSectionLines.some(line => {
      if (isNegativeOrExclusionContext(line, matchedPhrase)) return false;

      const normalizedLine = normalizeText(line);
      // If the line explicitly refers to "supply and demand", it targets supply_demand,
      // rather than standalone support/resistance.
      const isSupplyDemandLine = normalizedLine.includes('supply and demand');
      if (isSupplyDemandLine && (matchedPhrase === 'support' || matchedPhrase === 'resistance')) {
        return false;
      }

      // Check if line mentions unmitigated zone or order block
      if ((normalizedLine.includes('unmitigated') || normalizedLine.includes('order block')) &&
          (matchedPhrase === 'order block' || matchedPhrase === 'unmitigated zone' || matchedPhrase === 'order blocks' || matchedPhrase === 'unmitigated' || matchedPhrase === 'unmitigated order block')) {
        return true;
      }

      // Check if line mentions risk reward
      if (normalizedPhrase === 'risk reward' && (normalizedLine.includes('risk reward') || normalizedLine.includes('rr'))) {
        return true;
      }

      return matchPhraseWithBoundaries(line, matchedPhrase) || normalizedLine.includes(normalizedPhrase);
    });
  }

  // 1. Identify clauses from original text preserving line breaks
  // Split on punctuation (. , ; \n), contrasting conjunctions (whereas, however, although, but),
  // and 'and' when followed by another rule clause with its own qualifier (e.g. 'and FVG is optional')
  const clauses = originalText.toLowerCase().split(/[\n.;,]|\b(?:whereas|however|although|while|but)\b|\b(?:and)\s+(?=[a-z0-9_\s]+\s+(?:is|are|must be)\s+(?:optional|mandatory|required|must))\b/i);
  
  for (const clauseRaw of clauses) {
    if (!matchPhraseWithBoundaries(clauseRaw, matchedPhrase) && !normalizeText(clauseRaw).includes(normalizedPhrase)) {
      continue;
    }
    if (isNegativeOrExclusionContext(clauseRaw, matchedPhrase)) {
      continue;
    }
    const targetClause = normalizeText(clauseRaw);
    const isOptionalClause = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(targetClause));
    const isMandatoryExplicit = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(targetClause));

    if (isOptionalClause) continue;
    if (isMandatoryExplicit) return true;
  }

  // 2. Scan lines backwards for enclosing section headers
  const lines = originalText.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const currentLine = lines[lineIdx].trim().toLowerCase();
    if (!matchPhraseWithBoundaries(currentLine, matchedPhrase) && !normalizeText(currentLine).includes(normalizedPhrase)) {
      continue;
    }
    if (isNegativeOrExclusionContext(currentLine, matchedPhrase)) {
      continue;
    }

    // Check if the current line has an alternative 'OR' pattern for this phrase
    // e.g. "BOS or CHOCH", "support or resistance"
    const orPattern = new RegExp(`\\b${escapeRegExp(matchedPhrase.toLowerCase())}\\b\\s+or\\b|\\bor\\s+\\b${escapeRegExp(matchedPhrase.toLowerCase())}\\b`, 'i');
    if (orPattern.test(currentLine)) {
      continue; // Alternatives are confluences, not hard mandatory rules
    }

    // Check if it's descriptive past context (e.g. "that created a Break of Structure", "after a BOS")
    const pastContextPattern = new RegExp(`\\b(that created|which created|created a|forming a|after a|prior to)\\b.*\\b${escapeRegExp(matchedPhrase.toLowerCase())}\\b`, 'i');
    if (pastContextPattern.test(currentLine)) {
      continue;
    }

    const colonIdx = currentLine.indexOf(':');
    const itemLabel = colonIdx !== -1 ? currentLine.slice(0, colonIdx) : currentLine;
    const isLabelMatch = matchPhraseWithBoundaries(itemLabel, matchedPhrase) || normalizeText(itemLabel).includes(normalizedPhrase);

    // Check if the line itself contains a mandatory indicator
    const lineMandatory = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(currentLine));
    const lineOptional = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(currentLine));
    if (lineOptional) continue;
    if (lineMandatory && (isLabelMatch || !colonIdx || colonIdx === -1)) return true;

    // Scan backwards from this line for enclosing section header
    for (let i = lineIdx - 1; i >= 0; i--) {
      const prevLine = lines[i].trim().toLowerCase();
      // Recognized header formats: ends with colon, starts with #/==, or numbered section header (e.g. "1. ...")
      if (prevLine.endsWith(':') || prevLine.startsWith('#') || prevLine.startsWith('==') || /^\d+\.\s+/.test(prevLine)) {
        const hasMandatoryHeader = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(prevLine));
        const hasOptionalHeader = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(prevLine));
        if (hasOptionalHeader) break;
        if (hasMandatoryHeader) {
          // If the section header is mandatory, only mark mandatory if matchedPhrase is in the itemLabel or the header itself
          if (isLabelMatch) {
            return true;
          }
          if (matchPhraseWithBoundaries(prevLine, matchedPhrase) || normalizeText(prevLine).includes(normalizedPhrase)) {
            return true;
          }
        }
        break; // Stop at immediate enclosing header
      }
    }
  }

  return false;
}

export function isOptional(originalText: string, matchedPhrase: string): boolean {
  if (!matchedPhrase || !matchedPhrase.trim()) return false;
  if (isNegativeOrExclusionContext(originalText, matchedPhrase)) return false;

  const normalizedPhrase = normalizeText(matchedPhrase);
  const optionalKeywords = ['optional', 'if possible', 'secondary', 'nice to have', 'extra', 'additional', 'optionally', 'preferred'];

  // 1. Check if phrase appears under an explicit Optional section
  const lines = originalText.split('\n');
  let inOptionalSection = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().toLowerCase();
    const isOptionalHeader = /^(?:optional\s+rules?|secondary\s+rules?|optional)\s*[:;=-]*$/i.test(trimmed);
    if (isOptionalHeader) {
      inOptionalSection = true;
      continue;
    }
    if (inOptionalSection) {
      const isNewSection = /^[a-z][a-z0-9\s]{2,}\s*[:;=-]$/i.test(trimmed) &&
                           !/^\d+[\.\)]/.test(trimmed) &&
                           !trimmed.startsWith('-') &&
                           !trimmed.startsWith('*');
      if (isNewSection) {
        inOptionalSection = false;
      } else if (matchPhraseWithBoundaries(trimmed, matchedPhrase) || normalizeText(trimmed).includes(normalizedPhrase)) {
        return true;
      }
    }
  }

  // 2. Check individual clauses for explicit optional keywords
  const clauses = originalText.toLowerCase().split(/[\n.;,]|\b(?:whereas|however|although|while|but)\b/i);
  for (const clauseRaw of clauses) {
    if (!matchPhraseWithBoundaries(clauseRaw, matchedPhrase) && !normalizeText(clauseRaw).includes(normalizedPhrase)) {
      continue;
    }
    if (isNegativeOrExclusionContext(clauseRaw, matchedPhrase)) continue;
    const targetClause = normalizeText(clauseRaw);
    const hasOptional = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(targetClause));
    if (hasOptional) return true;
  }

  return false;
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
  if (clean === 'order_block' || clean === 'orderblock' || clean === 'ob' || clean === 'obs') return 'order_block';
  if (clean === 'supply_demand' || clean === 'supply_and_demand' || clean === 's_d') return 'supply_demand';
  if (clean === 'unmitigated_zone' || clean === 'unmitigated' || clean === 'unmitigated_order_block') return 'unmitigated_zone';
  if (clean === 'demand_zone' || clean === 'demand') return 'demand_zone';
  if (clean === 'supply_zone' || clean === 'supply') return 'supply_zone';
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
