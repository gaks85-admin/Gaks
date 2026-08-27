import { ParserResult, StrategyParserModule } from './types.js';
import { supportResistanceSynonyms } from './synonyms/support-resistance.js';
import { findSynonymMatch } from './normalizer.js';
import { matchPhraseWithBoundaries, isNegativeOrExclusionContext } from './utils.js';

export interface SupportResistanceRule {
  support: boolean;
  resistance: boolean;
  support_rejection?: boolean;
  resistance_rejection?: boolean;
}

export class SupportResistanceParser implements StrategyParserModule<SupportResistanceRule> {
  parse(text: string): ParserResult<SupportResistanceRule> {
    const match = findSynonymMatch(text, supportResistanceSynonyms, 'SUPPORT_RESISTANCE', 0.95);
    
    let hasSupport = (
      matchPhraseWithBoundaries(text, 'support') ||
      matchPhraseWithBoundaries(text, 'demand') ||
      matchPhraseWithBoundaries(text, 'demand zone') ||
      matchPhraseWithBoundaries(text, 'key level')
    ) && !isNegativeOrExclusionContext(text, 'support') && !isNegativeOrExclusionContext(text, 'demand');
    
    let hasResistance = (
      matchPhraseWithBoundaries(text, 'resistance') ||
      matchPhraseWithBoundaries(text, 'supply') ||
      matchPhraseWithBoundaries(text, 'supply zone') ||
      matchPhraseWithBoundaries(text, 'key level')
    ) && !isNegativeOrExclusionContext(text, 'resistance') && !isNegativeOrExclusionContext(text, 'supply');
    
    if (match.matched) {
      hasSupport = true;
      hasResistance = true;
    }
    
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
      if (matchPhraseWithBoundaries(text, syn)) {
        support_rejection = true;
        hasSupport = true;
      }
    }
    
    for (const syn of resistanceBounceSyns) {
      if (matchPhraseWithBoundaries(text, syn)) {
        resistance_rejection = true;
        hasResistance = true;
      }
    }
    
    const supported = match.matched || hasSupport || hasResistance;
    
    const matchedPhrase = match.matched ? match.matchedPhrase : (
      matchPhraseWithBoundaries(text, 'support') ? 'support' :
      matchPhraseWithBoundaries(text, 'demand') ? 'demand' :
      matchPhraseWithBoundaries(text, 'resistance') ? 'resistance' :
      matchPhraseWithBoundaries(text, 'supply') ? 'supply' :
      (hasSupport ? "demand" : (hasResistance ? "supply" : ""))
    );
    
    return {
      supported,
      confidence: supported ? 0.95 : 0.0,
      parsedRule: {
        support: hasSupport,
        resistance: hasResistance,
        support_rejection,
        resistance_rejection
      },
      matchedPhrase,
      canonicalRule: match.matched ? match.canonicalRule : "SUPPORT_RESISTANCE"
    };
  }
}
