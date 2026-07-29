import { ParserResult, StrategyParserModule } from './types';

export interface ClassificationRule {
  subjective_elements: string[];
  ai_only_elements: string[];
}

export class ClassificationParser implements StrategyParserModule<ClassificationRule> {
  parse(text: string): ParserResult<ClassificationRule> {
    const normalized = text.toLowerCase();
    
    // Define patterns for subjective keywords (HYBRID indicators)
    const subjectivePatterns = [
      { pattern: /strong\s*rejection/i, label: 'Strong rejection' },
      { pattern: /high\s*probability/i, label: 'High probability' },
      { pattern: /clean\s*breakout/i, label: 'Clean breakout' },
      { pattern: /strong\s*momentum/i, label: 'Strong momentum' },
      { pattern: /good\s*structure/i, label: 'Good structure' },
      { pattern: /beautiful\s*break|nice\s*break/i, label: 'Aesthetic/vague structure' },
      { pattern: /rejection\s*candle/i, label: 'Rejection candle' }
    ];
    
    // Define patterns for non-deterministic keywords (AI_ONLY indicators)
    const aiOnlyPatterns = [
      { pattern: /ict\s*concepts\s*as\s*i\s*define\s*them/i, label: 'ICT concepts as user defines them' },
      { pattern: /trade\s*what\s*feels\s*exhausted|market\s*feels\s*exhausted/i, label: 'Trade what feels exhausted' },
      { pattern: /read\s*market\s*context|market\s*context/i, label: 'Read market context' },
      { pattern: /personal\s*discretion|my\s*discretion|discretionary/i, label: 'Personal discretion' },
      { pattern: /gut\s*feeling|intuition|feel\s*exhausted|feels\s*right/i, label: 'Emotional / Gut feeling' }
    ];
    
    const subjective_elements: string[] = [];
    const ai_only_elements: string[] = [];
    
    for (const item of subjectivePatterns) {
      if (item.pattern.test(normalized)) {
        subjective_elements.push(item.label);
      }
    }
    
    for (const item of aiOnlyPatterns) {
      if (item.pattern.test(normalized)) {
        ai_only_elements.push(item.label);
      }
    }
    
    const supported = subjective_elements.length > 0 || ai_only_elements.length > 0;
    
    return {
      supported,
      confidence: supported ? 0.95 : 0.0,
      parsedRule: {
        subjective_elements,
        ai_only_elements
      }
    };
  }
}
