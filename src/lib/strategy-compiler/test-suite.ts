import { compileStrategy } from '../strategy-compiler';

export interface TestCase {
  id: number;
  description: string;
  strategyText: string;
  expectedCategory: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY';
  expectedKeys: string[];
}

export const semanticTestCases: TestCase[] = [
  // --- EMA (1-5) ---
  {
    id: 1,
    description: "EMA standard wording",
    strategyText: "Check for EMA crossover on 50 and 200 averages.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['ema']
  },
  {
    id: 2,
    description: "EMA synonym: moving average crossover",
    strategyText: "Check for moving average crossover with 50 and 200 averages.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['ema']
  },
  {
    id: 3,
    description: "EMA synonym: Golden Cross",
    strategyText: "Enter on a Golden Cross.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['ema']
  },
  {
    id: 4,
    description: "EMA synonym: fast EMA crosses slow EMA",
    strategyText: "I want fast EMA crosses slow EMA to trigger a signal.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['ema']
  },
  {
    id: 5,
    description: "EMA synonym: fast MA over Slow MA",
    strategyText: "Trigger when fast MA over Slow MA on the chart.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['ema']
  },

  // --- Trendline (6-10) ---
  {
    id: 6,
    description: "Trendline standard",
    strategyText: "Wait for a trendline breakout.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['trendline_breakout']
  },
  {
    id: 7,
    description: "Trendline synonym: break trendline",
    strategyText: "Enter when we break trendline.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['trendline_breakout']
  },
  {
    id: 8,
    description: "Trendline synonym: trendline violation",
    strategyText: "Signal on trendline violation.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['trendline_breakout']
  },
  {
    id: 9,
    description: "Trendline synonym: Trend Line Break",
    strategyText: "Check for a Trend Line Break.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['trendline_breakout']
  },
  {
    id: 10,
    description: "Trendline synonym: breakout of trend line",
    strategyText: "Look for a breakout of trend line.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['trendline_breakout']
  },

  // --- BOS (11-14) ---
  {
    id: 11,
    description: "BOS standard",
    strategyText: "Wait for a BOS to happen.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['bos']
  },
  {
    id: 12,
    description: "BOS synonym: break of structure",
    strategyText: "Enter on a break of structure.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['bos']
  },
  {
    id: 13,
    description: "BOS synonym: market structure break",
    strategyText: "Identify a market structure break.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['bos']
  },
  {
    id: 14,
    description: "BOS synonym: structure break",
    strategyText: "Confirm with a structure break.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['bos']
  },

  // --- CHoCH (15-18) ---
  {
    id: 15,
    description: "CHoCH standard",
    strategyText: "Look for a CHOCH on M15.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['choch']
  },
  {
    id: 16,
    description: "CHoCH synonym: change of character",
    strategyText: "Confirm a change of character.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['choch']
  },
  {
    id: 17,
    description: "CHoCH synonym: character change",
    strategyText: "Enter upon a character change.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['choch']
  },
  {
    id: 18,
    description: "CHoCH synonym: change in character",
    strategyText: "Wait for change in character.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['choch']
  },

  // --- Support (19-22) ---
  {
    id: 19,
    description: "Support standard",
    strategyText: "Identify key support level.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['support']
  },
  {
    id: 20,
    description: "Support synonym: support rejection",
    strategyText: "Trade on support rejection.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['support_rejection']
  },
  {
    id: 21,
    description: "Support synonym: bounce off support",
    strategyText: "Buy on a bounce off support.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['support_rejection']
  },
  {
    id: 22,
    description: "Support synonym: respect support",
    strategyText: "Price must respect support.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['support_rejection']
  },

  // --- Resistance (23-26) ---
  {
    id: 23,
    description: "Resistance standard",
    strategyText: "Watch the resistance level.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['resistance']
  },
  {
    id: 24,
    description: "Resistance synonym: resistance rejection",
    strategyText: "Trade on resistance rejection.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['resistance_rejection']
  },
  {
    id: 25,
    description: "Resistance synonym: bounce off resistance",
    strategyText: "Sell on a bounce off resistance.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['resistance_rejection']
  },
  {
    id: 26,
    description: "Resistance synonym: respect resistance",
    strategyText: "Price must respect resistance.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['resistance_rejection']
  },

  // --- FVG (27-30) ---
  {
    id: 27,
    description: "FVG standard",
    strategyText: "Enter when price fills the FVG.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['fair_value_gap']
  },
  {
    id: 28,
    description: "FVG synonym: fair value gap",
    strategyText: "Find a fair value gap.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['fair_value_gap']
  },
  {
    id: 29,
    description: "FVG synonym: imbalance",
    strategyText: "Wait for price to fill the imbalance.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['fair_value_gap']
  },
  {
    id: 30,
    description: "FVG synonym: market imbalance",
    strategyText: "Check for a market imbalance.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['fair_value_gap']
  },

  // --- Volume (31-34) ---
  {
    id: 31,
    description: "Volume standard",
    strategyText: "Ensure volume confirmation.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['volume_confirmation']
  },
  {
    id: 32,
    description: "Volume synonym: high volume",
    strategyText: "Enter when there is high volume.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['volume_confirmation']
  },
  {
    id: 33,
    description: "Volume synonym: volume spike",
    strategyText: "Verify with a volume spike.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['volume_confirmation']
  },
  {
    id: 34,
    description: "Volume synonym: increased participation",
    strategyText: "Watch for increased participation on the bar.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['volume_confirmation']
  },

  // --- Sessions (35-38) ---
  {
    id: 35,
    description: "London Session",
    strategyText: "Trade only during London session.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['session']
  },
  {
    id: 36,
    description: "London Killzone",
    strategyText: "Enter on the London killzone.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['session']
  },
  {
    id: 37,
    description: "NY Session",
    strategyText: "Look for setup in the NY session.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['session']
  },
  {
    id: 38,
    description: "NYC Session",
    strategyText: "Setup triggers in NYC session.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['session']
  },

  // --- Technical Indicators & Math (39-42) ---
  {
    id: 39,
    description: "RSI oversold levels",
    strategyText: "Wait for RSI below 30 oversold.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['rsi']
  },
  {
    id: 40,
    description: "ATR check",
    strategyText: "Filter trades using average true range volatility.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['atr']
  },
  {
    id: 41,
    description: "MACD crossover",
    strategyText: "Wait for moving average convergence divergence crossover.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['macd']
  },
  {
    id: 42,
    description: "Risk Reward ratio",
    strategyText: "Check for minimum 1:2 r:r ratio.",
    expectedCategory: 'RULE_ONLY',
    expectedKeys: ['risk_reward']
  },

  // --- Subjective/Hybrid (43-46) ---
  {
    id: 43,
    description: "Hybrid: strong rejection keyword",
    strategyText: "EMA crossover with strong rejection.",
    expectedCategory: 'HYBRID',
    expectedKeys: ['ema', 'subjective_elements']
  },
  {
    id: 44,
    description: "Hybrid: beautiful break",
    strategyText: "Wait for a beautiful break of support.",
    expectedCategory: 'HYBRID',
    expectedKeys: ['support', 'subjective_elements']
  },
  {
    id: 45,
    description: "Hybrid: high probability clean breakout",
    strategyText: "Trendline break with high probability clean breakout structure.",
    expectedCategory: 'HYBRID',
    expectedKeys: ['trendline_breakout', 'subjective_elements']
  },
  {
    id: 46,
    description: "Hybrid: good structure",
    strategyText: "BOS with a good structure.",
    expectedCategory: 'HYBRID',
    expectedKeys: ['bos', 'subjective_elements']
  },

  // --- AI ONLY (47-50) ---
  {
    id: 47,
    description: "AI Only: personal discretion",
    strategyText: "Enter trades based on my personal discretion.",
    expectedCategory: 'AI_ONLY',
    expectedKeys: ['ai_only_elements']
  },
  {
    id: 48,
    description: "AI Only: market feels exhausted",
    strategyText: "Trade what feels exhausted when the market feels exhausted.",
    expectedCategory: 'AI_ONLY',
    expectedKeys: ['ai_only_elements']
  },
  {
    id: 49,
    description: "AI Only: ICT concepts as defined by user",
    strategyText: "I apply ICT concepts as I define them.",
    expectedCategory: 'AI_ONLY',
    expectedKeys: ['ai_only_elements']
  },
  {
    id: 50,
    description: "AI Only: gut feeling",
    strategyText: "Trade based on gut feeling and intuition.",
    expectedCategory: 'AI_ONLY',
    expectedKeys: ['ai_only_elements']
  }
];

export function runTestSuite(): { passed: boolean; averageTimeMs: number } {
  console.log("=== RUNNING SEMANTIC COMPILER TEST SUITE ===");
  console.log(`Total test cases loaded: ${semanticTestCases.length}`);
  
  let passedCount = 0;
  const startPerformance = typeof performance !== 'undefined' ? performance.now() : Date.now();
  
  for (const tc of semanticTestCases) {
    const result = compileStrategy(tc.strategyText);
    
    // Check if mode is as expected
    const modeMatches = result.strategy_mode === tc.expectedCategory;
    
    // Check if expected rule keys are compiled (meaning they are truthy or enabled)
    let keysMatch = true;
    for (const key of tc.expectedKeys) {
      const val = (result.compiled_rules as any)[key];
      const isPresent = val !== undefined && val !== false && (typeof val !== 'object' || val === null || Object.keys(val).length > 0);
      if (!isPresent) {
        keysMatch = false;
        break;
      }
    }
    
    if (modeMatches && keysMatch) {
      passedCount++;
    } else {
      console.error(`❌ Test Case #${tc.id} Failed: "${tc.description}"`);
      console.error(`   Text: "${tc.strategyText}"`);
      console.error(`   Expected Category: ${tc.expectedCategory}, Got: ${result.strategy_mode}`);
      console.error(`   Expected Keys: ${tc.expectedKeys.join(', ')}`);
      console.error(`   Compiled Rules keys: ${Object.keys(result.compiled_rules).filter(k => (result.compiled_rules as any)[k]).join(', ')}`);
    }
  }
  
  const endPerformance = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const totalDuration = endPerformance - startPerformance;
  const averageTimeMs = totalDuration / semanticTestCases.length;
  
  const allPassed = passedCount === semanticTestCases.length;
  
  console.log(`\n=== PERFORMANCE REPORT ===`);
  console.log(`Passed: ${passedCount} / ${semanticTestCases.length}`);
  console.log(`Total Time: ${totalDuration.toFixed(4)} ms`);
  console.log(`Average Time per Strategy: ${averageTimeMs.toFixed(4)} ms`);
  console.log(`Status: ${allPassed ? "SUCCESS" : "FAILED"}`);
  console.log("===========================");
  
  return {
    passed: allPassed,
    averageTimeMs
  };
}
