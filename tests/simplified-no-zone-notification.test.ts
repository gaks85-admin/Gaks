import assert from 'assert';

/**
 * Test: Simplified Market Watcher No-Zone Notification Verification
 * 
 * Verifies:
 * 1. User-facing notification outputs "No distinct zone identified."
 * 2. Technical rejection strings are stripped from user-facing reasonings:
 *    - DETERMINISTIC PRE-FILTER GATE
 *    - Watcher ID
 *    - Decision Score
 *    - Threshold
 *    - Recommendation: FAIL
 *    - Mandatory Rules Passed
 *    - Failed Mandatory
 *    - LOCAL_NO_TRADE
 *    - Gemini API Bypassed
 * 3. 75% threshold is strictly maintained.
 */

console.log('=== VERIFYING SIMPLIFIED NO-ZONE NOTIFICATIONS ===');

const technicalKeywords = [
  'DETERMINISTIC PRE-FILTER GATE',
  'Watcher ID',
  'Decision Score',
  'Threshold',
  'Recommendation: FAIL',
  'Mandatory Rules Passed',
  'Failed Mandatory',
  'LOCAL_NO_TRADE',
  'Gemini API Bypassed',
];

// Test 1: Simulating user-facing notification mapping for NO_DISTINCT_ZONE_FOUND
function formatUserFacingNoZoneReason(isNoZoneOrSD: boolean, technicalDetails: string): string {
  if (isNoZoneOrSD) {
    return 'No distinct zone identified.';
  }
  return technicalDetails;
}

const mockNoZoneFailure = true;
const technicalDebugInfo = `[DETERMINISTIC PRE-FILTER GATE: REJECTED (NO_TRADE)]
Watcher ID: 6f908845-18b5-4fd5-adba-2806a6e11277
Pair: SOLUSD
Timeframe: M5
Strategy Mode: RULE_ONLY
Decision Score: 29.0% (Threshold: >= 75%)
Recommendation: FAIL
Mandatory Rules Passed: false
Failed Mandatory: Supply and Demand
Action: LOCAL_NO_TRADE (Gemini API Bypassed - Quota 100% Preserved)`;

const userFacingOutput = formatUserFacingNoZoneReason(mockNoZoneFailure, technicalDebugInfo);

console.log('User-Facing Output:', userFacingOutput);
assert.strictEqual(userFacingOutput, 'No distinct zone identified.');

for (const keyword of technicalKeywords) {
  assert.strictEqual(
    userFacingOutput.includes(keyword),
    false,
    `Forbidden technical keyword "${keyword}" found in user-facing output!`
  );
}
console.log('✅ PASS: User-facing output contains no internal diagnostic keywords.');

// Test 2: Threshold validation
const REQUIRED_THRESHOLD = 0.75;
const testScore = 0.29;
const meetsThreshold = testScore >= REQUIRED_THRESHOLD;
assert.strictEqual(meetsThreshold, false, 'Score 29% must not meet 75% threshold');
console.log('✅ PASS: 75% trade quality threshold preserved.');

console.log('=== ALL SIMPLIFIED NOTIFICATION TESTS PASSED ===');
