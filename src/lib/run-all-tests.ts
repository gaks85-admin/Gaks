/**
 * GAKS AI — Comprehensive Test Suite Runner (Phases 3 - 9)
 */

import { runCSVParserTests } from './backtest-csv.test.js';
import { runBacktestAPITests } from '../../tests/backtest-api.test.js';
import { runEngineUnitTests } from './backtest-engine.test.js';
import { runTradeSimulatorTests } from './backtest-trade-simulator.test.js';
import { runGaksStrategyAdapterTests } from './backtest-gaks-strategy.test.js';
import { runAnalyticsUnitTests } from './backtest-analytics.test.js';
import { runPersistenceUnitTests } from './backtest-persistence-service.test.js';
import { runBacktestSafetyTests } from './backtest-safety.test.js';
import { runPhase9Validation } from './backtest-phase9.test.js';

async function runAllTestSuites() {
  console.log('==================================================');
  console.log('GAKS AI — COMPREHENSIVE BACKTESTING TEST SUITES');
  console.log('==================================================');

  const csvRes = runCSVParserTests();
  const apiRes = await runBacktestAPITests();
  const engineRes = await runEngineUnitTests();
  const simRes = await runTradeSimulatorTests();
  const gaksRes = await runGaksStrategyAdapterTests();
  const analyticsRes = await runAnalyticsUnitTests();
  const persistenceRes = await runPersistenceUnitTests();
  const safetyRes = await runBacktestSafetyTests();
  const phase9Res = await runPhase9Validation();

  console.log('\n==================================================');
  console.log('FINAL TEST SUITE SUMMARY:');
  console.log('--------------------------------------------------');
  console.log('1. CSV Parser:', csvRes);
  console.log('2. Phase 3 API:', apiRes);
  console.log('3. Phase 4 Engine:', engineRes);
  console.log('4. Phase 5 Simulator:', simRes);
  console.log('5. Gaks Strategy Adapter:', gaksRes);
  console.log('6. Phase 6 Analytics:', analyticsRes);
  console.log('7. Phase 7 Persistence:', persistenceRes);
  console.log('8. Phase 8 Safety Isolation:', safetyRes);
  console.log('9. Phase 9 Full 2025 Validation:', phase9Res);
  console.log('==================================================');

  const totalFailed = csvRes.failed + apiRes.failed + engineRes.failed + simRes.failed + gaksRes.failed + analyticsRes.failed + persistenceRes.failed + safetyRes.failed + phase9Res.failed;
  if (totalFailed > 0) {
    console.error(`\nTEST FAILURE DETECTED: ${totalFailed} assertions failed.`);
    process.exit(1);
  } else {
    console.log('\nALL TEST SUITES AND PHASE 9 VALIDATION PASSED CLEANLY (100% SUCCESS)!');
  }
}

runAllTestSuites();
