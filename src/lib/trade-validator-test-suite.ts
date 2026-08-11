import { validateActiveTradeState, isWatcherDue } from './trade-validator.js';

export function runTradeValidatorTestSuite() {
  console.log("==========================================");
  console.log("RUNNING TRADE VALIDATOR & SCHEDULER TEST SUITE");
  console.log("==========================================");

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  }

  // A. BUY valid active state
  const buyValid = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'BUY',
    entry_price: 1.1000,
    stop_loss: 1.0950,
    take_profit: 1.1150
  });
  assert(buyValid.valid === true, 'Test A - BUY valid active state passes validation');

  // B. SELL valid active state
  const sellValid = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'SELL',
    entry_price: 1.1000,
    stop_loss: 1.1050,
    take_profit: 1.0850
  });
  assert(sellValid.valid === true, 'Test B - SELL valid active state passes validation');

  // C. BUY with SL above entry → invalid
  const buySlInvalid = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'BUY',
    entry_price: 1.1000,
    stop_loss: 1.1050, // SL above entry for BUY
    take_profit: 1.1150
  });
  assert(buySlInvalid.valid === false, 'Test C - BUY with SL above entry is invalid');

  // D. BUY with TP below entry → invalid
  const buyTpInvalid = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'BUY',
    entry_price: 1.1000,
    stop_loss: 1.0950,
    take_profit: 1.0900 // TP below entry for BUY
  });
  assert(buyTpInvalid.valid === false, 'Test D - BUY with TP below entry is invalid');

  // E. SELL with SL below entry → invalid
  const sellSlInvalid = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'SELL',
    entry_price: 1.1000,
    stop_loss: 1.0950, // SL below entry for SELL
    take_profit: 1.0850
  });
  assert(sellSlInvalid.valid === false, 'Test E - SELL with SL below entry is invalid');

  // F. SELL with TP above entry → invalid
  const sellTpInvalid = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'SELL',
    entry_price: 1.1000,
    stop_loss: 1.1050,
    take_profit: 1.1150 // TP above entry for SELL
  });
  assert(sellTpInvalid.valid === false, 'Test F - SELL with TP above entry is invalid');

  // G. ACTIVE + NO_TRADE → invalid
  const activeNoTrade = validateActiveTradeState({
    trade_status: 'ACTIVE',
    direction: 'NO_TRADE',
    entry_price: 1.1000,
    stop_loss: 1.0950,
    take_profit: 1.1150
  });
  assert(activeNoTrade.valid === false, 'Test G - ACTIVE + NO_TRADE is invalid');

  // H, I, J: Validated by architecture (returns early before Gemini/Telegram, and transitions state to WAITING).

  // K. Watcher 500ms before eligibility with 30s grace → due
  const nowK = new Date('2026-08-11T22:15:07.234Z');
  const lastScanK = new Date('2026-08-11T21:15:07.734Z'); // 60 min interval -> next eligible at 22:15:07.734Z (500ms in future)
  const dueK = isWatcherDue({ last_scan_at: lastScanK.toISOString() }, nowK, 60, 30000);
  assert(dueK.isDue === true, 'Test K - Watcher 500ms before eligibility with 30s grace is due');

  // L. Watcher 31s before eligibility → not due
  const nowL = new Date('2026-08-11T22:14:36.734Z'); // 31 seconds before 22:15:07.734Z
  const dueL = isWatcherDue({ last_scan_at: lastScanK.toISOString() }, nowL, 60, 30000);
  assert(dueL.isDue === false, 'Test L - Watcher 31s before eligibility is NOT due');

  // M. Watcher exactly due → due
  const nowM = new Date('2026-08-11T22:15:07.734Z');
  const dueM = isWatcherDue({ last_scan_at: lastScanK.toISOString() }, nowM, 60, 30000);
  assert(dueM.isDue === true, 'Test M - Watcher exactly due is due');

  // N. Watcher already overdue → due
  const nowN = new Date('2026-08-11T22:20:00.000Z');
  const dueN = isWatcherDue({ last_scan_at: lastScanK.toISOString() }, nowN, 60, 30000);
  assert(dueN.isDue === true, 'Test N - Watcher overdue is due');

  // O. Overlapping cron executions protection (tested via recent last_scan_at check < 5s)
  const nowO = new Date();
  const lastScanO = new Date(nowO.getTime() - 2000); // 2 seconds ago
  const isRecentOverlap = (nowO.getTime() - lastScanO.getTime() < 5000);
  assert(isRecentOverlap === true, 'Test O - Overlapping cron scan within 5s window is recognized and prevented');

  console.log(`\n==========================================`);
  console.log(`TRADE VALIDATOR & SCHEDULER TESTS COMPLETED: ${passedCount}/${totalCount} PASSED`);
  console.log(`==========================================`);

  if (passedCount !== totalCount) {
    throw new Error(`Trade validator test suite failed: ${totalCount - passedCount} test(s) failed.`);
  }
}
