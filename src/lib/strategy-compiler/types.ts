export interface ParserResult<T = any> {
  supported: boolean;
  confidence: number;
  parsedRule: T;
  matchedPhrase: string;
  canonicalRule: string;
}

export interface CompiledRules {
  trendline_breakout?: boolean;
  break_and_retest?: boolean;
  confirmation_candle?: boolean;
  bos?: boolean;
  choch?: boolean;
  liquidity_sweep?: boolean;
  fair_value_gap?: boolean;
  support?: boolean;
  resistance?: boolean;
  support_rejection?: boolean;
  resistance_rejection?: boolean;
  ema?: {
    enabled: boolean;
    periods: number[];
    type?: string;
  };
  rsi?: {
    enabled: boolean;
    overbought?: number;
    oversold?: number;
  };
  macd?: {
    enabled: boolean;
  };
  atr?: {
    enabled: boolean;
  };
  volume_confirmation?: boolean;
  session?: string[];
  timeframes?: string[];
  risk_reward?: {
    min_ratio?: number;
  };
  subjective_elements?: string[];
  ai_only_elements?: string[];
}

export interface CompilerOutput {
  strategy_mode: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY';
  compiled_rules: CompiledRules;
  confidence: number; // for backward compatibility
  overall_confidence: number;
  module_confidence: {
    [key: string]: number;
  };
  matched_phrases: string[];
  canonical_rules: string[];
  detector_validation?: any;
}

export interface StrategyParserModule<T = any> {
  parse(text: string): ParserResult<T>;
}
