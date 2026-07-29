import { ParserResult, StrategyParserModule } from './types';

export class BosParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const normalized = text.toLowerCase();
    
    // Match BOS or Break of Structure
    const hasBos = /\bbos\b|break\s*of\s*structure/i.test(normalized);
    
    return {
      supported: hasBos,
      confidence: hasBos ? 0.98 : 0.0,
      parsedRule: hasBos
    };
  }
}
