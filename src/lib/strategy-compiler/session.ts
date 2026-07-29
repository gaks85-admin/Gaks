import { ParserResult, StrategyParserModule } from './types.js';
import { sessionSynonyms } from './synonyms/session.js';
import { findSynonymMatch, normalizeText } from './normalizer.js';

export class SessionParser implements StrategyParserModule<string[]> {
  parse(text: string): ParserResult<string[]> {
    const match = findSynonymMatch(text, sessionSynonyms, 'SESSION_FILTER', 0.99);
    
    const normalized = normalizeText(text);
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
    
    const supported = match.matched || sessions.length > 0;
    
    return {
      supported,
      confidence: supported ? 0.99 : 0.0,
      parsedRule: sessions,
      matchedPhrase: match.matched ? match.matchedPhrase : (sessions.length > 0 ? "session" : ""),
      canonicalRule: match.matched ? match.canonicalRule : (sessions.length > 0 ? "SESSION_FILTER" : "")
    };
  }
}
