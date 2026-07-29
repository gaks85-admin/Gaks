import { CompiledRules } from '../strategy-compiler/types';
import { MarketStructure } from '../market-structure-engine';

export interface EvaluationResult {
  matched: boolean;
  score: number; // 1 if matched, 0 if failed
  reason: string;
}

export interface RuleEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult;
}
