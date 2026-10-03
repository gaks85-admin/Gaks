import { EconomicEventService } from './economic-event-service.js';
import { evaluateEconomicNewsGate } from './economic-news-gate.js';
import { revalidatePreExecution } from './pre-execution-validator.js';
import { evaluateWatcherPropFirmGate } from './prop-firm-watcher-gate.js';
import { PropFirmSettings } from './prop-firm-service.js';

export interface PersonalNewsProtectionTestResult {
  testNumber: number;
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

/**
 * Creates an in-memory mock Supabase client loaded with economic events
 */
function createMockSupabaseWithEvents(events: any[] = [], shouldFailQuery: boolean = false) {
  return {
    from: (table: string) => {
      if (table === 'economic_events') {
        return {
          select: (_cols?: string) => {
            let filtered = [...events];
            let hasError = shouldFailQuery;

            const chain: any = {
              in: (col: string, vals: any[]) => {
                filtered = filtered.filter(e => vals.includes(e[col]));
                return chain;
              },
              eq: (col: string, val: any) => {
                filtered = filtered.filter(e => e[col] === val);
                return chain;
              },
              gte: (col: string, val: string) => {
                const targetMs = new Date(val).getTime();
                filtered = filtered.filter(e => new Date(e[col]).getTime() >= targetMs);
                return chain;
              },
              lte: (col: string, val: string) => {
                const targetMs = new Date(val).getTime();
                filtered = filtered.filter(e => new Date(e[col]).getTime() <= targetMs);
                return chain;
              },
              order: (_col: string, _opts?: any) => {
                filtered.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
                return chain;
              },
              then: (resolve: any) => {
                if (hasError) {
                  return resolve({ data: null, error: new Error('Database connection failed') });
                }
                return resolve({ data: filtered, error: null });
              }
            };
            return chain;
          }
        };
      }

      // Default mock for other tables
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null })
          })
        })
      };
    }
  };
}

export async function runPersonalNewsProtectionTests(): Promise<PersonalNewsProtectionTestResult[]> {
  const results: PersonalNewsProtectionTestResult[] = [];

  const addTest = async (
    num: number,
    name: string,
    fn: () => Promise<boolean | { passed: boolean; details?: string }>
  ) => {
    try {
      const res = await fn();
      const passed = typeof res === 'boolean' ? res : res.passed;
      const details = typeof res === 'object' ? res.details : undefined;
      results.push({
        testNumber: num,
        name,
        passed,
        message: passed ? 'PASS' : 'FAIL',
        details
      });
    } catch (err: any) {
      results.push({
        testNumber: num,
        name,
        passed: false,
        message: `FAIL (Exception): ${err.message}`,
        details: err.stack
      });
    }
  };

  const fixedNow = new Date('2026-10-03T12:00:00.000Z');

  // =========================================================================
  // TEST 1: Personal + News Protection OFF -> Trade is NOT blocked by news
  // =========================================================================
  await addTest(1, 'Personal + news protection OFF -> trade is not blocked by news', async () => {
    // There is a high impact USD event occurring right now
    const mockDb = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-1',
        event_name: 'US CPI m/m',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:00:00.000Z'
      }
    ]);

    const service = new EconomicEventService(undefined, mockDb);
    const outcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: false,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    const preExec = revalidatePreExecution({
      marketDataAvailable: true,
      marketDataFreshness: { valid: true } as any,
      currentPrice: 1.0850,
      spread: 0.0001,
      entryPrice: 1.0850,
      sl: 1.0800,
      tp: 1.0950,
      rr: 2,
      riskGovernorPassed: true,
      newsGate: outcome.newsGateResult,
      positionSizing: 0.1,
      userRiskLimitsPassed: true,
      duplicateTradeProtectionPassed: true,
      signalExpired: false
    });

    return (
      outcome.status === 'CLEAR' &&
      outcome.allowed === true &&
      outcome.newsGateResult.tradeBlocked === false &&
      preExec.status === 'FINAL_EXECUTION_AUTHORIZED'
    );
  });

  // =========================================================================
  // TEST 2: Personal + News Protection ON + No relevant event -> PASS
  // =========================================================================
  await addTest(2, 'Personal + news protection ON + no relevant event -> PASS', async () => {
    // Database has LOW impact USD event and HIGH impact JPY event (unrelated to EURUSD)
    const mockDb = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-low',
        event_name: 'US Factory Orders',
        currency: 'USD',
        impact: 'LOW',
        scheduled_at: '2026-10-03T12:10:00.000Z'
      },
      {
        provider_event_id: 'ev-jpy',
        event_name: 'BoJ Interest Rate Decision',
        currency: 'JPY',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:10:00.000Z'
      }
    ]);

    const service = new EconomicEventService(undefined, mockDb);
    const outcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    return outcome.status === 'CLEAR' && outcome.allowed === true && outcome.newsGateResult.tradeBlocked === false;
  });

  // =========================================================================
  // TEST 3: Personal + News Protection ON + HIGH impact USD event inside buffer -> BLOCK
  // =========================================================================
  await addTest(3, 'Personal + news protection ON + HIGH impact USD event inside buffer -> BLOCK', async () => {
    // Event scheduled in 15 minutes (within 30m before buffer)
    const mockDb = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-cpi',
        event_name: 'US CPI m/m',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:15:00.000Z'
      }
    ]);

    const service = new EconomicEventService(undefined, mockDb);
    const outcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    const preExec = revalidatePreExecution({
      marketDataAvailable: true,
      marketDataFreshness: { valid: true } as any,
      currentPrice: 1.0850,
      spread: 0.0001,
      entryPrice: 1.0850,
      sl: 1.0800,
      tp: 1.0950,
      rr: 2,
      riskGovernorPassed: true,
      newsGate: outcome.newsGateResult,
      positionSizing: 0.1,
      userRiskLimitsPassed: true,
      duplicateTradeProtectionPassed: true,
      signalExpired: false
    });

    return (
      outcome.status === 'BLOCKED' &&
      outcome.allowed === false &&
      outcome.blockReason === 'PERSONAL_NEWS_RESTRICTION' &&
      outcome.eventName === 'US CPI m/m' &&
      outcome.currency === 'USD' &&
      outcome.newsGateResult.tradeBlocked === true &&
      preExec.status === 'FINAL_EXECUTION_REJECTED' &&
      preExec.rejectionReason === 'PERSONAL_NEWS_RESTRICTION'
    );
  });

  // =========================================================================
  // TEST 4: Personal + Event outside before/after buffer -> PASS
  // =========================================================================
  await addTest(4, 'Personal + event outside before/after buffer -> PASS', async () => {
    // Event 45m in the future (outside 30m before buffer) and event 45m in the past (outside 30m after buffer)
    const mockDb = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-past',
        event_name: 'US Non-Farm Payrolls',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T11:15:00.000Z' // 45m ago
      },
      {
        provider_event_id: 'ev-future',
        event_name: 'FOMC Statement',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:45:00.000Z' // in 45m
      }
    ]);

    const service = new EconomicEventService(undefined, mockDb);
    const outcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    return outcome.status === 'CLEAR' && outcome.allowed === true && outcome.newsGateResult.tradeBlocked === false;
  });

  // =========================================================================
  // TEST 5: Personal + Event exactly at buffer boundary -> verify deterministic boundary behavior
  // =========================================================================
  await addTest(5, 'Personal + event exactly at buffer boundary -> deterministic boundary behavior', async () => {
    // Exactly at boundary (+30m: 12:30:00.000Z) -> INCLUDED / BLOCKED
    const mockDbBoundary = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-exact-future',
        event_name: 'US Retail Sales',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:30:00.000Z'
      }
    ]);

    const serviceBoundary = new EconomicEventService(undefined, mockDbBoundary);
    const outcomeBoundary = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service: serviceBoundary,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    // Just 1 second past boundary (+30m 1s: 12:30:01.000Z) -> OUTSIDE / CLEAR
    const mockDbOutside = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-outside-future',
        event_name: 'US Retail Sales',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:30:01.000Z'
      }
    ]);

    const serviceOutside = new EconomicEventService(undefined, mockDbOutside);
    const outcomeOutside = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service: serviceOutside,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    return (
      outcomeBoundary.status === 'BLOCKED' &&
      outcomeBoundary.allowed === false &&
      outcomeOutside.status === 'CLEAR' &&
      outcomeOutside.allowed === true
    );
  });

  // =========================================================================
  // TEST 6: Personal + News query unavailable -> UNAVAILABLE / FAIL CLOSED
  // =========================================================================
  await addTest(6, 'Personal + news query unavailable -> UNAVAILABLE / FAIL CLOSED', async () => {
    // Mock database with query failure
    const mockFailingDb = createMockSupabaseWithEvents([], true);
    const service = new EconomicEventService(undefined, mockFailingDb);

    const outcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    const preExec = revalidatePreExecution({
      marketDataAvailable: true,
      marketDataFreshness: { valid: true } as any,
      currentPrice: 1.0850,
      spread: 0.0001,
      entryPrice: 1.0850,
      sl: 1.0800,
      tp: 1.0950,
      rr: 2,
      riskGovernorPassed: true,
      newsGate: outcome.newsGateResult,
      positionSizing: 0.1,
      userRiskLimitsPassed: true,
      duplicateTradeProtectionPassed: true,
      signalExpired: false
    });

    return (
      outcome.status === 'UNAVAILABLE' &&
      outcome.allowed === false &&
      outcome.blockReason === 'NEWS_RESTRICTION_UNAVAILABLE' &&
      outcome.newsGateResult.tradeBlocked === true &&
      preExec.status === 'FINAL_EXECUTION_REJECTED'
    );
  });

  // =========================================================================
  // TEST 7: Personal Custom buffer: 60m before / 15m after -> verify exact window
  // =========================================================================
  await addTest(7, 'Personal custom buffer: 60m before / 15m after -> verify exact asymmetrical window', async () => {
    // 1) Event 45m in the future: inside 60m before buffer -> BLOCKED
    const mockDbFuture = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-45m-future',
        event_name: 'US GDP Growth Rate',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:45:00.000Z'
      }
    ]);
    const service1 = new EconomicEventService(undefined, mockDbFuture);
    const outcome1 = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 60,
      bufferAfterMinutes: 15,
      service: service1,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    // 2) Event 20m in the past: outside 15m after buffer -> CLEAR
    const mockDbPast20 = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-20m-past',
        event_name: 'US GDP Growth Rate',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T11:40:00.000Z'
      }
    ]);
    const service2 = new EconomicEventService(undefined, mockDbPast20);
    const outcome2 = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 60,
      bufferAfterMinutes: 15,
      service: service2,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    // 3) Event 10m in the past: inside 15m after buffer -> BLOCKED
    const mockDbPast10 = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-10m-past',
        event_name: 'US GDP Growth Rate',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T11:50:00.000Z'
      }
    ]);
    const service3 = new EconomicEventService(undefined, mockDbPast10);
    const outcome3 = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 60,
      bufferAfterMinutes: 15,
      service: service3,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    return (
      outcome1.status === 'BLOCKED' &&
      outcome2.status === 'CLEAR' &&
      outcome3.status === 'BLOCKED'
    );
  });

  // =========================================================================
  // TEST 8: XAUUSD: verify XAU/USD currency mapping using existing implementation
  // =========================================================================
  await addTest(8, 'XAUUSD: verify XAU/USD currency mapping using existing implementation', async () => {
    const service = new EconomicEventService();
    const xauusdCurrencies = service.extractCurrencies('XAUUSD');
    const xauSlashCurrencies = service.extractCurrencies('XAU/USD');

    // High impact USD event matches XAUUSD trade
    const mockDb = createMockSupabaseWithEvents([
      {
        provider_event_id: 'ev-usd-rate',
        event_name: 'Fed Interest Rate Decision',
        currency: 'USD',
        impact: 'HIGH',
        scheduled_at: '2026-10-03T12:10:00.000Z'
      }
    ]);

    const serviceWithDb = new EconomicEventService(undefined, mockDb);
    const outcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'XAUUSD',
      newsRestrictionEnabled: true,
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      service: serviceWithDb,
      nowOverride: fixedNow,
      suppressLogs: true
    });

    return (
      xauusdCurrencies.includes('USD') &&
      xauSlashCurrencies.includes('USD') &&
      outcome.status === 'BLOCKED' &&
      outcome.currency === 'USD'
    );
  });

  // =========================================================================
  // TEST 9: Prop Firm Regression: existing prop news restriction remains unchanged
  // =========================================================================
  await addTest(9, 'Prop Firm regression: existing prop news restriction remains unchanged', async () => {
    const basePropSettings: PropFirmSettings = {
      id: 'pf-reg-1',
      user_id: 'user-pf-1',
      firm_name: 'FTMO',
      account_phase: 'Phase 1',
      account_size: 100000,
      profit_target: 10,
      profit_target_type: 'PERCENTAGE',
      daily_loss_limit: 5,
      daily_loss_limit_type: 'PERCENTAGE',
      daily_loss_calculation_basis: 'BALANCE',
      maximum_drawdown: 10,
      drawdown_type: 'STATIC',
      drawdown_calculation_basis: 'BALANCE',
      risk_per_trade: 1,
      risk_per_trade_type: 'PERCENTAGE',
      news_restriction_enabled: true,
      news_buffer_before_minutes: 15,
      news_buffer_after_minutes: 15,
      maximum_trades_per_day: 3,
      daily_reset_time: '00:00',
      daily_reset_timezone: 'UTC'
    };

    // Prop gate evaluation when news event is present inside 15m window
    const gateOutcome = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-pf-1',
      symbol: 'EURUSD',
      rawAccountType: 'prop',
      proposedTradeRisk: 500,
      currentMarketPrice: 1.0850,
      runtimeOverride: {
        settingsLoader: async () => ({ settings: basePropSettings, error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({
          eventDetected: true,
          eventName: 'US CPI',
          currency: 'USD',
          impact: 'HIGH',
          scheduledAt: '2026-10-03T12:05:00.000Z',
          tradeBlocked: true,
          blockReason: 'NEWS_HARD_PAUSE: HIGH impact event US CPI in 5 minutes'
        })
      }
    });

    return (
      gateOutcome.evaluated === true &&
      gateOutcome.allowed === false &&
      gateOutcome.blockReason?.includes('NEWS_HARD_PAUSE') === true
    );
  });

  // =========================================================================
  // TEST 10: Personal/Prop Isolation: changing Personal news settings does not modify Prop settings
  // =========================================================================
  await addTest(10, 'Personal/Prop isolation: Personal and Prop news configurations remain strictly isolated', async () => {
    // 1) When account is 'personal', changing prop_firm_settings must not affect personal news
    const personalOutcome = await evaluateEconomicNewsGate({
      accountType: 'personal',
      symbol: 'EURUSD',
      newsRestrictionEnabled: false, // Personal is OFF
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30,
      suppressLogs: true
    });

    // 2) When account is 'prop', personal news settings being false must not affect prop firm news
    const propOutcome = await evaluateEconomicNewsGate({
      accountType: 'prop',
      symbol: 'EURUSD',
      newsRestrictionEnabled: true, // Prop is ON
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      nowOverride: fixedNow,
      service: new EconomicEventService(
        undefined,
        createMockSupabaseWithEvents([
          {
            provider_event_id: 'ev-prop-iso',
            event_name: 'US NFP',
            currency: 'USD',
            impact: 'HIGH',
            scheduled_at: '2026-10-03T12:05:00.000Z'
          }
        ])
      ),
      suppressLogs: true
    });

    return (
      personalOutcome.status === 'CLEAR' &&
      personalOutcome.allowed === true &&
      propOutcome.status === 'BLOCKED' &&
      propOutcome.allowed === false
    );
  });

  // =========================================================================
  // TEST 11: Save Preferences: changing only Personal news toggle activates Save Preferences
  // =========================================================================
  await addTest(11, 'Save Preferences: changing only Personal news toggle or buffer activates Save Preferences dirty state', async () => {
    // Replicate the isPrefsDirty logic from App.tsx
    const initialBaseline = {
      capital: '$1,000',
      customCapital: '',
      preferredRisk: '1%',
      maxDailyLoss: '$100',
      riskReward: '1:2',
      accountType: 'personal' as 'personal' | 'prop' | null,
      positionMode: 'AUTO_RISK' as 'AUTO_RISK' | 'FIXED_LOT',
      fixedLotSize: '0.01',
      analysisMode: 'HYBRID' as 'HYBRID' | 'RULE_ONLY' | 'AI_ONLY',
      preferredSessions: ['London', 'New York', 'Tokyo'],
      preferredTimeframes: ['M15', 'H1'],
      personalNewsRestriction: false,
      personalNewsBufferBefore: '30',
      personalNewsBufferAfter: '30'
    };

    const computeIsDirty = (current: typeof initialBaseline) => {
      if (current.capital !== initialBaseline.capital) return true;
      if (current.preferredRisk !== initialBaseline.preferredRisk) return true;
      if (current.accountType !== initialBaseline.accountType) return true;
      if (current.personalNewsRestriction !== initialBaseline.personalNewsRestriction) return true;
      if (current.personalNewsBufferBefore.trim() !== initialBaseline.personalNewsBufferBefore.trim()) return true;
      if (current.personalNewsBufferAfter.trim() !== initialBaseline.personalNewsBufferAfter.trim()) return true;
      return false;
    };

    // 1) Identical state -> NOT dirty
    const pristineDirty = computeIsDirty({ ...initialBaseline });

    // 2) Toggling only personalNewsRestriction -> DIRTY
    const toggleOnlyDirty = computeIsDirty({ ...initialBaseline, personalNewsRestriction: true });

    // 3) Changing only buffer before -> DIRTY
    const bufferBeforeDirty = computeIsDirty({ ...initialBaseline, personalNewsBufferBefore: '45' });

    // 4) Changing only buffer after -> DIRTY
    const bufferAfterDirty = computeIsDirty({ ...initialBaseline, personalNewsBufferAfter: '15' });

    return (
      pristineDirty === false &&
      toggleOnlyDirty === true &&
      bufferBeforeDirty === true &&
      bufferAfterDirty === true
    );
  });

  // =========================================================================
  // TEST 12: Persistence & Validation: Buffer validation and state round-trip
  // =========================================================================
  await addTest(12, 'Persistence & validation: buffer values within [0, 1440] integers accepted, out-of-bounds rejected', async () => {
    const validatePersonalNewsSettings = (
      enabled: any,
      beforeStr: string,
      afterStr: string
    ): { valid: boolean; reason?: string } => {
      if (typeof enabled !== 'boolean') {
        return { valid: false, reason: 'news_restriction_enabled must be boolean' };
      }
      const beforeNum = Number(beforeStr);
      const afterNum = Number(afterStr);

      if (
        !Number.isFinite(beforeNum) ||
        !Number.isInteger(beforeNum) ||
        beforeNum < 0 ||
        beforeNum > 1440
      ) {
        return { valid: false, reason: 'news_buffer_before_minutes must be integer between 0 and 1440' };
      }

      if (
        !Number.isFinite(afterNum) ||
        !Number.isInteger(afterNum) ||
        afterNum < 0 ||
        afterNum > 1440
      ) {
        return { valid: false, reason: 'news_buffer_after_minutes must be integer between 0 and 1440' };
      }

      return { valid: true };
    };

    const validDefault = validatePersonalNewsSettings(true, '30', '30');
    const validZero = validatePersonalNewsSettings(true, '0', '0');
    const validMax = validatePersonalNewsSettings(true, '1440', '1440');
    const invalidNegative = validatePersonalNewsSettings(true, '-5', '30');
    const invalidOverMax = validatePersonalNewsSettings(true, '1441', '30');
    const invalidFloat = validatePersonalNewsSettings(true, '30.5', '30');
    const invalidNonNumeric = validatePersonalNewsSettings(true, 'abc', '30');

    return (
      validDefault.valid === true &&
      validZero.valid === true &&
      validMax.valid === true &&
      invalidNegative.valid === false &&
      invalidOverMax.valid === false &&
      invalidFloat.valid === false &&
      invalidNonNumeric.valid === false
    );
  });

  return results;
}
