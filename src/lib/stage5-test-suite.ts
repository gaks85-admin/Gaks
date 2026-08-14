import { validateExecutionFreshness, FreshnessRequest } from './execution-freshness.js';
import { EconomicEventService, EconomicEventProvider } from './economic-event-service.js';
import { revalidatePreExecution } from './pre-execution-validator.js';

class MockEconomicEventProvider implements EconomicEventProvider {
  async getUpcomingEvents(currency: string) {
    if (currency === 'EUR') {
      return [{
        id: 'test-event',
        eventName: 'ECB Rate Decision',
        currency: 'EUR',
        impact: 'HIGH' as const,
        eventTime: Date.now() + 15 * 60000 // 15 mins from now
      }];
    }
    return [];
  }
}

export async function runStage5Tests() {
  console.log("Running Stage 5 Hardening Tests...");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`✅ ${message}`);
      passed++;
    } else {
      console.error(`❌ ${message}`);
      failed++;
    }
  }

  // 1. Freshness Gate
  const now = Date.now();
  const req: FreshnessRequest = {
    signalGeneratedAt: now,
    marketDataTimestamp: now,
    currentPrice: 1.0500,
    entryPrice: 1.0500,
    stopLoss: 1.0400,
    takeProfit: 1.0700,
    instrument: 'EUR/USD',
    timeframe: 'H1',
    isBuy: true
  };

  const validFreshness = validateExecutionFreshness(req, 1.0499, 1.0501);
  assert(validFreshness.isValid, "Fresh signal should be valid");

  const staleReq = { ...req, signalGeneratedAt: now - 3 * 60000 };
  const staleFreshness = validateExecutionFreshness(staleReq, 1.0499, 1.0501);
  assert(staleFreshness.rejectionReason === 'STALE_SIGNAL', "Stale signal should be rejected");

  const driftReq = { ...req, currentPrice: 1.1000 }; // Huge drift
  const driftFreshness = validateExecutionFreshness(driftReq, 1.0999, 1.1001);
  assert(driftFreshness.rejectionReason === 'ENTRY_PRICE_DRIFT', "Entry drift should be rejected");

  // 2. Economic Event Gate
  const econService = new EconomicEventService(new MockEconomicEventProvider());
  const eurEvent = await econService.checkNewsHardPause('EUR/USD');
  assert(eurEvent.tradeBlocked && eurEvent.blockReason?.includes('NEWS_HARD_PAUSE'), "News hard pause should block EUR/USD 15 mins before ECB");

  const jpyEvent = await econService.checkNewsHardPause('USD/JPY');
  assert(!jpyEvent.tradeBlocked, "News hard pause should pass USD/JPY");

  // 3. Pre-execution Revalidation
  const validExec = revalidatePreExecution({
    marketDataAvailable: true,
    marketDataFreshness: validFreshness,
    currentPrice: 1.0500,
    spread: 0.0002,
    entryPrice: 1.0500,
    sl: 1.0400,
    tp: 1.0700,
    rr: 3.0,
    riskGovernorPassed: true,
    newsGate: jpyEvent,
    positionSizing: 0.1,
    userRiskLimitsPassed: true,
    duplicateTradeProtectionPassed: true,
    signalExpired: false
  });
  assert(validExec.status === 'FINAL_EXECUTION_AUTHORIZED', "Valid pre-execution should authorize");

  const invalidExec = revalidatePreExecution({
    marketDataAvailable: true,
    marketDataFreshness: validFreshness,
    currentPrice: 1.0500,
    spread: 0.0002,
    entryPrice: 1.0500,
    sl: 1.0400,
    tp: 1.0700,
    rr: 3.0,
    riskGovernorPassed: true,
    newsGate: eurEvent, // Using the blocked EUR event
    positionSizing: 0.1,
    userRiskLimitsPassed: true,
    duplicateTradeProtectionPassed: true,
    signalExpired: false
  });
  assert(invalidExec.status === 'FINAL_EXECUTION_REJECTED' && invalidExec.rejectionReason?.includes('NEWS_HARD_PAUSE'), "News blocked pre-execution should reject");

  console.log(`Stage 5 Tests completed. Passed: ${passed}, Failed: ${failed}`);
  return failed === 0;
}
runStage5Tests();
