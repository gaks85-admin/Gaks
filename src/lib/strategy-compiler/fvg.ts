import { ParserResult, StrategyParserModule } from './types';

export class FvgParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const normalized = text.toLowerCase();
    
    const hasFvg = /\bfvg\b|fair\s*value\s*gap|\bimbalance\b/i.test(normalized);
    
    return {
      supported: hasFvg,
      confidence: hasFvg ? 0.98 : 0.0,
      parsedRule: hasFvg
    };
  }
}
