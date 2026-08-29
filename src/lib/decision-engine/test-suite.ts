import { evaluateDecision, DecisionResult } from '../decision-engine.js';
import { CompilerOutput } from '../strategy-compiler/types.js';

export interface DecisionTestCase {
  id: number;
  description: string;
  compiledStrategy: Partial<CompilerOutput>;
  marketStructure: any;
  customWeights?: Record<string, number>;
  expectedScore: number;
  expectedRecommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  expectedRequiresGemini: boolean;
}

export const decisionTestCases: DecisionTestCase[] = [
  // --- 1. Perfect Match (100% PASS) ---
  {
    id: 1,
    description: "Standard breakout, BOS, and Session match perfectly",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        bos: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      bos: true,
      session: "London"
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 2. Simple Rules High/Medium/Low Match ---
  {
    id: 2,
    description: "3 Rules - 2 Matched (75% LIKELY_PASS)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        bos: true,
        confirmation_candle: true
      }
    },
    marketStructure: {
      trendline_breakout: true,
      bos: true,
      confirmation_candle: false
    },
    // Weights: trendline (25) + bos (20) + cc (15) = 60. Matched: 45. 45/60 = 75%.
    expectedScore: 75,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 3,
    description: "3 Rules - 1 Matched (42% FAIL)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        bos: true,
        confirmation_candle: true
      }
    },
    marketStructure: {
      trendline_breakout: true,
      bos: false,
      confirmation_candle: false
    },
    // Weights: trendline (25) matched. Total 60. 25/60 = 42%.
    expectedScore: 42,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 4,
    description: "3 Rules - 0 Matched (0% FAIL)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        bos: true,
        confirmation_candle: true
      }
    },
    marketStructure: {
      trendline_breakout: false,
      bos: false,
      confirmation_candle: false
    },
    expectedScore: 0,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 3. Large Rule Set Scenarios (10 Rules) ---
  {
    id: 5,
    description: "10 Rules - 9 Matched (91% PASS)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        ema: { enabled: true, periods: [50, 200] },
        rsi: { enabled: true, overbought: 70, oversold: 30 },
        macd: { enabled: true },
        atr: { enabled: true },
        volume_confirmation: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      trend: "BULLISH", // triggers EMA
      rsi: 25, // oversold triggers RSI
      macd_crossover: true,
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail this one (session weight is 10)
    },
    // Total possible weight: 25+20+20+15+5+4+4+6+8+10 = 117
    // Matched weight: 117 - 10 = 107. 107/117 = 91.45% -> 91%
    expectedScore: 91,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 6,
    description: "10 Rules - 8 Matched (87% LIKELY_PASS)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        ema: { enabled: true, periods: [50, 200] },
        rsi: { enabled: true, overbought: 70, oversold: 30 },
        macd: { enabled: true },
        atr: { enabled: true },
        volume_confirmation: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      trend: "SIDEWAYS", // Fail EMA (5)
      rsi: 25, // oversold (4)
      macd_crossover: true,
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail Session (10)
    },
    // Total: 117. Failed: ema (5) + session (10) = 15. Matched: 102. 102/117 = 87.18% -> 87%
    expectedScore: 87,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 7,
    description: "10 Rules - 7 Matched (84% LIKELY_PASS)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        ema: { enabled: true, periods: [50, 200] },
        rsi: { enabled: true, overbought: 70, oversold: 30 },
        macd: { enabled: true },
        atr: { enabled: true },
        volume_confirmation: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      trend: "SIDEWAYS", // Fail EMA (5)
      rsi: 50, // Fail RSI (4)
      macd_crossover: true,
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail Session (10)
    },
    // Total: 117. Failed: ema (5) + rsi (4) + session (10) = 19. Matched: 98. 98/117 = 83.76% -> 84%
    expectedScore: 84,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 8,
    description: "10 Rules - 6 Matched (80% LIKELY_PASS)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        ema: { enabled: true, periods: [50, 200] },
        rsi: { enabled: true, overbought: 70, oversold: 30 },
        macd: { enabled: true },
        atr: { enabled: true },
        volume_confirmation: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      trend: "SIDEWAYS", // Fail EMA (5)
      rsi: 50, // Fail RSI (4)
      macd_crossover: false, // Fail MACD (4)
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail Session (10)
    },
    // Total: 117. Failed: ema (5) + rsi (4) + macd (4) + session (10) = 23. Matched: 94. 94/117 = 80.34% -> 80%
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 9,
    description: "10 Rules - 5 Matched (75% LIKELY_PASS)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        ema: { enabled: true, periods: [50, 200] },
        rsi: { enabled: true, overbought: 70, oversold: 30 },
        macd: { enabled: true },
        atr: { enabled: true },
        volume_confirmation: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      trend: "SIDEWAYS", // Fail EMA (5)
      rsi: 50, // Fail RSI (4)
      macd_crossover: false, // Fail MACD (4)
      atr: false, // Fail ATR (6)
      volume_confirmation: true,
      session: "New York" // Fail Session (10)
    },
    // Total: 117. Failed: 29. Matched: 88. 88/117 = 75.21% -> 75%
    expectedScore: 75,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 4. Five-Rule Scenarios (All fail because of mandatory rules check missing Trendline/BOS/CHOCH) ---
  {
    id: 10,
    description: "5 Rules - 5 Matched but 100% FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        liquidity_sweep: true,
        fair_value_gap: true,
        confirmation_candle: true,
        support: true,
        resistance: true
      }
    },
    marketStructure: {
      liquidity_sweep: true,
      fair_value_gap: true,
      confirmation_candle: true,
      support: true,
      resistance: true
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 11,
    description: "5 Rules - 4 Matched but 84% FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        liquidity_sweep: true,
        fair_value_gap: true,
        confirmation_candle: true,
        support: true,
        resistance: true
      }
    },
    marketStructure: {
      liquidity_sweep: true,
      fair_value_gap: true,
      confirmation_candle: true,
      support: true,
      resistance: false
    },
    // Weights: ls(15) + fvg(12) + cc(15) + sup(10) + res(10) = 62. Matched: 52. 52/62 = 83.87% -> 84%
    expectedScore: 84,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 12,
    description: "5 Rules - 3 Matched but 68% FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        liquidity_sweep: true,
        fair_value_gap: true,
        confirmation_candle: true,
        support: true,
        resistance: true
      }
    },
    marketStructure: {
      liquidity_sweep: true,
      fair_value_gap: true,
      confirmation_candle: true,
      support: false,
      resistance: false
    },
    // Weights: ls(15) + fvg(12) + cc(15) = 42. 42/62 = 67.74% -> 68%
    expectedScore: 68,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 13,
    description: "5 Rules - 2 Matched but 44% FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        liquidity_sweep: true,
        fair_value_gap: true,
        confirmation_candle: true,
        support: true,
        resistance: true
      }
    },
    marketStructure: {
      liquidity_sweep: true,
      fair_value_gap: true,
      confirmation_candle: false,
      support: false,
      resistance: false
    },
    // Weights: ls(15) + fvg(12) = 27. 27/62 = 43.54% -> 44%
    expectedScore: 44,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 5. Support & Resistance Rejections ---
  {
    id: 14,
    description: "Support Zones and Rejections Matched but FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        support: true,
        support_rejection: true
      }
    },
    marketStructure: {
      support: true,
      support_rejection: true
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 15,
    description: "Resistance Zones Matched but Rejection Failed -> FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        resistance: true,
        resistance_rejection: true
      }
    },
    marketStructure: {
      resistance: true,
      resistance_rejection: false
    },
    expectedScore: 50,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 6. RSI Overbought / Oversold / Neutral ---
  {
    id: 16,
    description: "RSI Overbought Matched but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        rsi: { enabled: true, overbought: 70, oversold: 30 }
      }
    },
    marketStructure: {
      rsi: 78
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 17,
    description: "RSI Oversold Matched but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        rsi: { enabled: true, overbought: 70, oversold: 30 }
      }
    },
    marketStructure: {
      rsi: 15
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 18,
    description: "RSI Neutral Zone (Failure) -> FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        rsi: { enabled: true, overbought: 70, oversold: 30 }
      }
    },
    marketStructure: {
      rsi: 55
    },
    expectedScore: 0,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 7. Session Evaluation Variations ---
  {
    id: 19,
    description: "London active during London Session but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        session: ["London"]
      }
    },
    marketStructure: {
      session: "London"
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 20,
    description: "London active during New York Session (Failure) -> FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        session: ["London"]
      }
    },
    marketStructure: {
      session: "New York"
    },
    expectedScore: 0,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 21,
    description: "Multi-session match (London, NY) on NY market but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        session: ["London", "NY"]
      }
    },
    marketStructure: {
      session: "NY"
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 8. Timeframe Filter Variations ---
  {
    id: 22,
    description: "Single timeframe M5 match but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        timeframes: ["M5"]
      }
    },
    marketStructure: {
      timeframe: "M5"
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 23,
    description: "Multi-timeframe H1/M15 match on H1 market but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        timeframes: ["H1", "M15"]
      }
    },
    marketStructure: {
      timeframe: "H1"
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 24,
    description: "Timeframe mismatch -> FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        timeframes: ["M5"]
      }
    },
    marketStructure: {
      timeframe: "H1"
    },
    expectedScore: 0,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 9. Risk Reward Evaluator Variations ---
  {
    id: 25,
    description: "Risk Reward matched but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        risk_reward: { min_ratio: 2 }
      }
    },
    marketStructure: {
      risk_reward_ratio: 2.5
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 26,
    description: "Risk Reward failed -> FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        risk_reward: { min_ratio: 3 }
      }
    },
    marketStructure: {
      risk_reward_ratio: 2.0
    },
    expectedScore: 0,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 10. Empty Rule Set Edge Case (Bypasses structural rule check because 0 rules) ---
  {
    id: 27,
    description: "No active rules in strategy",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {}
    },
    marketStructure: {},
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 11. Hybrid and AI_ONLY Strategy Overrides ---
  {
    id: 28,
    description: "HYBRID mode, 100% score (Requires Gemini overridden)",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        bos: true,
        subjective_elements: ["beautiful rejection"]
      }
    },
    marketStructure: {
      bos: true
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: true
  },
  {
    id: 29,
    description: "HYBRID mode, 83% score (Requires Gemini true naturally)",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        bos: true,
        choch: true,
        confirmation_candle: true,
        volume_confirmation: true,
        fair_value_gap: true,
        subjective_elements: ["beautiful breakout"]
      }
    },
    marketStructure: {
      bos: true,
      choch: true,
      confirmation_candle: true,
      volume_confirmation: true,
      fair_value_gap: false
    },
    // Total weight: bos(20) + choch(15) + cc(15) + vol(8) + fvg(12) = 70.
    // Matched: 58. 58/70 = 82.85% -> 83%
    expectedScore: 83,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 30,
    description: "HYBRID mode, 50% score (No Gemini required because hard FAIL)",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        bos: true,
        choch: true,
        confirmation_candle: true,
        volume_confirmation: true,
        fair_value_gap: true,
        subjective_elements: ["gut feelings"]
      }
    },
    marketStructure: {
      bos: true,
      choch: true,
      confirmation_candle: false,
      volume_confirmation: false,
      fair_value_gap: false
    },
    // Total: 70. Matched: bos(20) + choch(15) = 35. 35/70 = 50%
    expectedScore: 50,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 31,
    description: "AI_ONLY mode, 0 rules (Requires Gemini overridden, bypasses structure check)",
    compiledStrategy: {
      strategy_mode: 'AI_ONLY',
      compiled_rules: {
        ai_only_elements: ["ICT core concepts"]
      }
    },
    marketStructure: {},
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: true
  },

  // --- 12. Nested Complex Market Structure Checking ---
  {
    id: 32,
    description: "Nested breakouts matches trendline breakout rule",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true
      }
    },
    marketStructure: {
      breakouts: [
        { type: "UPPER_BREAKOUT", candleIndex: 12, price: 1.1200 }
      ]
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 33,
    description: "Nested BOS list matches bos rule",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        bos: true
      }
    },
    marketStructure: {
      BOS: [
        { type: "BULLISH_BOS", price: 1.0500, candleIndex: 44 }
      ]
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 34,
    description: "Nested CHOCH list matches choch rule",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        choch: true
      }
    },
    marketStructure: {
      CHOCH: [
        { type: "BEARISH_CHOCH", price: 1.0900, candleIndex: 22 }
      ]
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 35,
    description: "Nested volume spike matches volume rule but FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        volume_confirmation: true
      }
    },
    marketStructure: {
      volumeInformation: {
        averageVolume: 1000,
        latestVolume: 2000,
        volumeSpike: true
      }
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 36,
    description: "Nested candle patterns matches confirmation candle rule but FAIL (No structural confirmation)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        confirmation_candle: true
      }
    },
    marketStructure: {
      candlePatterns: [
        { pattern: "Hammer", candleIndex: 5, direction: "BULLISH" }
      ]
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 13. Subjective elements checks ---
  {
    id: 37,
    description: "Subjective elements present, RULE score 100 -> requires gemini true",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        bos: true,
        subjective_elements: ["beautiful structure"]
      }
    },
    marketStructure: {
      bos: true
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: true
  },
  {
    id: 38,
    description: "Subjective elements present, RULE score 57 -> hard FAIL, requires gemini false",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        bos: true,
        choch: true,
        subjective_elements: ["beautiful structure"]
      }
    },
    marketStructure: {
      bos: true,
      choch: false
    },
    // Total: bos(20) + choch(15) = 35. Matched: 20. 20/35 = 57% -> FAIL.
    expectedScore: 57,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 14. Nested retests matches retest rule ---
  {
    id: 39,
    description: "Nested retests matches break and retest rule but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        break_and_retest: true
      }
    },
    marketStructure: {
      retests: [
        { confirmed: true, level: 1.1020, candleIndex: 25 }
      ]
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 15. Nested FVG matches FVG rule ---
  {
    id: 40,
    description: "Nested FVG matches fair value gap rule but FAIL (No structure)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        fair_value_gap: true
      }
    },
    marketStructure: {
      fairValueGaps: [
        { type: "BULLISH_FVG", top: 1.1250, bottom: 1.1230, candleIndex: 11 }
      ]
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // ==================== NEW WEIGHTED SCORING TESTS (41-60) ====================

  // --- 16. Weighted Boundaries (PASS) ---
  {
    id: 41,
    description: "6 Rules - exact 90% PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      confirmation_candle: true,
      session: "New York" // Fail session (weight 10)
    },
    // Total: trendline(25) + retest(20) + bos(20) + choch(15) + cc(15) + session(10) = 105.
    // Matched: 105 - 10 = 95. 95/105 = 90.47% -> 90%
    expectedScore: 90,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 17. Weighted Boundaries (LIKELY_PASS top limit) ---
  {
    id: 42,
    description: "2 Rules - exact 89% LIKELY_PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        risk_reward: { min_ratio: 3 }
      }
    },
    marketStructure: {
      trendline_breakout: true,
      risk_reward_ratio: 1.5 // Fail RR (weight 3)
    },
    // Total: trendline(25) + risk_reward(3) = 28. Matched: 25. 25/28 = 89.28% -> 89%
    expectedScore: 89,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 18. Weighted Boundaries (LIKELY_PASS bottom limit) ---
  {
    id: 43,
    description: "2 Rules - exact 80% LIKELY_PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        bos: true,
        ema: { enabled: true, periods: [20] }
      }
    },
    marketStructure: {
      bos: true,
      trend: "SIDEWAYS" // Fail EMA (weight 5)
    },
    // Total: bos(20) + ema(5) = 25. Matched: 20. 20/25 = 80%
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 19. Weighted Boundaries (LIKELY_PASS 79% boundary) ---
  {
    id: 44,
    description: "2 Rules - exact 79% LIKELY_PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        choch: true,
        macd: { enabled: true }
      }
    },
    marketStructure: {
      choch: true,
      macd_crossover: false // Fail MACD (weight 4)
    },
    // Total: choch(15) + macd(4) = 19. Matched: 15. 15/19 = 78.94% -> 79%
    expectedScore: 79,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 20. Weighted Boundaries (AMBIGUOUS bottom limit) ---
  {
    id: 45,
    description: "2 Rules - exact 60% AMBIGUOUS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        choch: true,
        support: true
      }
    },
    marketStructure: {
      choch: true,
      support: false // Fail Support (weight 10)
    },
    // Total: choch(15) + support(10) = 25. Matched: 15. 15/25 = 60%
    expectedScore: 60,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },

  // --- 21. Weighted Boundaries (FAIL top limit) ---
  {
    id: 46,
    description: "6 Rules - exact 59% FAIL boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        choch: true,
        volume_confirmation: true,
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        risk_reward: { min_ratio: 2 }
      }
    },
    marketStructure: {
      choch: true,
      volume_confirmation: true,
      trend: "SIDEWAYS", // Fail EMA (5)
      macd_crossover: false, // Fail MACD (4)
      rsi: 50, // Fail RSI (4)
      risk_reward_ratio: 1.0 // Fail RR (3)
    },
    // Total: choch(15) + vol(8) + ema(5) + macd(4) + rsi(4) + rr(3) = 39.
    // Matched: choch(15) + vol(8) = 23. 23/39 = 58.97% -> 59%
    expectedScore: 59,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 22. Mandatory Rule Failures ---
  {
    id: 47,
    description: "No mandatory rules compiled in strategy -> Immediate FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        fair_value_gap: true,
        volume_confirmation: true,
        session: ["London"]
      },
      mandatory_rules: []
    },
    marketStructure: {
      fair_value_gap: true,
      volume_confirmation: true,
      session: "London"
    },
    expectedScore: 100,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 48,
    description: "Mandatory rule bos active but failed -> Immediate FAIL",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        bos: true,
        session: ["London"],
        timeframes: ["M5"]
      }
    },
    marketStructure: {
      bos: false,
      session: "London",
      timeframe: "M5"
    },
    // Total: bos(20) + session(10) + tf(8) = 38. Matched: 18. 18/38 = 47%
    expectedScore: 47,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 23. Multiple Mandatory Rules (At least one passes) ---
  {
    id: 49,
    description: "Multiple mandatory rules active, one passes -> Passes mandatory check",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        bos: true,
        trendline_breakout: true,
        confirmation_candle: true,
        break_and_retest: true
      }
    },
    marketStructure: {
      bos: true,
      trendline_breakout: false, // failed
      confirmation_candle: true,
      break_and_retest: true
    },
    // Total: bos(20) + trendline(25) + cc(15) + retest(20) = 80.
    // Matched: bos(20) + cc(15) + retest(20) = 55. 55/80 = 68.75% -> 69%
    expectedScore: 69,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },

  // --- 24. Heavy Weight Rule Set (Perfect PASS) ---
  {
    id: 50,
    description: "All 19 rules active and matched perfectly",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: true,
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: true,
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 2.5,
      trend: "BULLISH", // EMA
      macd_crossover: true,
      rsi: 20, // oversold
      atr: true
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 25. Large Weighted Boundaries (PASS) ---
  {
    id: 51,
    description: "All 19 rules active - exact 90% PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: true,
      bos: true,
      choch: false, // Fail choch (15)
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: true,
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 2.5,
      trend: "BULLISH",
      macd_crossover: true,
      rsi: 20,
      atr: false // Fail atr (6)
    },
    // Total possible weight of 19 rules = 210. Failed: choch(15) + atr(6) = 21.
    // Matched: 189. 189/210 = 90%
    expectedScore: 90,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 26. Large Weighted Boundaries (LIKELY_PASS top limit) ---
  {
    id: 52,
    description: "All 19 rules active - exact 89% LIKELY_PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: false, // Fail break_and_retest (20)
      bos: true,
      choch: true,
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: true,
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 1.0, // Fail rr (3)
      trend: "BULLISH",
      macd_crossover: true,
      rsi: 20,
      atr: true
    },
    // Total: 210. Failed: retest(20) + rr(3) = 23. Matched: 187. 187/210 = 89.04% -> 89%
    expectedScore: 89,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 27. Large Weighted Boundaries (LIKELY_PASS bottom limit) ---
  {
    id: 53,
    description: "All 19 rules active - exact 80% LIKELY_PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: false, // Fail trendline_breakout (25)
      break_and_retest: true,
      bos: true,
      choch: true,
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: false, // Fail fvg (12)
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 2.5,
      trend: "SIDEWAYS", // Fail ema (5)
      macd_crossover: true,
      rsi: 20,
      atr: true
    },
    // Total: 210. Failed: trendline(25) + fvg(12) + ema(5) = 42. Matched: 168. 168/210 = 80%
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 28. Large Weighted Boundaries (LIKELY_PASS 79% boundary) ---
  {
    id: 54,
    description: "All 19 rules active - exact 79% LIKELY_PASS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: true,
      break_and_retest: false, // Fail retest (20)
      bos: false, // Fail bos (20)
      choch: true,
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: true,
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 2.5,
      trend: "BULLISH",
      macd_crossover: false, // Fail macd (4)
      rsi: 20,
      atr: true
    },
    // Total: 210. Failed: retest(20) + bos(20) + macd(4) = 44. Matched: 166. 166/210 = 79.04% -> 79%
    expectedScore: 79,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 29. Large Weighted Boundaries (AMBIGUOUS bottom limit) ---
  {
    id: 55,
    description: "All 19 rules active - exact 60% AMBIGUOUS boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: false, // Fail trendline (25)
      break_and_retest: false, // Fail retest (20)
      bos: false, // Fail bos (20)
      choch: true, // Matched mandatory
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: false, // Fail fvg (12)
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 1.0, // Fail rr (3)
      trend: "BULLISH",
      macd_crossover: true,
      rsi: 50, // Fail rsi (4)
      atr: true
    },
    // Total: 210. Failed: trendline(25)+retest(20)+bos(20)+fvg(12)+rr(3)+rsi(4) = 84. Matched: 126. 126/210 = 60%
    expectedScore: 60,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },

  // --- 30. Large Weighted Boundaries (FAIL top limit) ---
  {
    id: 56,
    description: "All 19 rules active - exact 59% FAIL boundary",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        break_and_retest: true,
        bos: true,
        choch: true,
        confirmation_candle: true,
        liquidity_sweep: true,
        fair_value_gap: true,
        support: true,
        support_rejection: true,
        resistance: true,
        resistance_rejection: true,
        volume_confirmation: true,
        session: ["London"],
        timeframes: ["M5"],
        risk_reward: { min_ratio: 2 },
        ema: { enabled: true, periods: [50] },
        macd: { enabled: true },
        rsi: { enabled: true },
        atr: { enabled: true }
      }
    },
    marketStructure: {
      trendline_breakout: false, // Fail trendline (25)
      break_and_retest: false, // Fail retest (20)
      bos: false, // Fail bos (20)
      choch: true, // Matched mandatory
      confirmation_candle: true,
      liquidity_sweep: true,
      fair_value_gap: false, // Fail fvg (12)
      support: true,
      support_rejection: true,
      resistance: true,
      resistance_rejection: true,
      volume_confirmation: true,
      session: "London",
      timeframe: "M5",
      risk_reward_ratio: 2.5,
      trend: "SIDEWAYS", // Fail ema (5)
      macd_crossover: true,
      rsi: 50, // Fail rsi (4)
      atr: true
    },
    // Total: 210. Failed: trendline(25)+retest(20)+bos(20)+fvg(12)+ema(5)+rsi(4) = 86. Matched: 124. 124/210 = 59.04% -> 59%
    expectedScore: 59,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 31. Custom Central Weights (Editable) ---
  {
    id: 57,
    description: "Custom weights - extreme structure weights (50% FAIL)",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        trendline_breakout: true,
        session: ["London"]
      }
    },
    marketStructure: {
      trendline_breakout: true,
      session: "New York" // Fail session
    },
    customWeights: {
      trendline_breakout: 50,
      session: 50
    },
    // Total: 100. Matched: 50. 50/100 = 50%
    expectedScore: 50,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 58,
    description: "Custom weights - custom weighted LIKELY_PASS",
    compiledStrategy: {
      strategy_mode: 'RULE_ONLY',
      compiled_rules: {
        bos: true,
        session: ["London"]
      }
    },
    marketStructure: {
      bos: true,
      session: "New York" // Fail session
    },
    customWeights: {
      bos: 80,
      session: 20
    },
    // Total: 100. Matched: 80. 80/100 = 80%
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },

  // --- 32. Hybrid Mode score overrides with mandatory rules ---
  {
    id: 59,
    description: "HYBRID mode, 100% score with custom subjective override",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        trendline_breakout: true,
        subjective_elements: ["gut check"]
      }
    },
    marketStructure: {
      trendline_breakout: true
    },
    expectedScore: 100,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: true
  },
  {
    id: 60,
    description: "HYBRID mode, 0% score is hard FAIL even if Hybrid",
    compiledStrategy: {
      strategy_mode: 'HYBRID',
      compiled_rules: {
        trendline_breakout: true,
        subjective_elements: ["gut check"]
      }
    },
    marketStructure: {
      trendline_breakout: false
    },
    expectedScore: 0,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  }
];

export function runDecisionTestSuite(): { passed: boolean; averageTimeMs: number } {
  console.log("=== RUNNING WEIGHTED DECISION ENGINE TEST SUITE ===");
  console.log(`Total test cases loaded: ${decisionTestCases.length}`);

  let passedCount = 0;
  const startPerformance = typeof performance !== 'undefined' ? performance.now() : Date.now();

  for (const tc of decisionTestCases) {
    const result = evaluateDecision(
      tc.compiledStrategy as CompilerOutput,
      tc.marketStructure,
      tc.customWeights
    );

    const scoreMatches = result.decision_score === tc.expectedScore;
    const recMatches = result.recommendation === tc.expectedRecommendation;
    const gemMatches = result.requires_gemini === tc.expectedRequiresGemini;

    if (scoreMatches && recMatches && gemMatches) {
      passedCount++;
    } else {
      console.error(`❌ Test Case #${tc.id} Failed: "${tc.description}"`);
      console.error(`   Expected: Score ${tc.expectedScore}%, Recommendation ${tc.expectedRecommendation}, Gemini Required ${tc.expectedRequiresGemini ? 'YES' : 'NO'}`);
      console.error(`   Got:      Score ${result.decision_score}%, Recommendation ${result.recommendation}, Gemini Required ${result.requires_gemini ? 'YES' : 'NO'}`);
      console.error(`   Matched Rules: ${result.matched_rules.join(', ') || 'None'}`);
      console.error(`   Failed Rules:  ${result.failed_rules.join(', ') || 'None'}`);
    }
  }

  const endPerformance = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const totalDuration = endPerformance - startPerformance;
  const averageTimeMs = totalDuration / decisionTestCases.length;

  const allPassed = passedCount === decisionTestCases.length;

  console.log(`\n=== PERFORMANCE REPORT ===`);
  console.log(`Passed: ${passedCount} / ${decisionTestCases.length}`);
  console.log(`Total Time: ${totalDuration.toFixed(4)} ms`);
  console.log(`Average Time per Strategy: ${averageTimeMs.toFixed(4)} ms`);
  console.log(`Status: ${allPassed ? "SUCCESS" : "FAILED"}`);
  console.log("===========================");

  return {
    passed: allPassed,
    averageTimeMs
  };
}
