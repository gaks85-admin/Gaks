import { validateDetectors, ExecutionMode } from './detector-capability-validator';

function runTests() {
  const tests = [
    { rules: ["ema", "rsi"], expectedCoverage: 100, expectedMode: 'RULE_ONLY' },
    { rules: ["ema", "order_block"], expectedCoverage: 50, expectedMode: 'HYBRID' },
    { rules: ["order_block", "breaker_block"], expectedCoverage: 0, expectedMode: 'AI_ONLY' },
    // ... add more tests
  ];

  console.log("Running Detector Capability Validator Tests...");
  let passed = 0;
  tests.forEach((t, i) => {
    const result = validateDetectors(t.rules);
    if (result.coverage === t.expectedCoverage && result.execution_mode === t.expectedMode) {
      passed++;
    } else {
      console.error(`Test ${i} failed: Expected ${t.expectedCoverage}%, got ${result.coverage}%`);
    }
  });

  console.log(`Passed ${passed}/${tests.length} tests.`);
}

runTests();
