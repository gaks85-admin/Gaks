import {
  PropFirmSettings,
  savePropFirmSettings,
  syncPropFirmHighWatermarks
} from './prop-firm-service.js';
import {
  evaluateWatcherPropFirmGate,
  resolvePersistedAccountType,
  computePropFirmResetBoundaryUtc,
  calculateSingleOpenWatcherFloatingPnl,
  computeAggregateOpenTradesFloatingPnl
} from './prop-firm-watcher-gate.js';
import { getInstrumentContractConfig, calculatePositionSize } from './risk-engine.js';

export interface Phase3IntegrationTestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const BASE_PROP_SETTINGS: PropFirmSettings = {
  id: 'pf-int-001',
  user_id: 'user-prop-1',
  firm_name: 'FTMO',
  account_phase: 'Phase 1',
  account_size: 100000,
  daily_loss_limit: 5,
  daily_loss_limit_type: 'PERCENTAGE',
  daily_loss_calculation_basis: 'BALANCE',
  maximum_drawdown: 10,
  drawdown_type: 'STATIC',
  drawdown_calculation_basis: 'BALANCE',
  profit_target: 10,
  profit_target_type: 'PERCENTAGE',
  risk_per_trade: 1,
  risk_per_trade_type: 'PERCENTAGE',
  maximum_trades_per_day: 3,
  news_restriction_enabled: true,
  news_buffer_before_minutes: 15,
  news_buffer_after_minutes: 15,
  daily_reset_time: '00:00',
  daily_reset_timezone: 'UTC'
};

function cloneSettings(overrides: Partial<PropFirmSettings> = {}): PropFirmSettings {
  return {
    ...BASE_PROP_SETTINGS,
    ...overrides
  };
}

export async function runPhase3PropFirmIntegrationTests(): Promise<Phase3IntegrationTestResult[]> {
  const results: Phase3IntegrationTestResult[] = [];
  const fixedNow = new Date('2026-09-28T14:00:00.000Z');

  async function runTest(
    id: number,
    name: string,
    fn: () => Promise<{ passed: boolean; details: string }>
  ) {
    try {
      const { passed, details } = await fn();
      results.push({ id, name, passed, details });
    } catch (err: any) {
      results.push({
        id,
        name,
        passed: false,
        details: `Exception thrown: ${err?.message || String(err)}`
      });
    }
  }

  // 1. Personal account bypasses PropFirmRuleEngine completely
  await runTest(1, 'Personal account bypasses PropFirmRuleEngine completely', async () => {
    let settingsLoaderCalled = false;
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-personal-1',
      symbol: 'EURUSD',
      rawAccountType: 'EXECUTION:HYBRID|ANALYSIS:HYBRID|ACCT_TYPE:personal',
      proposedTradeRisk: 2500,
      runtimeOverride: {
        settingsLoader: async () => {
          settingsLoaderCalled = true;
          return { settings: null, error: null };
        }
      }
    });

    const passed =
      outcome.evaluated === false &&
      outcome.accountType === 'personal' &&
      outcome.allowed === true &&
      outcome.decision === null &&
      settingsLoaderCalled === false;

    return {
      passed,
      details: `evaluated=${outcome.evaluated}, accountType=${outcome.accountType}, allowed=${outcome.allowed}, settingsLoaded=${settingsLoaderCalled}`
    };
  });

  // 2. Account type null/missing blocks safely
  await runTest(2, 'Account type null/missing blocks safely', async () => {
    const outcomeNull = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-unconfigured',
      symbol: 'EURUSD',
      rawAccountType: null,
      proposedTradeRisk: 500
    });

    const outcomeLegacyNoAcctType = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-unconfigured-2',
      symbol: 'EURUSD',
      rawAccountType: 'EXECUTION:HYBRID|ANALYSIS:HYBRID',
      proposedTradeRisk: 500
    });

    const passed =
      outcomeNull.evaluated === true &&
      outcomeNull.accountType === null &&
      outcomeNull.allowed === false &&
      outcomeNull.blockReason === 'Account type is not configured.' &&
      outcomeLegacyNoAcctType.allowed === false &&
      outcomeLegacyNoAcctType.accountType === null;

    return {
      passed,
      details: `nullAllowed=${outcomeNull.allowed}, legacyMissingTagAllowed=${outcomeLegacyNoAcctType.allowed}, reason="${outcomeNull.blockReason}"`
    };
  });

  // 3. Prop account with missing prop_firm_settings row blocks with CONFIG_ERROR
  await runTest(3, 'Prop account with missing prop_firm_settings row blocks with CONFIG_ERROR', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-missing',
      symbol: 'EURUSD',
      rawAccountType: 'EXECUTION:HYBRID|ANALYSIS:HYBRID|ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        settingsLoader: async () => ({ settings: null, error: null })
      }
    });

    const configCheck = outcome.decision?.checks.find(c => c.rule === 'CONFIGURATION');
    const passed =
      outcome.evaluated === true &&
      outcome.accountType === 'prop' &&
      outcome.allowed === false &&
      configCheck?.status === 'CONFIG_ERROR';

    return {
      passed,
      details: `allowed=${outcome.allowed}, configStatus=${configCheck?.status}, reason="${outcome.blockReason}"`
    };
  });

  // 4. Prop account with valid settings and all rules passing returns PASS
  await runTest(4, 'Prop account with valid settings and all rules passing returns PASS', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'EXECUTION:HYBRID|ANALYSIS:HYBRID|ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              trade_id: 'tr-1',
              outcome: 'WIN',
              net_pnl: 1500,
              opened_at: '2026-09-27T12:00:00.000Z',
              closed_at: '2026-09-27T15:00:00.000Z',
              created_at: '2026-09-27T12:00:00.000Z'
            },
            {
              trade_id: 'tr-2',
              outcome: 'LOSS',
              net_pnl: -1000,
              opened_at: '2026-09-28T08:00:00.000Z',
              closed_at: '2026-09-28T09:00:00.000Z',
              created_at: '2026-09-28T08:00:00.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({
          eventDetected: false,
          tradeBlocked: false
        })
      }
    });

    const passed =
      outcome.evaluated === true &&
      outcome.accountType === 'prop' &&
      outcome.allowed === true &&
      outcome.decision?.allowed === true;

    return {
      passed,
      details: `allowed=${outcome.allowed}, checks=${outcome.decision?.checks.map(c => `${c.rule}:${c.status}`).join(', ')}`
    };
  });

  // 5. Prop account breaching daily loss returns BLOCK
  await runTest(5, 'Prop account breaching daily loss returns BLOCK', async () => {
    // 5% of dailyStartBalance ($100,000) = $5,000 limit.
    // Realized loss today = -$4,500. Proposed risk = $800 -> $4,500 + $800 = $5,300 > $5,000 -> BLOCK.
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              outcome: 'LOSS',
              net_pnl: -4500,
              opened_at: '2026-09-28T09:00:00.000Z',
              closed_at: '2026-09-28T10:00:00.000Z',
              created_at: '2026-09-28T09:00:00.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dailyCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === false && dailyCheck?.status === 'BLOCK';

    return {
      passed,
      details: `allowed=${outcome.allowed}, dailyStatus=${dailyCheck?.status}, reason="${dailyCheck?.reason}"`
    };
  });

  // 6. Prop account breaching static drawdown returns BLOCK
  await runTest(6, 'Prop account breaching static drawdown returns BLOCK', async () => {
    // Max static drawdown = 10% of $100,000 = $10,000.
    // Prior days loss = -$9,500 -> accountBalance = $90,500 (drawdown = $9,500).
    // Proposed trade risk = $800 -> $9,500 + $800 = $10,300 > $10,000 -> BLOCK.
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              outcome: 'LOSS',
              net_pnl: -9500,
              opened_at: '2026-09-25T09:00:00.000Z',
              closed_at: '2026-09-25T10:00:00.000Z',
              created_at: '2026-09-25T09:00:00.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const ddCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    const passed = outcome.allowed === false && ddCheck?.status === 'BLOCK';

    return {
      passed,
      details: `allowed=${outcome.allowed}, ddStatus=${ddCheck?.status}, reason="${ddCheck?.reason}"`
    };
  });

  // 7. Prop account with TRAILING drawdown and no high watermark returns UNAVAILABLE and blocks
  await runTest(7, 'Prop account with TRAILING drawdown and no high watermark returns UNAVAILABLE and blocks', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({ drawdown_type: 'TRAILING', drawdown_calculation_basis: 'EQUITY' }),
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const ddCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    const passed = outcome.allowed === false && ddCheck?.status === 'UNAVAILABLE';

    return {
      passed,
      details: `allowed=${outcome.allowed}, ddStatus=${ddCheck?.status}, reason="${ddCheck?.reason}"`
    };
  });

  // 8. Prop account breaching risk_per_trade returns BLOCK
  await runTest(8, 'Prop account breaching risk_per_trade returns BLOCK', async () => {
    // Max risk per trade = 1% of $100,000 = $1,000. Proposed trade risk = $1,250 -> BLOCK.
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 1250,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const riskCheck = outcome.decision?.checks.find(c => c.rule === 'RISK_PER_TRADE');
    const passed = outcome.allowed === false && riskCheck?.status === 'BLOCK';

    return {
      passed,
      details: `allowed=${outcome.allowed}, riskStatus=${riskCheck?.status}, reason="${riskCheck?.reason}"`
    };
  });

  // 9. Prop account breaching maximum_trades_per_day returns BLOCK
  await runTest(9, 'Prop account breaching maximum_trades_per_day returns BLOCK', async () => {
    // maximum_trades_per_day = 3. Trades taken today = 2 completed + 1 active = 3 -> BLOCK.
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 3 }), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            { trade_id: 'tr-day-1', outcome: 'WIN', net_pnl: 500, opened_at: '2026-09-28T02:00:00.000Z', closed_at: '2026-09-28T03:00:00.000Z', created_at: '2026-09-28T02:00:00.000Z' },
            { trade_id: 'tr-day-2', outcome: 'LOSS', net_pnl: -500, opened_at: '2026-09-28T05:00:00.000Z', closed_at: '2026-09-28T06:00:00.000Z', created_at: '2026-09-28T05:00:00.000Z' }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({
          watchers: [
            { id: 'w-active-1', active_trade_id: 'tr-day-3', trade_status: 'ACTIVE', opened_at: '2026-09-28T11:00:00.000Z' }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const tradesCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed = outcome.allowed === false && tradesCheck?.status === 'BLOCK' && tradesCheck.actualValue === 3;

    return {
      passed,
      details: `allowed=${outcome.allowed}, tradesStatus=${tradesCheck?.status}, actual=${tradesCheck?.actualValue}, limit=${tradesCheck?.limit}`
    };
  });

  // 10. Prop account blocked by news within configured buffer returns BLOCK
  await runTest(10, 'Prop account blocked by news within configured buffer returns BLOCK', async () => {
    let passedBefore = 0;
    let passedAfter = 0;
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({
            news_restriction_enabled: true,
            news_buffer_before_minutes: 20,
            news_buffer_after_minutes: 10
          }),
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async (_sym, beforeMin, afterMin) => {
          passedBefore = beforeMin;
          passedAfter = afterMin;
          return {
            eventDetected: true,
            eventName: 'US CPI m/m',
            currency: 'USD',
            impact: 'HIGH',
            scheduledAt: '2026-09-28T14:10:00.000Z',
            minutesUntilEvent: 10,
            tradeBlocked: true,
            blockReason: 'NEWS_HARD_PAUSE: HIGH impact event US CPI m/m in 10 minutes'
          };
        }
      }
    });

    const newsCheck = outcome.decision?.checks.find(c => c.rule === 'NEWS_RESTRICTION');
    const passed =
      outcome.allowed === false &&
      newsCheck?.status === 'BLOCK' &&
      passedBefore === 20 &&
      passedAfter === 10;

    return {
      passed,
      details: `allowed=${outcome.allowed}, newsStatus=${newsCheck?.status}, buffers=${passedBefore}m/${passedAfter}m, reason="${newsCheck?.reason}"`
    };
  });

  // 11. Prop account with profit_target reached still returns PASS when risk rules pass
  await runTest(11, 'Prop account with profit_target reached still returns PASS when risk rules pass', async () => {
    // Profit target = 10% of $100,000 = $10,000. Cumulative profit = +$12,000.
    // All risk rules pass -> TARGET_REACHED, decision.allowed = true.
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              outcome: 'WIN',
              net_pnl: 12000,
              opened_at: '2026-09-26T12:00:00.000Z',
              closed_at: '2026-09-26T15:00:00.000Z',
              created_at: '2026-09-26T12:00:00.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const profitCheck = outcome.decision?.checks.find(c => c.rule === 'PROFIT_TARGET');
    const passed =
      outcome.allowed === true &&
      outcome.decision?.allowed === true &&
      profitCheck?.status === 'TARGET_REACHED';

    return {
      passed,
      details: `allowed=${outcome.allowed}, profitTargetStatus=${profitCheck?.status}, actual=${profitCheck?.actualValue}`
    };
  });

  // 12. Prop account with EQUITY basis and open trade fails closed when live floating P/L is unavailable
  await runTest(12, 'Prop account with EQUITY basis and open trade fails closed when floating P/L unavailable', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({ daily_loss_calculation_basis: 'EQUITY' }),
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [{ id: 'w-open', trade_status: 'ACTIVE', opened_at: '2026-09-28T10:00:00.000Z' }],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dailyCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === false && dailyCheck?.status === 'UNAVAILABLE';

    return {
      passed,
      details: `allowed=${outcome.allowed}, dailyStatus=${dailyCheck?.status}, reason="${dailyCheck?.reason}"`
    };
  });

  // 13. Prop account with DB error loading prop_firm_settings fails closed
  await runTest(13, 'Prop account with DB error loading prop_firm_settings fails closed', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        settingsLoader: async () => ({ settings: null, error: 'Connection timeout' })
      }
    });

    const configCheck = outcome.decision?.checks.find(c => c.rule === 'CONFIGURATION');
    const passed =
      outcome.allowed === false &&
      outcome.blockReason === 'Failed to load prop firm settings.' &&
      configCheck?.status === 'CONFIG_ERROR';

    return {
      passed,
      details: `allowed=${outcome.allowed}, configStatus=${configCheck?.status}, reason="${outcome.blockReason}"`
    };
  });

  // 14. Reset boundary calculation respects custom reset_time_utc and daily_reset_timezone
  await runTest(14, 'Reset boundary calculation respects custom reset_time_utc and daily_reset_timezone', async () => {
    const refTime = new Date('2026-09-28T14:00:00.000Z');
    const b1 = computePropFirmResetBoundaryUtc('00:00', refTime);
    const b2 = computePropFirmResetBoundaryUtc('22:00', refTime);
    const b3 = computePropFirmResetBoundaryUtc('12:30', refTime);
    // 00:00 Europe/Prague (CEST = UTC+2 in Sep) -> 2026-09-27T22:00:00.000Z
    const bPrague = computePropFirmResetBoundaryUtc('00:00', refTime, 'Europe/Prague');
    const acctType1 = resolvePersistedAccountType('EXECUTION:HYBRID|ACCT_TYPE:personal');
    const acctType2 = resolvePersistedAccountType('EXECUTION:HYBRID|ACCT_TYPE:prop');

    const passed =
      b1.toISOString() === '2026-09-28T00:00:00.000Z' &&
      b2.toISOString() === '2026-09-27T22:00:00.000Z' &&
      b3.toISOString() === '2026-09-28T12:30:00.000Z' &&
      bPrague.toISOString() === '2026-09-27T22:00:00.000Z' &&
      acctType1 === 'personal' &&
      acctType2 === 'prop';

    return {
      passed,
      details: `00:00->${b1.toISOString()}, 22:00->${b2.toISOString()}, Prague(00:00)->${bPrague.toISOString()}`
    };
  });

  // 15. Trade-count authority: overnight trades opened BEFORE reset boundary do NOT count toward maximum_trades_per_day today
  await runTest(15, 'Overnight trades opened before reset boundary do not count toward maximum_trades_per_day today', async () => {
    // Reset boundary is 2026-09-28T00:00:00.000Z.
    // Trade 1: opened yesterday (2026-09-27T21:00Z), closed today (2026-09-28T04:00Z) with -$500 P/L.
    // Trade 2: active watcher opened yesterday (2026-09-27T23:00Z), still ACTIVE today.
    // Trade 3: executed & completed today (opened 2026-09-28T06:00Z, closed 2026-09-28T08:00Z).
    // With maximum_trades_per_day = 2, only Trade 3 was executed today (tradesTakenToday = 1 < 2 -> PASS).
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 2 }), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              trade_id: 'tr-overnight-closed',
              outcome: 'LOSS',
              net_pnl: -500,
              opened_at: '2026-09-27T21:00:00.000Z',
              closed_at: '2026-09-28T04:00:00.000Z',
              created_at: '2026-09-28T04:00:00.000Z'
            },
            {
              trade_id: 'tr-today-1',
              outcome: 'WIN',
              net_pnl: 800,
              opened_at: '2026-09-28T06:00:00.000Z',
              closed_at: '2026-09-28T08:00:00.000Z',
              created_at: '2026-09-28T08:00:00.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({
          watchers: [
            {
              id: 'w-overnight-open',
              active_trade_id: 'tr-overnight-active',
              trade_status: 'ACTIVE',
              opened_at: '2026-09-27T23:00:00.000Z'
            }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const tradesCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed =
      outcome.allowed === true &&
      tradesCheck?.status === 'PASS' &&
      tradesCheck?.actualValue === 1;

    return {
      passed,
      details: `allowed=${outcome.allowed}, tradesTakenToday=${tradesCheck?.actualValue}, status=${tradesCheck?.status}`
    };
  });

  // 16. Trade-count authority: deduplicates a trade present in both trade_learning and ACTIVE watchers by trade_id
  await runTest(16, 'Deduplicates trade present in both trade_learning and ACTIVE watchers by trade_id', async () => {
    // Same trade 'tr-closing-now' appears in trade_learning (just recorded) and watchers (still marked ACTIVE before COOLDOWN update).
    // Plus 1 other completed trade today ('tr-other-today').
    // Total distinct executed trades today = 2. With maximum_trades_per_day = 3, should PASS (actualValue = 2, not 3).
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 3 }), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              trade_id: 'tr-other-today',
              outcome: 'WIN',
              net_pnl: 600,
              opened_at: '2026-09-28T03:00:00.000Z',
              closed_at: '2026-09-28T05:00:00.000Z'
            },
            {
              trade_id: 'tr-closing-now',
              outcome: 'WIN',
              net_pnl: 700,
              opened_at: '2026-09-28T09:00:00.000Z',
              closed_at: '2026-09-28T13:59:59.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({
          watchers: [
            {
              id: 'w-closing-now',
              active_trade_id: 'tr-closing-now',
              trade_status: 'ACTIVE',
              opened_at: '2026-09-28T09:00:00.000Z'
            }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const tradesCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed =
      outcome.allowed === true &&
      tradesCheck?.status === 'PASS' &&
      tradesCheck?.actualValue === 2;

    return {
      passed,
      details: `allowed=${outcome.allowed}, tradesTakenToday=${tradesCheck?.actualValue}, status=${tradesCheck?.status}`
    };
  });

  // 17. Trade-count authority: watcher_evaluations rows (alerts/signals/rejections) are never queried or counted
  await runTest(17, 'Non-executed evaluations, rejected signals, and non-ACTIVE watchers never count toward maximum_trades_per_day', async () => {
    let watcherEvaluationsQueried = false;
    const mockSupabase = {
      from: (table: string) => {
        if (table === 'watcher_evaluations') {
          watcherEvaluationsQueried = true;
        }
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: [], error: null })
            })
          })
        };
      }
    };

    const outcome = await evaluateWatcherPropFirmGate({
      supabase: mockSupabase,
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 1 }), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            // Active / incomplete learning row should be ignored unless completed
            { trade_id: 'tr-pending', outcome: 'ACTIVE', is_active: true, opened_at: '2026-09-28T10:00:00.000Z' }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({
          watchers: [
            // Watchers in IDLE or COOLDOWN with signal_registered_at today must NOT be counted as active open trades
            { id: 'w-idle', trade_status: 'IDLE', signal_registered_at: '2026-09-28T11:00:00.000Z' },
            { id: 'w-cooldown', trade_status: 'COOLDOWN', opened_at: '2026-09-28T07:00:00.000Z', closed_at: '2026-09-28T08:00:00.000Z' }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const tradesCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed =
      watcherEvaluationsQueried === false &&
      outcome.allowed === true &&
      tradesCheck?.status === 'PASS' &&
      tradesCheck?.actualValue === 0;

    return {
      passed,
      details: `watcherEvaluationsQueried=${watcherEvaluationsQueried}, tradesTakenToday=${tradesCheck?.actualValue}, allowed=${outcome.allowed}`
    };
  });

  // 18. Phase 4A: Persisted HWM ratchets monotonically on BALANCE basis and enforces TRAILING drawdown
  await runTest(18, 'Phase 4A: Persisted HWM ratchets monotonically on BALANCE basis and enforces TRAILING drawdown', async () => {
    // Account size = $100,000, max trailing drawdown = 10% ($10,000).
    // Trade 1: +$6,000 win -> balance peaks at $106,000 -> HWM balance ratchets to $106,000.
    // Trade 2: -$9,500 loss -> current balance = $96,500 (drawdown from HWM = $9,500).
    // Proposed risk = $800 -> $9,500 + $800 = $10,300 > $10,000 trailing limit -> BLOCK.
    let persistedHwmBal: number | null = 100000;
    let persistedHwmEq: number | null = 100000;

    const mockSupabase = {
      from: (table: string) => ({
        update: (payload: any) => ({
          eq: async () => {
            if (table === 'prop_firm_settings') {
              persistedHwmBal = payload.high_watermark_balance;
              persistedHwmEq = payload.high_watermark_equity;
            }
            return { error: null };
          }
        })
      })
    };

    const outcome = await evaluateWatcherPropFirmGate({
      supabase: mockSupabase,
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({
            drawdown_type: 'TRAILING',
            drawdown_calculation_basis: 'BALANCE',
            high_watermark_balance: persistedHwmBal,
            high_watermark_equity: persistedHwmEq
          }),
          error: null
        }),
        tradeHistoryLoader: async () => ({
          trades: [
            {
              trade_id: 'tr-peak',
              outcome: 'WIN',
              net_pnl: 6000,
              opened_at: '2026-09-26T10:00:00.000Z',
              closed_at: '2026-09-26T12:00:00.000Z'
            },
            {
              trade_id: 'tr-pullback',
              outcome: 'LOSS',
              net_pnl: -9500,
              opened_at: '2026-09-27T10:00:00.000Z',
              closed_at: '2026-09-27T12:00:00.000Z'
            }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const ddCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    const passed =
      outcome.allowed === false &&
      ddCheck?.status === 'BLOCK' &&
      outcome.highWatermarkBalance === 106000 &&
      persistedHwmBal === 106000;

    return {
      passed,
      details: `allowed=${outcome.allowed}, ddStatus=${ddCheck?.status}, hwmBalance=${outcome.highWatermarkBalance}, actualDd=${ddCheck?.actualValue}`
    };
  });

  // 19. Phase 4A: Live floating unrealized P/L on open trade enforces EQUITY daily loss & TRAILING equity drawdown
  await runTest(19, 'Phase 4A: Live floating unrealized P/L on open trade enforces EQUITY daily loss and TRAILING equity HWM', async () => {
    // Open BUY trade on EURUSD: entry = 1.1000, currentMarketPrice = 1.0955 (-45 pips), lot_size = 10.0 ($100/pip) -> -$4,500 floating P/L.
    // Daily loss limit = 5% of $100,000 = $5,000 on EQUITY basis.
    // Proposed trade risk = $800 -> $4,500 floating loss + $800 proposed risk = $5,300 > $5,000 -> BLOCK.
    const outcomeBlock = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      currentMarketPrice: 1.0955,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({
            daily_loss_calculation_basis: 'EQUITY',
            drawdown_type: 'TRAILING',
            drawdown_calculation_basis: 'EQUITY',
            high_watermark_balance: 100000,
            high_watermark_equity: 100000
          }),
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [
            {
              id: 'w-open-eurusd',
              selected_pair: 'EURUSD',
              trade_status: 'ACTIVE',
              direction: 'BUY',
              entry_price: 1.1000,
              stop_loss: 1.0950,
              lot_size: 10.0,
              opened_at: '2026-09-28T10:00:00.000Z'
            }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    // When open trade is in profit (+20 pips at 10.0 lots -> +$2,000 floating P/L), HWM equity ratchets to $102,000 and trade is ALLOWED
    const outcomePass = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-prop-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      currentMarketPrice: 1.1020,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({
            daily_loss_calculation_basis: 'EQUITY',
            drawdown_type: 'TRAILING',
            drawdown_calculation_basis: 'EQUITY',
            high_watermark_balance: 100000,
            high_watermark_equity: 100000
          }),
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [
            {
              id: 'w-open-eurusd',
              selected_pair: 'EURUSD',
              trade_status: 'ACTIVE',
              direction: 'BUY',
              entry_price: 1.1000,
              stop_loss: 1.0950,
              lot_size: 10.0,
              opened_at: '2026-09-28T10:00:00.000Z'
            }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dailyCheckBlock = outcomeBlock.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed =
      outcomeBlock.allowed === false &&
      dailyCheckBlock?.status === 'BLOCK' &&
      Math.abs((outcomeBlock.liveFloatingPnl ?? 0) - -4500) < 1 &&
      outcomePass.allowed === true &&
      Math.abs((outcomePass.liveFloatingPnl ?? 0) - 2000) < 1 &&
      outcomePass.highWatermarkEquity === 102000;

    return {
      passed,
      details: `blockAllowed=${outcomeBlock.allowed} (floating=${outcomeBlock.liveFloatingPnl}), passAllowed=${outcomePass.allowed} (floating=${outcomePass.liveFloatingPnl}, hwmEq=${outcomePass.highWatermarkEquity})`
    };
  });

  // 20. Phase 4B Concurrency Audit: Concurrent HWM updates never allow a lower observation to overwrite a higher HWM
  await runTest(20, 'Phase 4B: Concurrent HWM updates serialize atomically so lower observation (10050) never overwrites higher peak (10100)', async () => {
    let dbRow: any = {
      user_id: 'user-concurrent-1',
      account_size: 10000,
      high_watermark_balance: 10000,
      high_watermark_equity: 10000
    };

    const mockSupabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              await new Promise(r => setTimeout(r, 5));
              return { data: table === 'prop_firm_settings' ? { ...dbRow } : null, error: null };
            }
          })
        }),
        update: (payload: any) => ({
          eq: async () => {
            await new Promise(r => setTimeout(r, 5));
            if (table === 'prop_firm_settings') {
              dbRow = { ...dbRow, ...payload };
            }
            return { error: null };
          }
        })
      })
    };

    // Watcher A observes 10100 while Watcher B concurrently observes 10050 (both starting from stale snapshot 10000)
    const [resA, resB] = await Promise.all([
      syncPropFirmHighWatermarks(mockSupabase, 'user-concurrent-1', {
        accountSize: 10000,
        currentBalance: 10100,
        currentEquity: 10100,
        existingHwmBalance: 10000,
        existingHwmEquity: 10000
      }),
      syncPropFirmHighWatermarks(mockSupabase, 'user-concurrent-1', {
        accountSize: 10000,
        currentBalance: 10050,
        currentEquity: 10050,
        existingHwmBalance: 10000,
        existingHwmEquity: 10000
      })
    ]);

    const passed =
      dbRow.high_watermark_balance === 10100 &&
      dbRow.high_watermark_equity === 10100 &&
      resB.highWatermarkBalance === 10100 &&
      resB.highWatermarkEquity === 10100 &&
      resA.highWatermarkBalance === 10100;

    return {
      passed,
      details: `finalDbBal=${dbRow.high_watermark_balance}, finalDbEq=${dbRow.high_watermark_equity}, resA=${resA.highWatermarkBalance}, resB=${resB.highWatermarkBalance}`
    };
  });

  // 21. Phase 4B Settings Save & Reset Audit: Client settings save preserves HWM unless challenge identity resets
  await runTest(21, 'Phase 4B: savePropFirmSettings preserves existing HWM against null/lower overwrites and only resets on challenge change', async () => {
    let dbRow: any = cloneSettings({
      user_id: 'user-save-audit',
      account_size: 100000,
      firm_name: 'FTMO',
      account_phase: 'Phase 1',
      high_watermark_balance: 104500,
      high_watermark_equity: 105200
    });

    const mockSupabase = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: table === 'prop_firm_settings' ? { ...dbRow } : null, error: null })
          })
        }),
        upsert: async (payload: any) => {
          if (table === 'prop_firm_settings') {
            dbRow = { ...dbRow, ...payload };
          }
          return { error: null };
        }
      })
    };

    // 1) Client UI saves updated daily_loss_limit without HWM fields (or with stale/lower values) -> HWM must stay 104500 / 105200
    await savePropFirmSettings(mockSupabase, 'user-save-audit', {
      ...cloneSettings({
        user_id: 'user-save-audit',
        daily_loss_limit: 4,
        high_watermark_balance: null,
        high_watermark_equity: 100000
      })
    });
    const preservedBal = dbRow.high_watermark_balance;
    const preservedEq = dbRow.high_watermark_equity;

    // 2) User switches to a new challenge phase ('Phase 2') -> HWM resets to starting account_size (100000)
    await savePropFirmSettings(mockSupabase, 'user-save-audit', {
      ...cloneSettings({
        user_id: 'user-save-audit',
        account_phase: 'Phase 2',
        account_size: 100000
      })
    });
    const resetBal = dbRow.high_watermark_balance;
    const resetEq = dbRow.high_watermark_equity;

    const passed =
      preservedBal === 104500 &&
      preservedEq === 105200 &&
      resetBal === 100000 &&
      resetEq === 100000;

    return {
      passed,
      details: `preserved=(${preservedBal}, ${preservedEq}), afterPhaseChangeReset=(${resetBal}, ${resetEq})`
    };
  });

  // 22. Phase 4B Asset-Class Floating P/L Formulas & Two-Sided Quote Audit
  await runTest(22, 'Phase 4B: Floating P/L formulas across USD_QUOTE, USD_BASE, CROSS, Metals, Indices, Crypto & two-sided quotes', async () => {
    // A. Forex USD_QUOTE (EURUSD): 1 lot = 100,000. BUY at 1.1000, two-sided quote { bid: 1.1010, ask: 1.1012 } -> exits at bid (1.1010) -> +$100
    const fxQuoteBuy = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURUSD', direction: 'BUY', entry_price: 1.1000, lot_size: 1.0 },
      { bid: 1.1010, ask: 1.1012 }
    );
    // SELL at 1.1000, two-sided quote { bid: 1.1008, ask: 1.1010 } -> exits at ask (1.1010) -> -$100
    const fxQuoteSell = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURUSD', direction: 'SELL', entry_price: 1.1000, lot_size: 1.0 },
      { bid: 1.1008, ask: 1.1010 }
    );

    // B. Forex USD_BASE (USDJPY): 1 lot = 100,000. BUY at 150.00, exit at 151.50 -> +150,000 JPY / 151.50 = +$990.0990
    const fxBaseBuy = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'USDJPY', direction: 'BUY', entry_price: 150.00, lot_size: 1.0 },
      151.50
    );

    // C. Forex CROSS (EURGBP -> quote GBP -> DIRECT GBPUSD = 1.2500): 1 lot BUY at 0.8500, exit at 0.8520 -> +200 GBP * 1.25 = +$250
    const fxCrossDirect = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURGBP', direction: 'BUY', entry_price: 0.8500, lot_size: 1.0 },
      0.8520,
      { crossQuotePrice: 1.2500 }
    );
    // Forex CROSS (EURJPY -> quote JPY -> INVERSE USDJPY = 150.00): 1 lot SELL at 162.00, exit at 160.50 -> +150,000 JPY / 150 = +$1,000
    const fxCrossInverse = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURJPY', direction: 'SELL', entry_price: 162.00, lot_size: 1.0 },
      160.50,
      { crossQuotePrice: 150.00 }
    );
    // Forex CROSS without conversion rate and without expected_loss must fail closed
    const fxCrossMissingRate = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURGBP', direction: 'BUY', entry_price: 0.8500, lot_size: 1.0 },
      0.8520
    );

    // D. Metals (XAUUSD contract=100, XAGUSD contract=5000)
    const goldBuy = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'XAUUSD', direction: 'BUY', entry_price: 2000.0, lot_size: 0.5 },
      2010.0 // +$10 * 0.5 * 100 = +$500
    );
    const silverSell = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'XAGUSD', direction: 'SELL', entry_price: 25.0, lot_size: 0.2 },
      24.5 // +$0.5 * 0.2 * 5000 = +$500
    );

    // E. Indices (NAS100 contract=1 USD_QUOTE, GER40 contract=1 EUR CROSS)
    const nasBuy = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'NAS100', direction: 'BUY', entry_price: 18000, lot_size: 2.0 },
      18050 // +50 * 2 * 1 = +$100
    );
    const ger40Buy = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'GER40', direction: 'BUY', entry_price: 18000, lot_size: 1.0 },
      18100, // +100 EUR * 1.10 EURUSD = +$110
      { crossQuotePrice: 1.10 }
    );

    // F. Crypto (BTCUSD contract=1 USD_QUOTE)
    const btcSell = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'BTCUSD', direction: 'SELL', entry_price: 65000, lot_size: 0.1 },
      64000 // +1000 * 0.1 * 1 = +$100
    );

    // G. Unknown symbol fails closed
    const invalidSym = getInstrumentContractConfig('UNKNOWN123', 100);

    const passed =
      fxQuoteBuy.success && Math.abs(fxQuoteBuy.pnl - 100) < 0.01 &&
      fxQuoteSell.success && Math.abs(fxQuoteSell.pnl - -100) < 0.01 &&
      fxBaseBuy.success && Math.abs(fxBaseBuy.pnl - 990.099) < 0.01 &&
      fxCrossDirect.success && Math.abs(fxCrossDirect.pnl - 250) < 0.01 &&
      fxCrossInverse.success && Math.abs(fxCrossInverse.pnl - 1000) < 0.01 &&
      fxCrossMissingRate.success === false &&
      goldBuy.success && Math.abs(goldBuy.pnl - 500) < 0.01 &&
      silverSell.success && Math.abs(silverSell.pnl - 500) < 0.01 &&
      nasBuy.success && Math.abs(nasBuy.pnl - 100) < 0.01 &&
      ger40Buy.success && Math.abs(ger40Buy.pnl - 110) < 0.01 &&
      btcSell.success && Math.abs(btcSell.pnl - 100) < 0.01 &&
      invalidSym.isValid === false;

    return {
      passed,
      details: `EURUSD=(${fxQuoteBuy.pnl},${fxQuoteSell.pnl}), USDJPY=${fxBaseBuy.pnl}, EURGBP=${fxCrossDirect.pnl}, EURJPY=${fxCrossInverse.pnl}, crossMissingClosed=${!fxCrossMissingRate.success}, XAU=${goldBuy.pnl}, XAG=${silverSell.pnl}, NAS=${nasBuy.pnl}, GER40=${ger40Buy.pnl}, BTC=${btcSell.pnl}`
    };
  });

  // 23. Phase 4B Multi-Position Aggregation & Unrelated risk_amount Fail-Closed Audit
  await runTest(23, 'Phase 4B: Aggregate floating P/L sums multiple open trades and fails closed if only unrelated risk_amount is present', async () => {
    const multiEval = await computeAggregateOpenTradesFloatingPnl(
      [
        { id: 'w-1', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000, lot_size: 1.0 },
        { id: 'w-2', selected_pair: 'XAUUSD', trade_status: 'ACTIVE', direction: 'SELL', entry_price: 2000.0, lot_size: 0.5 }
      ],
      {
        marketPricesBySymbol: {
          EURUSD: 1.1020, // +$200
          XAUUSD: 2006.0  // -$300
        }
      }
    );

    // Watcher with ONLY risk_amount (no lot_size and no expected_loss) MUST fail closed
    const riskAmountOnlyEval = await computeAggregateOpenTradesFloatingPnl(
      [
        {
          id: 'w-no-lot',
          selected_pair: 'EURUSD',
          trade_status: 'ACTIVE',
          direction: 'BUY',
          entry_price: 1.1000,
          stop_loss: 1.0950,
          risk_amount: 1000 // Must NOT be used as position size!
        }
      ],
      {
        marketPricesBySymbol: { EURUSD: 1.0975 }
      }
    );

    const passed =
      multiEval.available === true &&
      Math.abs(multiEval.totalFloatingPnl - -100) < 0.01 &&
      riskAmountOnlyEval.available === false &&
      riskAmountOnlyEval.unavailableReasons.length > 0;

    return {
      passed,
      details: `multiAvailable=${multiEval.available}, multiTotal=${multiEval.totalFloatingPnl}, riskAmountOnlyBlocked=${!riskAmountOnlyEval.available}`
    };
  });

  // 24. Prop Firm Position Sizing Authority (FTMO $100k / 0.5% vs legacy $10 / 20%)
  await runTest(24, 'Prop Firm Position Sizing: Authoritative $100k / 0.5% derives exact lot size without legacy influence', async () => {
    // Sizing under Prop Firm parameters ($100k account, 0.5% risk = $500 risk budget)
    const propSizing = calculatePositionSize({
      accountSize: 100000,
      riskPercentage: 0.5,
      entryPrice: 4122.59,
      executedEntry: 4122.59,
      stopLoss: 4142.33,
      geminiTp: 4083.11,
      symbol: 'XAUUSD',
      direction: 'SELL',
      riskRewardStr: '1:2',
      positionMode: 'AUTO_RISK'
    });

    // If legacy $10 / 20% had been used, risk budget would be $2.00 (below min lot -> rejected)
    const legacySizing = calculatePositionSize({
      accountSize: 10,
      riskPercentage: 20,
      entryPrice: 4122.59,
      executedEntry: 4122.59,
      stopLoss: 4142.33,
      geminiTp: 4083.11,
      symbol: 'XAUUSD',
      direction: 'SELL',
      riskRewardStr: '1:2',
      positionMode: 'AUTO_RISK'
    });

    const passed =
      propSizing.accepted === true &&
      propSizing.riskAmount === 500 &&
      propSizing.calculatedLotSize === 0.25 &&
      propSizing.expectedLoss > 490 && propSizing.expectedLoss <= 500 &&
      legacySizing.accepted === false &&
      legacySizing.riskAmount === 2;

    return {
      passed,
      details: `propAccepted=${propSizing.accepted}, propLot=${propSizing.calculatedLotSize}, propExpectedLoss=$${propSizing.expectedLoss}, legacyAccepted=${legacySizing.accepted}`
    };
  });

  // 25. Personal Account Position Sizing Isolation
  await runTest(25, 'Personal Account: Uses trading_preferences without prop firm enforcement', async () => {
    const rawAccountType = 'personal|MODE:AUTO_RISK|LOT:0.01|MAXLOSS:1|ANALYSIS:HYBRID';
    const resolvedType = resolvePersistedAccountType(rawAccountType);

    const personalSizing = calculatePositionSize({
      accountSize: 5000,
      riskPercentage: 1.0,
      entryPrice: 1.1000,
      executedEntry: 1.1000,
      stopLoss: 1.0950,
      geminiTp: 1.1100,
      symbol: 'EURUSD',
      direction: 'BUY',
      riskRewardStr: '1:2',
      positionMode: 'AUTO_RISK'
    });

    const gateOutcome = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-personal-1',
      symbol: 'EURUSD',
      rawAccountType,
      proposedTradeRisk: personalSizing.expectedLoss,
      currentMarketPrice: 1.1000
    });

    const passed =
      resolvedType === 'personal' &&
      personalSizing.accepted === true &&
      gateOutcome.evaluated === false &&
      gateOutcome.accountType === 'personal' &&
      gateOutcome.allowed === true;

    return {
      passed,
      details: `resolvedType=${resolvedType}, personalSizingAccepted=${personalSizing.accepted}, gateEvaluated=${gateOutcome.evaluated}, gateAllowed=${gateOutcome.allowed}`
    };
  });

  // 26. Prop Firm Account with Missing prop_firm_settings Fails Closed
  await runTest(26, 'Prop Firm Account: Missing prop_firm_settings fails closed (never falls back to personal)', async () => {
    const rawAccountType = 'prop|MODE:AUTO_RISK|LOT:0.01|MAXLOSS:1|ANALYSIS:HYBRID';
    const resolvedType = resolvePersistedAccountType(rawAccountType);

    const gateOutcome = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-no-prop-settings',
      symbol: 'XAUUSD',
      rawAccountType,
      proposedTradeRisk: 500,
      currentMarketPrice: 4122.59,
      runtimeOverride: {
        settingsLoader: async () => ({ settings: null, error: 'No prop firm settings found for user.' })
      }
    });

    const passed =
      resolvedType === 'prop' &&
      gateOutcome.evaluated === true &&
      gateOutcome.accountType === 'prop' &&
      gateOutcome.allowed === false &&
      gateOutcome.blockReason?.includes('Failed to load prop firm settings');

    return {
      passed,
      details: `resolvedType=${resolvedType}, gateAllowed=${gateOutcome.allowed}, blockReason=${gateOutcome.blockReason}`
    };
  });

  // 27. Economic News Gate Integration on XAUUSD (Clear vs Blocked vs Unavailable)
  await runTest(27, 'Economic News Gate: Respects configured ±30m buffers on USD/XAU events and fails closed on error', async () => {
    // Case 1: CLEAR news
    const clearGate = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-prop-1',
      symbol: 'XAUUSD',
      rawAccountType: 'prop',
      proposedTradeRisk: 500,
      currentMarketPrice: 4122.59,
      runtimeOverride: {
        settingsLoader: async () => ({
          settings: { ...BASE_PROP_SETTINGS, news_restriction_enabled: true, news_buffer_before_minutes: 30, news_buffer_after_minutes: 30 },
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    // Case 2: BLOCKED news (High impact USD event in 15 mins)
    const blockedGate = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-prop-1',
      symbol: 'XAUUSD',
      rawAccountType: 'prop',
      proposedTradeRisk: 500,
      currentMarketPrice: 4122.59,
      runtimeOverride: {
        settingsLoader: async () => ({
          settings: { ...BASE_PROP_SETTINGS, news_restriction_enabled: true, news_buffer_before_minutes: 30, news_buffer_after_minutes: 30 },
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({
          eventDetected: true,
          tradeBlocked: true,
          eventName: 'US CPI m/m',
          currency: 'USD',
          impact: 'HIGH',
          scheduledAt: new Date(Date.now() + 15 * 60000).toISOString(),
          blockReason: 'NEWS_HARD_PAUSE: HIGH impact event US CPI m/m in 15 minutes'
        })
      }
    });

    // Case 3: UNAVAILABLE news (Throws -> fail closed)
    const unavailableGate = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-prop-1',
      symbol: 'XAUUSD',
      rawAccountType: 'prop',
      proposedTradeRisk: 500,
      currentMarketPrice: 4122.59,
      runtimeOverride: {
        settingsLoader: async () => ({
          settings: { ...BASE_PROP_SETTINGS, news_restriction_enabled: true, news_buffer_before_minutes: 30, news_buffer_after_minutes: 30 },
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => { throw new Error('DB connection lost'); }
      }
    });

    const passed =
      clearGate.allowed === true &&
      blockedGate.allowed === false &&
      blockedGate.blockReason?.includes('NEWS_HARD_PAUSE') &&
      unavailableGate.allowed === false;

    return {
      passed,
      details: `clearAllowed=${clearGate.allowed}, blockedAllowed=${blockedGate.allowed}, unavailableAllowed=${unavailableGate.allowed}`
    };
  });

  return results;
}
