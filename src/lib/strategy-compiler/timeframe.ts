import { ParserResult, StrategyParserModule } from './types';
import { timeframeSynonyms } from './synonyms/timeframe';
import { findSynonymMatch, normalizeText } from './normalizer';

export class TimeframeParser implements StrategyParserModule<string[]> {
  parse(text: string): ParserResult<string[]> {
    const match = findSynonymMatch(text, timeframeSynonyms, 'TIMEFRAME_FILTER', 0.98);
    
    const normalized = text.toLowerCase();
    const timeframes: string[] = [];
    
    const tfPatterns = [
      { pattern: /\b1\s*m\b|\bm1\b|\b1\s*min\b|\b1\s*minute\b/i, label: '1m' },
      { pattern: /\b5\s*m\b|\bm5\b|\b5\s*min\b|\b5\s*minute\b/i, label: '5m' },
      { pattern: /\b15\s*m\b|\bm15\b|\b15\s*min\b|\b15\s*minute\b/i, label: '15m' },
      { pattern: /\b30\s*m\b|\bm30\b|\b30\s*min\b|\b30\s*minute\b/i, label: '30m' },
      { pattern: /\b1\s*h\b|\bh1\b|\b1\s*hour\b|\bhourly\b/i, label: '1h' },
      { pattern: /\b4\s*h\b|\bh4\b|\b4\s*hour\b/i, label: '4h' },
      { pattern: /\bd1\b|\bdaily\b|\bday\b/i, label: 'Daily' }
    ];
    
    for (const tf of tfPatterns) {
      if (tf.pattern.test(normalized)) {
        timeframes.push(tf.label);
      }
    }
    
    const supported = match.matched || timeframes.length > 0;
    
    return {
      supported,
      confidence: supported ? 0.98 : 0.0,
      parsedRule: timeframes,
      matchedPhrase: match.matched ? match.matchedPhrase : (timeframes.length > 0 ? timeframes.join(", ") : ""),
      canonicalRule: match.matched ? match.canonicalRule : (timeframes.length > 0 ? "TIMEFRAME_FILTER" : "")
    };
  }
}
