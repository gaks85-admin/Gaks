import { ParserResult, StrategyParserModule } from './types';

export interface RsiRule {
  enabled: boolean;
  overbought?: number;
  oversold?: number;
}

export class RsiParser implements StrategyParserModule<RsiRule> {
  parse(text: string): ParserResult<RsiRule> {
    const normalized = text.toLowerCase();
    
    const hasRsi = /\brsi\b|relative\s*strength\s*index/i.test(normalized);
    let overbought: number | undefined;
    let oversold: number | undefined;
    
    if (hasRsi) {
      // Extract overbought levels
      const obMatch = normalized.match(/overbought\s*(?:at\s*|level\s*|is\s*|above\s*)?(\d+)|(\d+)\s*overbought|above\s*(\d+)/i);
      if (obMatch) {
        const val = parseInt(obMatch[1] || obMatch[2] || obMatch[3], 10);
        if (val >= 50 && val <= 95) {
          overbought = val;
        }
      }
      
      // Extract oversold levels
      const osMatch = normalized.match(/oversold\s*(?:at\s*|level\s*|is\s*|below\s*)?(\d+)|(\d+)\s*oversold|below\s*(\d+)/i);
      if (osMatch) {
        const val = parseInt(osMatch[1] || osMatch[2] || osMatch[3], 10);
        if (val >= 5 && val <= 50) {
          oversold = val;
        }
      }
      
      // Fallback defaults if general words are used without numbers
      if (!overbought && /overbought/i.test(normalized)) overbought = 70;
      if (!oversold && /oversold/i.test(normalized)) oversold = 30;
    }
    
    return {
      supported: hasRsi,
      confidence: hasRsi ? 0.96 : 0.0,
      parsedRule: {
        enabled: hasRsi,
        overbought,
        oversold
      }
    };
  }
}
