export interface Detector {
  id: string;
  name: string;
  implemented: boolean;
  version: string;
  confidence: number;
}

export const DETECTOR_REGISTRY: Detector[] = [
  { id: "ema", name: "EMA", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "rsi", name: "RSI", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "macd", name: "MACD", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "atr", name: "ATR", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "bos", name: "BOS", implemented: true, version: "1.0", confidence: 0.9 },
  { id: "choch", name: "CHOCH", implemented: true, version: "1.0", confidence: 0.9 },
  { id: "trendline", name: "Trendline", implemented: true, version: "1.0", confidence: 0.8 },
  { id: "trendline_breakout", name: "Trendline Breakout", implemented: true, version: "1.0", confidence: 0.8 },
  { id: "break_and_retest", name: "Break and Retest", implemented: true, version: "1.0", confidence: 0.8 },
  { id: "retest", name: "Retest", implemented: true, version: "1.0", confidence: 0.7 },
  { id: "support", name: "Support", implemented: true, version: "1.0", confidence: 0.8 },
  { id: "resistance", name: "Resistance", implemented: true, version: "1.0", confidence: 0.8 },
  { id: "support_rejection", name: "Support Rejection", implemented: true, version: "1.0", confidence: 0.85 },
  { id: "resistance_rejection", name: "Resistance Rejection", implemented: true, version: "1.0", confidence: 0.85 },
  { id: "tap_and_rejection", name: "Tap and Rejection", implemented: true, version: "1.0", confidence: 0.95 },
  { id: "confirmation_candle", name: "Confirmation Candle", implemented: true, version: "1.0", confidence: 0.9 },
  { id: "fvg", name: "Fair Value Gap", implemented: true, version: "1.0", confidence: 0.9 },
  { id: "fair_value_gap", name: "Fair Value Gap", implemented: true, version: "1.0", confidence: 0.9 },
  { id: "order_block", name: "Order Block", implemented: true, version: "1.0", confidence: 0.95 },
  { id: "supply_demand", name: "Supply and Demand", implemented: true, version: "1.0", confidence: 0.95 },
  { id: "unmitigated_zone", name: "Unmitigated Zone", implemented: true, version: "1.0", confidence: 0.95 },
  { id: "demand_zone", name: "Demand Zone", implemented: true, version: "1.0", confidence: 0.95 },
  { id: "supply_zone", name: "Supply Zone", implemented: true, version: "1.0", confidence: 0.95 },
  { id: "liquidity_sweep", name: "Liquidity Sweep", implemented: true, version: "1.0", confidence: 0.85 },
  { id: "volume_confirmation", name: "Volume Confirmation", implemented: true, version: "1.0", confidence: 0.75 },
  { id: "session", name: "Session", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "timeframe", name: "Timeframe", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "timeframes", name: "Timeframe", implemented: true, version: "1.0", confidence: 1.0 },
  { id: "risk_reward", name: "Risk Reward", implemented: true, version: "1.0", confidence: 1.0 },
];

export type ExecutionMode = 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY';

export interface ValidationResult {
  coverage: number;
  supported: string[];
  supported_detectors: string[];
  unsupported: string[];
  execution_mode: ExecutionMode;
}

export function validateDetectors(requiredRules: string[]): ValidationResult {
  const supported = requiredRules.filter(rule => 
    DETECTOR_REGISTRY.some(d => d.id === rule.toLowerCase() && d.implemented)
  );
  
  const unsupported = requiredRules.filter(rule => 
    !DETECTOR_REGISTRY.some(d => d.id === rule.toLowerCase() && d.implemented)
  );

  // Include canonical detector aliases (e.g., fair_value_gap <-> fvg) so market structure extraction
  // activates matching detectors cleanly without key mismatch.
  const supportedSet = new Set<string>(supported.map(s => s.toLowerCase()));
  if (supportedSet.has('fair_value_gap')) supportedSet.add('fvg');
  if (supportedSet.has('fvg')) supportedSet.add('fair_value_gap');
  if (supportedSet.has('timeframes')) supportedSet.add('timeframe');
  if (supportedSet.has('break_and_retest')) supportedSet.add('retest');

  const coverage = requiredRules.length > 0 
    ? (supported.length / requiredRules.length) * 100 
    : 100;

  let execution_mode: ExecutionMode = 'RULE_ONLY';
  if (coverage === 100) {
    execution_mode = 'RULE_ONLY';
  } else if (coverage > 0) {
    execution_mode = 'HYBRID';
  } else {
    execution_mode = 'AI_ONLY';
  }

  return {
    coverage,
    supported,
    supported_detectors: Array.from(supportedSet),
    unsupported,
    execution_mode
  };
}
