import { ParserResult, StrategyParserModule } from './types';

export class LiquidityParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const normalized = text.toLowerCase();
    
    const hasLiquidity = /liquidity\s*sweep|sweep\s*liquidity|liquidity\s*grab|bsl\s*sweep|ssl\s*sweep/i.test(normalized);
    
    return {
      supported: hasLiquidity,
      confidence: hasLiquidity ? 0.95 : 0.0,
      parsedRule: hasLiquidity
    };
  }
}
