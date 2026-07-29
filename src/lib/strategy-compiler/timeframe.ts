import { ParserResult, StrategyParserModule } from './types';

export class TimeframeParser implements StrategyParserModule<string[]> {
  parse(text: string): ParserResult<string[]> {
    const normalized = text.toLowerCase();
    const timeframes: string[] = [];
    
    const tfPatterns = [
      { pattern: /\b1\s*m\b|\bm1\b/i, label: '1m' },
      { pattern: /\b5\s*m\b|\bm5\b/i, label: '5m' },
      { pattern: /\b15\s*m\b|\bm15\b/i, label: '15m' },
      { pattern: /\b30\s*m\b|\bm30\b/i, label: '30m' },
      { pattern: /\b1\s*h\b|\bh1\b/i, label: '1h' },
      { pattern: /\b4\s*h\b|\bh4\b/i, label: '4h' },
      { pattern: /\bd1\b|\bdaily\b|\bday\b/i, label: 'Daily' }
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
      parsedRule: timeframes
    };
  }
}
