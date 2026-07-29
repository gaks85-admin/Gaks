import { runDecisionTestSuite } from './test-suite.js';

const result = runDecisionTestSuite();

if (result.passed) {
  console.log("\n✅ All Decision Engine test cases passed successfully!");
  process.exit(0);
} else {
  console.error("\n❌ Some Decision Engine test cases failed!");
  process.exit(1);
}
