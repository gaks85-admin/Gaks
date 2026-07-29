import { ParserResult, StrategyParserModule } from './types';

export interface EmaRule {
  enabled: boolean;
  periods: number[];
}

export class EmaParser implements StrategyParserModule<EmaRule> {
  parse(text: string): ParserResult<EmaRule> {
    const normalized = text.toLowerCase();
    
    // Check if EMA is mentioned
    const hasEma = /\bema\b|exponential\s*moving\s*average/i.test(normalized);
    const periods: number[] = [];
    
    if (hasEma) {
      // Extract numbers associated with EMA
      const matches = text.match(/\b\d+\s*-?\s*period\s*ema|\b\d+\s*ema|ema\s*\d+|ema\s*with\s*period\s*\d+|\b\d+\s*exponential\s*moving/gi);
      if (matches) {
        for (const match of matches) {
          const digits = match.match(/\d+/g);
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
      
      // Fallback: If EMA is mentioned and standard moving average periods (like 8, 9, 20, 21, 50, 100, 200) are in the text
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
    
    return {
      supported: hasEma,
      confidence: hasEma ? 0.95 : 0.0,
      parsedRule: {
        enabled: hasEma,
        periods: periods.sort((a, b) => a - b)
      }
    };
  }
}
