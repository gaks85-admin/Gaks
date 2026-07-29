import { evaluateDecision, DecisionResult } from '../decision-engine';
import { CompilerOutput } from '../strategy-compiler/types';

export interface DecisionTestCase {
  id: number;
  description: string;
  compiledStrategy: Partial<CompilerOutput>;
  marketStructure: any;
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
    description: "3 Rules - 2 Matched (67% AMBIGUOUS)",
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
    expectedScore: 67,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },
  {
    id: 3,
    description: "3 Rules - 1 Matched (33% FAIL)",
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
    expectedScore: 33,
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
    description: "10 Rules - 9 Matched (90% PASS)",
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
      session: "New York" // Fail this one
    },
    expectedScore: 90,
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 6,
    description: "10 Rules - 8 Matched (80% LIKELY_PASS)",
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
      trend: "SIDEWAYS", // Fail EMA
      rsi: 25, // oversold
      macd_crossover: true,
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail Session
    },
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 7,
    description: "10 Rules - 7 Matched (70% AMBIGUOUS)",
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
      trend: "SIDEWAYS", // Fail EMA
      rsi: 50, // Fail RSI
      macd_crossover: true,
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail Session
    },
    expectedScore: 70,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },
  {
    id: 8,
    description: "10 Rules - 6 Matched (60% AMBIGUOUS)",
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
      trend: "SIDEWAYS", // Fail EMA
      rsi: 50, // Fail RSI
      macd_crossover: false, // Fail MACD
      atr: true,
      volume_confirmation: true,
      session: "New York" // Fail Session
    },
    expectedScore: 60,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },
  {
    id: 9,
    description: "10 Rules - 5 Matched (50% FAIL)",
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
      trend: "SIDEWAYS", // Fail EMA
      rsi: 50, // Fail RSI
      macd_crossover: false, // Fail MACD
      atr: false, // Fail ATR
      volume_confirmation: true,
      session: "New York" // Fail Session
    },
    expectedScore: 50,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 4. Five-Rule Scenarios ---
  {
    id: 10,
    description: "5 Rules - 5 Matched (100% PASS)",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 11,
    description: "5 Rules - 4 Matched (80% LIKELY_PASS)",
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
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 12,
    description: "5 Rules - 3 Matched (60% AMBIGUOUS)",
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
    expectedScore: 60,
    expectedRecommendation: 'AMBIGUOUS',
    expectedRequiresGemini: true
  },
  {
    id: 13,
    description: "5 Rules - 2 Matched (40% FAIL)",
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
    expectedScore: 40,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 5. Support & Resistance Rejections ---
  {
    id: 14,
    description: "Support Zones and Rejections Matched",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 15,
    description: "Resistance Zones Matched but Rejection Failed",
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
    description: "RSI Overbought Matched",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 17,
    description: "RSI Oversold Matched",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 18,
    description: "RSI Neutral Zone (Failure)",
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
    description: "London active during London Session",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 20,
    description: "London active during New York Session (Failure)",
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
    description: "Multi-session match (London, NY) on NY market",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 8. Timeframe Filter Variations ---
  {
    id: 22,
    description: "Single timeframe M5 match",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 23,
    description: "Multi-timeframe H1/M15 match on H1 market",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 24,
    description: "Timeframe mismatch",
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
    description: "Risk Reward matched",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 26,
    description: "Risk Reward failed",
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

  // --- 10. Empty Rule Set Edge Case ---
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
    description: "HYBRID mode, 80% score (Requires Gemini true naturally)",
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
    expectedScore: 80,
    expectedRecommendation: 'LIKELY_PASS',
    expectedRequiresGemini: true
  },
  {
    id: 30,
    description: "HYBRID mode, 40% score (No Gemini required because hard FAIL)",
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
    expectedScore: 40,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },
  {
    id: 31,
    description: "AI_ONLY mode, 0 rules (Requires Gemini overridden)",
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
    description: "Nested volume spike matches volume rule",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },
  {
    id: 36,
    description: "Nested candle patterns matches confirmation candle rule",
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
    expectedRecommendation: 'PASS',
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
    description: "Subjective elements present, RULE score 50 -> hard FAIL, requires gemini false",
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
    expectedScore: 50,
    expectedRecommendation: 'FAIL',
    expectedRequiresGemini: false
  },

  // --- 14. Nested retests matches retest rule ---
  {
    id: 39,
    description: "Nested retests matches break and retest rule",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  },

  // --- 15. Nested FVG matches FVG rule ---
  {
    id: 40,
    description: "Nested FVG matches fair value gap rule",
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
    expectedRecommendation: 'PASS',
    expectedRequiresGemini: false
  }
];

export function runDecisionTestSuite(): { passed: boolean; averageTimeMs: number } {
  console.log("=== RUNNING DECISION ENGINE TEST SUITE ===");
  console.log(`Total test cases loaded: ${decisionTestCases.length}`);

  let passedCount = 0;
  const startPerformance = typeof performance !== 'undefined' ? performance.now() : Date.now();

  for (const tc of decisionTestCases) {
    const result = evaluateDecision(tc.compiledStrategy as CompilerOutput, tc.marketStructure);

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
