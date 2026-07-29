import { ParserResult, StrategyParserModule } from './types';

export class ConfirmationCandleParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const normalized = text.toLowerCase();
    
    const hasConfirmationCandle = /confirmation\s*candle|signal\s*candle|trigger\s*candle/i.test(normalized);
    
    return {
      supported: hasConfirmationCandle,
      confidence: hasConfirmationCandle ? 0.95 : 0.0,
      parsedRule: hasConfirmationCandle
    };
  }
}
