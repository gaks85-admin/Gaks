import { ParserResult, StrategyParserModule } from './types';
import { supportResistanceSynonyms } from './synonyms/support-resistance';
import { findSynonymMatch, normalizeText } from './normalizer';

export interface SupportResistanceRule {
  support: boolean;
  resistance: boolean;
  support_rejection?: boolean;
  resistance_rejection?: boolean;
}

export class SupportResistanceParser implements StrategyParserModule<SupportResistanceRule> {
  parse(text: string): ParserResult<SupportResistanceRule> {
    const match = findSynonymMatch(text, supportResistanceSynonyms, 'SUPPORT_RESISTANCE', 0.95);
    
    const normalized = normalizeText(text);
    
    let hasSupport = normalized.includes('support') || normalized.includes('s r');
    let hasResistance = normalized.includes('resistance') || normalized.includes('s r');
    
    let support_rejection = false;
    let resistance_rejection = false;
    
    const supportBounceSyns = [
      "support rejection", "bounce from support", "rejection from support",
      "respect support", "bounce off support", "support bounce", "rejection at support"
    ];
    
    const resistanceBounceSyns = [
      "resistance rejection", "bounce from resistance", "rejection from resistance",
      "respect resistance", "bounce off resistance", "resistance bounce", "rejection at resistance"
    ];
    
    for (const syn of supportBounceSyns) {
      if (normalized.includes(normalizeText(syn))) {
        support_rejection = true;
        hasSupport = true;
      }
    }
    
    for (const syn of resistanceBounceSyns) {
      if (normalized.includes(normalizeText(syn))) {
        resistance_rejection = true;
        hasResistance = true;
      }
    }
    
    const supported = match.matched || hasSupport || hasResistance;
    
    return {
      supported,
      confidence: supported ? 0.95 : 0.0,
      parsedRule: {
        support: hasSupport,
        resistance: hasResistance,
        support_rejection,
        resistance_rejection
      },
      matchedPhrase: match.matched ? match.matchedPhrase : (hasSupport ? "support" : (hasResistance ? "resistance" : "")),
      canonicalRule: match.matched ? match.canonicalRule : "SUPPORT_RESISTANCE"
    };
  }
}
