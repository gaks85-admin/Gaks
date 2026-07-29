import { ParserResult, StrategyParserModule } from './types';
import { subjectiveSynonyms, aiOnlySynonyms } from './synonyms/classification';
import { normalizeText } from './normalizer';

export interface ClassificationRule {
  subjective_elements: string[];
  ai_only_elements: string[];
}

export class ClassificationParser implements StrategyParserModule<ClassificationRule> {
  parse(text: string): ParserResult<ClassificationRule> {
    const normalized = normalizeText(text);
    
    const subjective_elements: string[] = [];
    const ai_only_elements: string[] = [];
    let matchedPhrase = "";
    let canonicalRule = "";
    
    for (const syn of subjectiveSynonyms) {
      if (normalized.includes(normalizeText(syn))) {
        subjective_elements.push(syn);
        if (!matchedPhrase) {
          matchedPhrase = syn;
          canonicalRule = "SUBJECTIVE_ELEMENT";
        }
      }
    }
    
    for (const syn of aiOnlySynonyms) {
      if (normalized.includes(normalizeText(syn))) {
        ai_only_elements.push(syn);
        if (canonicalRule !== "AI_ONLY_ELEMENT") {
          matchedPhrase = syn;
          canonicalRule = "AI_ONLY_ELEMENT";
        }
      }
    }
    
    const supported = subjective_elements.length > 0 || ai_only_elements.length > 0;
    
    return {
      supported,
      confidence: supported ? 0.95 : 0.0,
      parsedRule: {
        subjective_elements,
        ai_only_elements
      },
      matchedPhrase,
      canonicalRule
    };
  }
}
