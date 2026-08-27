import { ParserResult, StrategyParserModule } from './types.js';
import { trendlineSynonyms } from './synonyms/trendline.js';
import { findSynonymMatch } from './normalizer.js';
import { matchPhraseWithBoundaries, isNegativeOrExclusionContext } from './utils.js';

export interface TrendlineRule {
  trendline_breakout: boolean;
  break_and_retest: boolean;
}

export class TrendlineParser implements StrategyParserModule<TrendlineRule> {
  parse(text: string): ParserResult<TrendlineRule> {
    const match = findSynonymMatch(text, trendlineSynonyms, 'TRENDLINE_BREAKOUT', 0.95);
    
    const hasTrendline = match.matched || matchPhraseWithBoundaries(text, 'trendline breakout') || matchPhraseWithBoundaries(text, 'trendline break') || matchPhraseWithBoundaries(text, 'trendline violation');
    
    let hasRetest = (
      matchPhraseWithBoundaries(text, 'break retest') ||
      matchPhraseWithBoundaries(text, 'break and retest') ||
      matchPhraseWithBoundaries(text, 'retest')
    );
    
    if (hasRetest && (isNegativeOrExclusionContext(text, 'retest') || isNegativeOrExclusionContext(text, 'retested') || isNegativeOrExclusionContext(text, 'break and retest'))) {
      hasRetest = false;
    }
    
    const supported = hasTrendline || hasRetest;
    
    return {
      supported,
      confidence: supported ? 0.95 : 0.0,
      parsedRule: {
        trendline_breakout: hasTrendline,
        break_and_retest: hasRetest
      },
      matchedPhrase: match.matched ? match.matchedPhrase : (hasTrendline ? "trendline" : (hasRetest ? "retest" : "")),
      canonicalRule: match.matched ? match.canonicalRule : "TRENDLINE"
    };
  }
}
