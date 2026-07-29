import { compileStrategy } from '../strategy-compiler';
import { runTestSuite } from './test-suite';

// This is an integration example demonstrating how to run the Gaks AI Strategy Compiler.
// You can run these scenarios to see the structured output and categorization modes in action.

const scenarios = [
  {
    name: "RULE_ONLY Strategy (Deterministic and technical indicators)",
    text: "EMA crossover with 50 and 200 period averages, filter on M5 timeframe. Check for RSI below 30 oversold, confirmation candle, and trade during the London session."
  },
  {
    name: "HYBRID Strategy (Deterministic rules with subjective nuances)",
    text: "Look for trendline breakout on H1. Wait for a strong rejection of support with high probability clean breakout structure and strong momentum."
  },
  {
    name: "AI_ONLY Strategy (Non-deterministic, discretionary rules)",
    text: "I want to apply ICT concepts as I define them. I trade what feels exhausted depending on the day, reading market context and relying on personal discretion."
  }
];

export function runExampleScenarios() {
  console.log("=== STARTING STRATEGY COMPILER PHASE 1 DEMO ===");
  
  for (const scenario of scenarios) {
    console.log(`\nScenario Name: ${scenario.name}`);
    console.log(`Input Text: "${scenario.text}"`);
    
    const result = compileStrategy(scenario.text);
    
    console.log("Compilation Output JSON:");
    console.log(JSON.stringify(result, null, 2));
    console.log("-".repeat(50));
  }
  
  console.log("=== RUNNING FULL SEMANTIC TEST SUITE ===");
  runTestSuite();
  
  console.log("=== STRATEGY COMPILER DEMO COMPLETED ===");
}

