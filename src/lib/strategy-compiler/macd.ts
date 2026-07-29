import { ParserResult, StrategyParserModule } from './types';

export interface MacdRule {
  enabled: boolean;
}

export class MacdParser implements StrategyParserModule<MacdRule> {
  parse(text: string): ParserResult<MacdRule> {
    const normalized = text.toLowerCase();
    
    const hasMacd = /\bmacd\b|moving\s*average\s*convergence/i.test(normalized);
    
    return {
      supported: hasMacd,
      confidence: hasMacd ? 0.98 : 0.0,
      parsedRule: {
        enabled: hasMacd
      }
    };
  }
}
