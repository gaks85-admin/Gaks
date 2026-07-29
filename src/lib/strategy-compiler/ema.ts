import { ParserResult, StrategyParserModule } from './types';
import { emaSynonyms } from './synonyms/ema';
import { findSynonymMatch, normalizeText } from './normalizer';

export interface EmaRule {
  enabled: boolean;
  periods: number[];
  type?: string;
}

export class EmaParser implements StrategyParserModule<EmaRule> {
  parse(text: string): ParserResult<EmaRule> {
    const match = findSynonymMatch(text, emaSynonyms, 'EMA_CROSSOVER', 0.95);
    
    let supported = match.matched;
    let matchedPhrase = match.matchedPhrase;
    let canonicalRule = match.canonicalRule;
    let confidence = match.confidence;
    
    const normalizedInput = normalizeText(text);
    if (!supported && (normalizedInput.includes('ema') || normalizedInput.includes('exponential moving average') || normalizedInput.includes('moving average'))) {
      supported = true;
      matchedPhrase = normalizedInput.includes('ema') ? 'EMA' : 'moving average';
      canonicalRule = 'EMA';
      confidence = 0.90;
    }
    
    const periods: number[] = [];
    
    if (supported) {
      const matches = text.match(/\b\d+\s*-?\s*period\s*ema|\b\d+\s*ema|ema\s*\d+|ema\s*with\s*period\s*\d+|\b\d+\s*exponential\s*moving|\b\d+\s*moving\s*average|\b\d+\s*ma/gi);
      if (matches) {
        for (const m of matches) {
          const digits = m.match(/\d+/g);
          if (digits) {
            for (const d of digits) {
              const val = parseInt(d, 10);
              if (val > 0 && val < 1000 && !periods.includes(val)) {
                periods.push(val);
              }
            }
          }
        }
      }
      
      if (periods.length === 0) {
        const numbersInText = text.match(/\b(8|9|10|20|21|50|100|200)\b/g);
        if (numbersInText) {
          for (const num of numbersInText) {
            const val = parseInt(num, 10);
            if (!periods.includes(val)) {
              periods.push(val);
            }
          }
        }
      }
    }
    
    const isCrossover = match.matched || /\bcross\b|\bcrossover\b/i.test(text);
    
    return {
      supported,
      confidence,
      parsedRule: {
        enabled: supported,
        periods: periods.sort((a, b) => a - b),
        ...(isCrossover ? { type: 'crossover' } : {})
      },
      matchedPhrase,
      canonicalRule
    };
  }
}
