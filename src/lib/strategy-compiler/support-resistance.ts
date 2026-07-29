import { ParserResult, StrategyParserModule } from './types';

export interface SupportResistanceRule {
  support: boolean;
  resistance: boolean;
}

export class SupportResistanceParser implements StrategyParserModule<SupportResistanceRule> {
  parse(text: string): ParserResult<SupportResistanceRule> {
    const normalized = text.toLowerCase();
    
    const hasSupport = /\bsupport\b|\bkey\s*support\b|s\/r/i.test(normalized);
    const hasResistance = /\bresistance\b|\bkey\s*resistance\b|s\/r/i.test(normalized);
    
    return {
      supported: hasSupport || hasResistance,
      confidence: (hasSupport || hasResistance) ? 0.95 : 0.0,
      parsedRule: {
        support: hasSupport,
        resistance: hasResistance
      }
    };
  }
}
