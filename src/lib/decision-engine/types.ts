import { CompiledRules } from '../strategy-compiler/types.js';
import { MarketStructure } from '../market-structure-engine.js';

export interface EvaluationResult {
  matched: boolean;
  score: number; // 1 if matched, 0 if failed
  reason: string;
  weight?: number;
}

export interface RuleEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult;
}
