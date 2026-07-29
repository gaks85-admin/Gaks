import { ParserResult, StrategyParserModule } from './types';

export interface AtrRule {
  enabled: boolean;
}

export class AtrParser implements StrategyParserModule<AtrRule> {
  parse(text: string): ParserResult<AtrRule> {
    const normalized = text.toLowerCase();
    
    const hasAtr = /\batr\b|average\s*true\s*range/i.test(normalized);
    
    return {
      supported: hasAtr,
      confidence: hasAtr ? 0.98 : 0.0,
      parsedRule: {
        enabled: hasAtr
      }
    };
  }
}
