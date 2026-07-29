import { ParserResult, StrategyParserModule } from './types';

export class SessionParser implements StrategyParserModule<string[]> {
  parse(text: string): ParserResult<string[]> {
    const normalized = text.toLowerCase();
    const sessions: string[] = [];
    
    if (normalized.includes('london')) {
      sessions.push('London');
    }
    if (normalized.includes('new york') || normalized.includes('ny session') || normalized.includes('ny killzone') || normalized.includes('nyc')) {
      sessions.push('New York');
    }
    if (normalized.includes('asian') || normalized.includes('tokyo') || normalized.includes('asia')) {
      sessions.push('Asian');
    }
    
    const supported = sessions.length > 0;
    
    return {
      supported,
      confidence: supported ? 0.99 : 0.0,
      parsedRule: sessions
    };
  }
}
