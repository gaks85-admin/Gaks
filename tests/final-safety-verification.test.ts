import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

async function runFinalSafetyTests() {
  const results: TestResult[] = [];

  // 1. Mandatory Rule Set Verification
  console.log("--- STRATEGY COMPILER: MANDATORY RULE CLASSIFICATION ---");
  
  const strategies = [
    { name: "EMA-only", text: "Mandatory: EMA crossover.", expectedMandatory: ['ema'] },
    { name: "RSI-only", text: "Required: RSI level.", expectedMandatory: ['rsi'] },
    { name: "MACD-only", text: "Strictly: MACD signal.", expectedMandatory: ['macd'] },
    { name: "S&D-required", text: "Mandatory: Supply and Demand.", expectedMandatory: ['supply_demand'] },
    { name: "Indicator + Optional Zone", text: "Mandatory: RSI. Optional: Supply and Demand.", expectedMandatory: ['rsi'] },
    { name: "Ambiguous (no keywords)", text: "EMA and RSI.", expectedMandatory: [] }
  ];

  for (const s of strategies) {
    const compiled = compileStrategy(s.text);
    const actualMandatory = compiled.canonical_rule_set.mandatory_rule_ids;
    const match = actualMandatory.length === s.expectedMandatory.length && 
                  s.expectedMandatory.every(id => actualMandatory.includes(id));
    
    results.push({
      name: `Classification: ${s.name}`,
      passed: match,
      details: `Expected: [${s.expectedMandatory.join(', ')}], Actual: [${actualMandatory.join(', ')}]`
    });
  }

  // 2. 75% Quality Threshold Enforcement across modes
  console.log("\n--- DECISION ENGINE: 75% THRESHOLD ENFORCEMENT ---");
  
  const mockMarketMatchSome = {
    ema: { matched: true, scoreOutOf10: 10 },
    rsi: { matched: false, scoreOutOf10: 0 },
    volume_confirmation: { matched: false, scoreOutOf10: 0 }
  };

  // Setup where EMA is mandatory and matches, but RSI is optional and fails.
  // Weight: EMA(5), RSI(4). Total=9. Score = 5/9 = 55.5% -> FAIL.
  const strategyMixed = "Mandatory: EMA. Optional: RSI.";
  const compiledMixed = compileStrategy(strategyMixed);
  
  const modes = ['RULE_ONLY', 'HYBRID', 'AI_ONLY'] as const;
  
  for (const mode of modes) {
    // Manually setting strategy mode for test
    compiledMixed.strategy_mode = mode;
    
    const decision = evaluateDecision(compiledMixed, mockMarketMatchSome);
    const score = decision.decision_score;
    const isRejected = decision.recommendation === 'FAIL';

    results.push({
      name: `Threshold: ${mode} at ${score}%`,
      passed: isRejected && score < 75,
      details: `Score: ${score}%, Recommendation: ${decision.recommendation}`
    });
  }

  // Exactly 75% test
  // Weights: EMA(5), RSI(4). We need Score >= 75%.
  // If we have EMA(10/10) and MACD(10/10) and Session(10/10) ... let's use a simpler one.
  // weights: ema=5, rsi=4. total=9. 75% of 9 is 6.75.
  // if ema=10/10 (5 pts) and rsi=5/10 (2 pts) -> 7 pts. 7/9 = 77.7% -> PASS.
  // if ema=10/10 (5 pts) and rsi=4/10 (1.6 pts) -> 6.6 pts. 6.6/9 = 73.3% -> FAIL.
  
  const mock77Percent = {
    ema: { matched: true, scoreOutOf10: 10 },
    rsi: { matched: false, scoreOutOf10: 5 }
  };
  
  const decision77 = evaluateDecision(compiledMixed, mock77Percent);
  results.push({
    name: "Threshold: Exactly above 75% (78%)",
    passed: decision77.decision_score === 78 && decision77.recommendation === 'PASS',
    details: `Score: ${decision77.decision_score}%, Rec: ${decision77.recommendation}`
  });

  const mock73Percent = {
    ema: { matched: true, scoreOutOf10: 10 },
    rsi: { matched: false, scoreOutOf10: 4 }
  };
  
  const decision73 = evaluateDecision(compiledMixed, mock73Percent);
  results.push({
    name: "Threshold: Exactly below 75% (73%)",
    passed: decision73.decision_score === 73 && decision73.recommendation === 'LIKELY_PASS', // LIKELY_PASS is >= 50
    details: `Score: ${decision73.decision_score}%, Rec: ${decision73.recommendation}`
  });
  
  // Note: passesDeterministicGate in market-watcher checks recommendation === 'PASS' || 'LIKELY_PASS' AND meetsQualityThreshold (75)
  // So 73% will be rejected by the gate even if it's LIKELY_PASS.

  console.log("\n--- TEST SUMMARY ---");
  let passCount = 0;
  results.forEach(r => {
    if (r.passed) passCount++;
    console.log(`${r.passed ? '✅' : '❌'} ${r.name}: ${r.details}`);
  });
  console.log(`\nFinal Score: ${passCount} / ${results.length}`);

  if (passCount !== results.length) {
    process.exit(1);
  }
}

runFinalSafetyTests().catch(err => {
  console.error(err);
  process.exit(1);
});
