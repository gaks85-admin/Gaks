import { CompiledRules } from '../strategy-compiler/types.js';
import { MarketStructure } from '../market-structure-engine.js';

export interface EvaluationResult {
  matched: boolean;
  score: number; // 0 to 1 ratio or score
  scoreOutOf10?: number; // Continuous 0 to 10 score for the confluence requirement
  reason: string;
  weight?: number;
}

export interface RuleEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult;
}
