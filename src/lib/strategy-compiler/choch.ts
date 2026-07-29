import { ParserResult, StrategyParserModule } from './types';

export class ChochParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const normalized = text.toLowerCase();
    
    // Match CHoCH or Change of Character
    const hasChoch = /\bchoch\b|change\s*of\s*character/i.test(normalized);
    
    return {
      supported: hasChoch,
      confidence: hasChoch ? 0.98 : 0.0,
      parsedRule: hasChoch
    };
  }
}
