import { ParserResult, StrategyParserModule } from './types';

export interface TrendlineRule {
  trendline_breakout: boolean;
  break_and_retest: boolean;
}

export class TrendlineParser implements StrategyParserModule<TrendlineRule> {
  parse(text: string): ParserResult<TrendlineRule> {
    const normalized = text.toLowerCase();
    
    const hasTrendline = /trend\s*line\s*breakout|breakout\s*of\s*trend\s*line|trend\s*line\s*break|broken\s*trend\s*line/i.test(normalized);
    const hasRetest = /break\s*(and|&)\s*retest|break\s*retest|retest\s*of\s*(break|support|resistance)/i.test(normalized);
    
    const supported = hasTrendline || hasRetest;
    let confidence = 0.0;
    
    if (supported) {
      confidence = 0.95;
    }
    
    return {
      supported,
      confidence,
      parsedRule: {
        trendline_breakout: hasTrendline,
        break_and_retest: hasRetest
      }
    };
  }
}
