import { ParserResult, StrategyParserModule } from './types.js';

export class TimeframeParser implements StrategyParserModule<string[]> {
  parse(text: string): ParserResult<string[]> {
    const normalized = text.toLowerCase();
    const timeframes: string[] = [];
    
    const tfPatterns = [
      { pattern: /\b1m\b|\bm1\b/i, label: 'M1' },
      { pattern: /\b5m\b|\bm5\b/i, label: 'M5' },
      { pattern: /\b15m\b|\bm15\b/i, label: 'M15' },
      { pattern: /\b30m\b|\bm30\b/i, label: 'M30' },
      { pattern: /\b1h\b|\bh1\b/i, label: 'H1' },
      { pattern: /\b4h\b|\bh4\b/i, label: 'H4' },
      { pattern: /\bd1\b|\b1d\b|\bdaily\b/i, label: 'Daily' }
    ];
    
    for (const tf of tfPatterns) {
      if (tf.pattern.test(normalized)) {
        timeframes.push(tf.label);
      }
    }
    
    const supported = timeframes.length > 0;
    
    return {
      supported,
      confidence: supported ? 0.98 : 0.0,
      parsedRule: timeframes,
      matchedPhrase: timeframes.length > 0 ? timeframes.join(", ") : "",
      canonicalRule: timeframes.length > 0 ? "TIMEFRAME_FILTER" : ""
    };
  }
}

