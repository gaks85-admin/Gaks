import { ParserResult, StrategyParserModule } from './types';

export class VolumeParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const normalized = text.toLowerCase();
    
    const hasVolume = /volume\s*confirmation|volume\s*breakout|high\s*volume|volume\s*confirm|increasing\s*volume/i.test(normalized);
    
    return {
      supported: hasVolume,
      confidence: hasVolume ? 0.95 : 0.0,
      parsedRule: hasVolume
    };
  }
}
