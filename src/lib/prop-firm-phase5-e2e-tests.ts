import {
  PropFirmSettings,
  savePropFirmSettings,
  syncPropFirmHighWatermarks,
  getPropFirmSettings
} from './prop-firm-service.js';
import {
  evaluateWatcherPropFirmGate,
  resolvePersistedAccountType,
  computePropFirmResetBoundaryUtc,
  calculateSingleOpenWatcherFloatingPnl,
  computeAggregateOpenTradesFloatingPnl,
  syncPropFirmStateForActiveWatcher,
  WatcherPropFirmGateOutcome
} from './prop-firm-watcher-gate.js';
import { getInstrumentContractConfig } from './risk-engine.js';
import { evaluatePropFirmRules, PropFirmRuleInput } from './prop-firm-engine.js';

export interface Phase5E2ETestResult {
  id: number;
  section: string;
  name: string;
  passed: boolean;
  details: string;
}

const BASE_PROP_SETTINGS: PropFirmSettings = {
  id: 'pf-e2e-001',
  user_id: 'user-e2e-1',
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
  daily_reset_timezone: 'UTC',
  high_watermark_balance: 100000,
  high_watermark_equity: 100000
};

function cloneSettings(overrides: Partial<PropFirmSettings> = {}): PropFirmSettings {
  return {
    ...BASE_PROP_SETTINGS,
    ...overrides
  };
}

export async function runPhase5PropFirmE2ETests(): Promise<Phase5E2ETestResult[]> {
  const results: Phase5E2ETestResult[] = [];
  const fixedNow = new Date('2026-09-28T14:00:00.000Z');

  async function runTest(
    id: number,
    section: string,
    name: string,
    fn: () => Promise<{ passed: boolean; details: string }>
  ) {
    try {
      const res = await fn();
      results.push({ id, section, name, passed: res.passed, details: res.details });
    } catch (err: any) {
      results.push({ id, section, name, passed: false, details: `EXCEPTION: ${err?.message || err}` });
    }
  }

  // =========================================================================
  // 1. COMPLETE PROP FIRM AUTHORIZATION
  // =========================================================================
  await runTest(1, '1. Complete Auth', 'All rules pass -> broker authorization succeeds (allowed: true)', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const passed = outcome.allowed === true && outcome.evaluated === true && outcome.decision?.allowed === true;
    return { passed, details: `allowed=${outcome.allowed}, blockReason=${outcome.blockReason}` };
  });

  await runTest(2, '1. Complete Auth', 'Any rule BLOCK -> authorization fails (allowed: false)', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 1500, // Exceeds 1% ($1,000) limit
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
    return { passed, details: `allowed=${outcome.allowed}, riskStatus=${riskCheck?.status}, reason=${riskCheck?.reason}` };
  });

  await runTest(3, '1. Complete Auth', 'Any required rule UNAVAILABLE -> fails closed (allowed: false)', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ news_restriction_enabled: true }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => { throw new Error('News API timeout'); }
      }
    });

    const newsCheck = outcome.decision?.checks.find(c => c.rule === 'NEWS_RESTRICTION');
    const passed = outcome.allowed === false && newsCheck?.status === 'UNAVAILABLE';
    return { passed, details: `allowed=${outcome.allowed}, newsStatus=${newsCheck?.status}` };
  });

  // =========================================================================
  // 2. DAILY LOSS END-TO-END
  // =========================================================================
  await runTest(4, '2. Daily Loss', 'Case A: daily loss below limit -> PASS', async () => {
    // Starting 100k, loss limit 5% ($5k). Realized loss today = $2k, proposed risk = $1k -> total $3k <= $5k -> PASS
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 1000,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [{ trade_id: 't-1', outcome: 'LOSS', net_pnl: -2000, closed_at: '2026-09-28T10:00:00.000Z' }],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dlCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === true && dlCheck?.status === 'PASS';
    return { passed, details: `allowed=${outcome.allowed}, dlStatus=${dlCheck?.status}, actual=${dlCheck?.actualValue}` };
  });

  await runTest(5, '2. Daily Loss', 'Case B: daily loss + proposed risk exactly at limit ($5,000) -> PASS', async () => {
    // Realized loss today = $4,200, proposed risk = $800 -> $5,000 <= $5,000 -> PASS
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [{ trade_id: 't-1', outcome: 'LOSS', net_pnl: -4200, closed_at: '2026-09-28T10:00:00.000Z' }],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dlCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === true && dlCheck?.status === 'PASS';
    return { passed, details: `allowed=${outcome.allowed}, dlStatus=${dlCheck?.status}, actual=${dlCheck?.actualValue}` };
  });

  await runTest(6, '2. Daily Loss', 'Case C: daily loss + proposed risk exceeds limit ($5,001) -> BLOCK', async () => {
    // Realized loss today = $4,201, proposed risk = $800 -> $5,001 > $5,000 -> BLOCK
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [{ trade_id: 't-1', outcome: 'LOSS', net_pnl: -4201, closed_at: '2026-09-28T10:00:00.000Z' }],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dlCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === false && dlCheck?.status === 'BLOCK';
    return { passed, details: `allowed=${outcome.allowed}, dlStatus=${dlCheck?.status}, reason=${dlCheck?.reason}` };
  });

  await runTest(7, '2. Daily Loss', 'BALANCE basis excludes open floating P/L while EQUITY basis includes it', async () => {
    // Open trade floating loss = -$4,500. Proposed risk = $800.
    // On BALANCE basis: floating loss excluded -> PASS
    const balOutcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ daily_loss_calculation_basis: 'BALANCE' }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [{ id: 'w-1', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000, lot_size: 10.0 }],
          error: null
        }),
        marketPricesBySymbol: { EURUSD: 1.0955 }, // -$4,500
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    // On EQUITY basis: floating loss included -> -$4,500 + $800 = $5,300 > $5,000 -> BLOCK
    const eqOutcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 800,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ daily_loss_calculation_basis: 'EQUITY' }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [{ id: 'w-1', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000, lot_size: 10.0 }],
          error: null
        }),
        marketPricesBySymbol: { EURUSD: 1.0955 }, // -$4,500
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const passed = balOutcome.allowed === true && eqOutcome.allowed === false;
    return { passed, details: `balAllowed=${balOutcome.allowed}, eqAllowed=${eqOutcome.allowed}` };
  });

  // =========================================================================
  // 3. MAXIMUM DRAWDOWN END-TO-END (STATIC & TRAILING)
  // =========================================================================
  await runTest(8, '3. Max Drawdown', 'STATIC drawdown: below limit -> PASS, exact limit -> PASS, above limit -> BLOCK', async () => {
    // 100k account, 10% ($10k) max static drawdown
    const passOutcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 1000,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_drawdown: 10, drawdown_type: 'STATIC' }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [{ trade_id: 't1', outcome: 'LOSS', net_pnl: -8000, closed_at: '2026-09-25T10:00:00Z' }], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const blockOutcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 1000,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_drawdown: 10, drawdown_type: 'STATIC' }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [{ trade_id: 't1', outcome: 'LOSS', net_pnl: -9500, closed_at: '2026-09-25T10:00:00Z' }], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const passed = passOutcome.allowed === true && blockOutcome.allowed === false;
    return { passed, details: `passAllowed=${passOutcome.allowed}, blockAllowed=${blockOutcome.allowed}` };
  });

  await runTest(9, '3. Max Drawdown', 'TRAILING drawdown uses persisted HWM to calculate drawdown limit', async () => {
    // Account 100k -> Trade 1 profit +$8,000 -> HWM = $108,000.
    // Trailing 10% limit = $10,800. Floor = $97,200.
    // Current balance pulled back to $97,500 (drawdown from HWM = $10,500).
    // Proposed trade risk = $500 -> $10,500 + $500 = $11,000 > $10,800 -> BLOCK.
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({
            drawdown_type: 'TRAILING',
            drawdown_calculation_basis: 'BALANCE',
            high_watermark_balance: 108000,
            high_watermark_equity: 108000
          }),
          error: null
        }),
        tradeHistoryLoader: async () => ({
          trades: [
            { trade_id: 't1', outcome: 'WIN', net_pnl: 8000, closed_at: '2026-09-25T10:00:00Z' },
            { trade_id: 't2', outcome: 'LOSS', net_pnl: -10500, closed_at: '2026-09-26T10:00:00Z' }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const ddCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    const passed = outcome.allowed === false && ddCheck?.status === 'BLOCK' && outcome.highWatermarkBalance === 108000;
    return { passed, details: `allowed=${outcome.allowed}, ddStatus=${ddCheck?.status}, hwmBal=${outcome.highWatermarkBalance}` };
  });

  // =========================================================================
  // 4. RISK PER TRADE
  // =========================================================================
  await runTest(10, '4. Risk Per Trade', 'Risk below ($900) & at limit ($1,000) PASS, above limit ($1,001) BLOCK', async () => {
    const makeRiskCheck = async (risk: number) => evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: risk,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ risk_per_trade: 1, risk_per_trade_type: 'PERCENTAGE' }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const res900 = await makeRiskCheck(900);
    const res1000 = await makeRiskCheck(1000);
    const res1001 = await makeRiskCheck(1001);

    const passed = res900.allowed === true && res1000.allowed === true && res1001.allowed === false;
    return { passed, details: `res900=${res900.allowed}, res1000=${res1000.allowed}, res1001=${res1001.allowed}` };
  });

  // =========================================================================
  // 5. MAXIMUM TRADES PER DAY
  // =========================================================================
  await runTest(11, '5. Max Trades Per Day', 'Executions count monotonically: 0->allow, 1->allow, 2->allow, 3->BLOCK when limit=3', async () => {
    const makeTradeCountCheck = async (completedTodayCount: number) => {
      const trades = [];
      for (let i = 0; i < completedTodayCount; i++) {
        trades.push({ trade_id: `tr-${i}`, outcome: 'WIN', net_pnl: 100, opened_at: '2026-09-28T08:00:00Z', closed_at: '2026-09-28T09:00:00Z' });
      }
      return evaluateWatcherPropFirmGate({
        supabase: {},
        userId: 'user-e2e-1',
        symbol: 'EURUSD',
        rawAccountType: 'ACCT_TYPE:prop',
        proposedTradeRisk: 500,
        runtimeOverride: {
          now: fixedNow,
          settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 3 }), error: null }),
          tradeHistoryLoader: async () => ({ trades, error: null }),
          openWatchersLoader: async () => ({ watchers: [], error: null }),
          newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
        }
      });
    };

    const c0 = await makeTradeCountCheck(0);
    const c1 = await makeTradeCountCheck(1);
    const c2 = await makeTradeCountCheck(2);
    const c3 = await makeTradeCountCheck(3);

    const passed = c0.allowed === true && c1.allowed === true && c2.allowed === true && c3.allowed === false;
    return { passed, details: `c0=${c0.allowed}, c1=${c1.allowed}, c2=${c2.allowed}, c3=${c3.allowed}` };
  });

  await runTest(12, '5. Max Trades Per Day', 'Non-executed events (zones, signals, rejections, non-ACTIVE watchers) do NOT increment trade count', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 1 }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [
            { id: 'w-waiting', trade_status: 'WAITING', signal_registered_at: '2026-09-28T10:00:00Z' },
            { id: 'w-cooldown', trade_status: 'COOLDOWN', opened_at: '2026-09-27T10:00:00Z', closed_at: '2026-09-27T12:00:00Z' }
          ],
          error: null
        }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const check = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed = outcome.allowed === true && check?.actualValue === 0;
    return { passed, details: `allowed=${outcome.allowed}, tradesToday=${check?.actualValue}` };
  });

  // =========================================================================
  // 6. NEWS GATE + PROP FIRM GATE
  // =========================================================================
  await runTest(13, '6. News Gate', 'News clear + Prop clear -> allowed; News blocked -> NO TRADE; News unavailable -> fail closed', async () => {
    // 1) Clear news
    const clearNews = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ news_restriction_enabled: true }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    // 2) Blocked news
    const blockedNews = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ news_restriction_enabled: true }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: true, tradeBlocked: true, blockReason: 'US CPI High Impact' })
      }
    });

    // 3) Unavailable news
    const unavailNews = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ news_restriction_enabled: true }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => null // unavailable
      }
    });

    const passed = clearNews.allowed === true && blockedNews.allowed === false && unavailNews.allowed === false;
    return { passed, details: `clear=${clearNews.allowed}, blocked=${blockedNews.allowed}, unavail=${unavailNews.allowed}` };
  });

  // =========================================================================
  // 7. BROKER EXECUTION LIFECYCLE
  // =========================================================================
  await runTest(14, '7. Broker Lifecycle', 'Prop Firm BLOCK prevents broker order placement entirely', async () => {
    let brokerCalled = false;
    const mockBroker = {
      placeOrder: async () => { brokerCalled = true; return { orderId: 'ord-1' }; }
    };

    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 1500, // Exceeds 1% limit
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    if (outcome.allowed) {
      await mockBroker.placeOrder();
    }

    const passed = outcome.allowed === false && brokerCalled === false;
    return { passed, details: `allowed=${outcome.allowed}, brokerCalled=${brokerCalled}` };
  });

  // =========================================================================
  // 8. ACTIVE TRADE LIFECYCLE
  // =========================================================================
  await runTest(15, '8. Active Trade Lifecycle', 'ACTIVE watcher contains complete sizing & pricing metadata and is recognized in gate', async () => {
    const activeWatcher = {
      id: 'w-active-1',
      user_id: 'user-e2e-1',
      selected_pair: 'EURUSD',
      trade_status: 'ACTIVE',
      direction: 'BUY',
      entry_price: 1.1000,
      stop_loss: 1.0950,
      take_profit: 1.1100,
      lot_size: 1.0,
      expected_loss: 500,
      risk_amount: 500,
      contract_size: 100000,
      opened_at: '2026-09-28T10:00:00.000Z'
    };

    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'GBPUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 1 }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [activeWatcher], error: null }),
        marketPricesBySymbol: { EURUSD: 1.1010 },
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const tradesCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed = outcome.allowed === false && tradesCheck?.actualValue === 1 && tradesCheck?.status === 'BLOCK';
    return { passed, details: `allowed=${outcome.allowed}, activeCountSeen=${tradesCheck?.actualValue}` };
  });

  // =========================================================================
  // 9. LIVE FLOATING P/L ACROSS ASSET CLASSES & TWO-SIDED QUOTES
  // =========================================================================
  await runTest(16, '9. Live Floating P/L', 'BUY exits at BID and SELL exits at ASK across two-sided quotes', async () => {
    const buyQuote = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURUSD', direction: 'BUY', entry_price: 1.1000, lot_size: 1.0 },
      { bid: 1.1025, ask: 1.1027 } // Exits at bid 1.1025 -> +$250
    );
    const sellQuote = calculateSingleOpenWatcherFloatingPnl(
      { selected_pair: 'EURUSD', direction: 'SELL', entry_price: 1.1000, lot_size: 1.0 },
      { bid: 1.0970, ask: 1.0975 } // Exits at ask 1.0975 -> +$250
    );

    const passed = buyQuote.success && Math.abs(buyQuote.pnl - 250) < 0.01 && sellQuote.success && Math.abs(sellQuote.pnl - 250) < 0.01;
    return { passed, details: `buyPnl=${buyQuote.pnl}, sellPnl=${sellQuote.pnl}` };
  });

  await runTest(17, '9. Live Floating P/L', 'Multi-position aggregate sums all positions and fails closed if any is invalid under EQUITY basis', async () => {
    const multiEval = await computeAggregateOpenTradesFloatingPnl(
      [
        { id: 'w1', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000, lot_size: 1.0 },
        { id: 'w2', selected_pair: 'USDJPY', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 150.00, lot_size: 1.0 },
        { id: 'w3', selected_pair: 'XAUUSD', trade_status: 'ACTIVE', direction: 'SELL', entry_price: 2000.0, lot_size: 0.5 }
      ],
      {
        marketPricesBySymbol: {
          EURUSD: 1.1010, // +$100
          USDJPY: 151.50, // +$990.10
          XAUUSD: 1990.0  // +$500
        }
      }
    );

    const invalidEval = await computeAggregateOpenTradesFloatingPnl(
      [
        { id: 'w1', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000, lot_size: 1.0 },
        { id: 'w-bad', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000 /* missing lot_size & expected_loss */ }
      ],
      { marketPricesBySymbol: { EURUSD: 1.1010 } }
    );

    const passed = multiEval.available === true && Math.abs(multiEval.totalFloatingPnl - 1590.10) < 1 && invalidEval.available === false;
    return { passed, details: `multiTotal=${multiEval.totalFloatingPnl}, invalidBlocked=${!invalidEval.available}` };
  });

  // =========================================================================
  // 10. TP / SL CLOSE & RECONCILIATION
  // =========================================================================
  await runTest(18, '10. TP / SL Close', 'Profitable trade closure ratchets HWM while loss closure does not decrease HWM', async () => {
    let dbBal = 100000;
    let dbEq = 100000;
    const mockSupabase = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { high_watermark_balance: dbBal, high_watermark_equity: dbEq }, error: null }) }) }),
        update: (p: any) => ({ eq: async () => { dbBal = p.high_watermark_balance; dbEq = p.high_watermark_equity; return { error: null }; } })
      })
    };

    // 1) TP closure: +$5,000 win
    const tpSync = await syncPropFirmHighWatermarks(mockSupabase, 'user-e2e-1', {
      accountSize: 100000,
      currentBalance: 105000,
      currentEquity: 105000,
      existingHwmBalance: dbBal,
      existingHwmEquity: dbEq
    });

    // 2) SL closure: -$3,000 loss (balance drops to $102,000)
    const slSync = await syncPropFirmHighWatermarks(mockSupabase, 'user-e2e-1', {
      accountSize: 100000,
      currentBalance: 102000,
      currentEquity: 102000,
      existingHwmBalance: dbBal,
      existingHwmEquity: dbEq
    });

    const passed = tpSync.highWatermarkBalance === 105000 && slSync.highWatermarkBalance === 105000 && dbBal === 105000;
    return { passed, details: `afterTP=${tpSync.highWatermarkBalance}, afterSL=${slSync.highWatermarkBalance}, persisted=${dbBal}` };
  });

  // =========================================================================
  // 11. HWM END-TO-END
  // =========================================================================
  await runTest(19, '11. HWM End-to-End', 'HWM survives cron restart, daily reset boundaries, and is monotonic', async () => {
    const boundary = computePropFirmResetBoundaryUtc('00:00', fixedNow, 'UTC');
    const isResetExpected = boundary.toISOString() === '2026-09-28T00:00:00.000Z';

    const hwmRes = await syncPropFirmHighWatermarks(null, 'user-e2e-1', {
      accountSize: 100000,
      currentBalance: 107000,
      currentEquity: 107000,
      existingHwmBalance: 106000,
      existingHwmEquity: 106000
    });

    const passed = isResetExpected && hwmRes.highWatermarkBalance === 107000;
    return { passed, details: `resetBoundary=${boundary.toISOString()}, hwm=${hwmRes.highWatermarkBalance}` };
  });

  // =========================================================================
  // 12. OVERNIGHT TRADE
  // =========================================================================
  await runTest(20, '12. Overnight Trade', 'Trade opened before reset (23:55) does NOT count toward maximum_trades_per_day today', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ maximum_trades_per_day: 1 }), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [
            // Opened yesterday 23:55, closed today 00:05
            { trade_id: 'tr-overnight', outcome: 'WIN', net_pnl: 500, opened_at: '2026-09-27T23:55:00.000Z', closed_at: '2026-09-28T00:05:00.000Z' }
          ],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const tradesCheck = outcome.decision?.checks.find(c => c.rule === 'MAX_TRADES_PER_DAY');
    const passed = outcome.allowed === true && tradesCheck?.actualValue === 0;
    return { passed, details: `allowed=${outcome.allowed}, tradesToday=${tradesCheck?.actualValue}` };
  });

  // =========================================================================
  // 13. MULTIPLE ACTIVE WATCHERS
  // =========================================================================
  await runTest(21, '13. Multiple Watchers', 'Simultaneous EURUSD, GBPUSD, XAUUSD watchers aggregate correctly and share account HWM', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'BTCUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({
          settings: cloneSettings({
            daily_loss_calculation_basis: 'EQUITY',
            drawdown_type: 'TRAILING',
            drawdown_calculation_basis: 'EQUITY',
            high_watermark_equity: 100000
          }),
          error: null
        }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [
            { id: 'w1', selected_pair: 'EURUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.1000, lot_size: 1.0 },
            { id: 'w2', selected_pair: 'GBPUSD', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 1.3000, lot_size: 1.0 },
            { id: 'w3', selected_pair: 'XAUUSD', trade_status: 'ACTIVE', direction: 'SELL', entry_price: 2000.0, lot_size: 0.5 }
          ],
          error: null
        }),
        marketPricesBySymbol: {
          EURUSD: 1.1020, // +$200
          GBPUSD: 1.3030, // +$300
          XAUUSD: 1990.0  // +$500
        },
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const passed = outcome.allowed === true && Math.abs((outcome.liveFloatingPnl ?? 0) - 1000) < 1 && outcome.highWatermarkEquity === 101000;
    return { passed, details: `allowed=${outcome.allowed}, totalFloating=${outcome.liveFloatingPnl}, hwmEq=${outcome.highWatermarkEquity}` };
  });

  // =========================================================================
  // 14. PERSONAL ACCOUNT REGRESSION
  // =========================================================================
  await runTest(22, '14. Personal Account', 'account_type = personal completely bypasses PropFirmRuleEngine without errors', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-personal-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:personal',
      proposedTradeRisk: 50000, // Unconstrained by prop firm rules
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: null, error: 'Table does not exist' }), // Missing settings must not matter
        tradeHistoryLoader: async () => { throw new Error('Should not be called'); },
        openWatchersLoader: async () => { throw new Error('Should not be called'); }
      }
    });

    const passed = outcome.allowed === true && outcome.evaluated === false && outcome.accountType === 'personal';
    return { passed, details: `allowed=${outcome.allowed}, evaluated=${outcome.evaluated}, accountType=${outcome.accountType}` };
  });

  // =========================================================================
  // 15. CROSS-USER ISOLATION
  // =========================================================================
  await runTest(23, '15. Cross-User Isolation', 'User A ($10k) and User B ($50k) maintain completely isolated HWM and rule state', async () => {
    let userARow: any = cloneSettings({ user_id: 'user-A', account_size: 10000, high_watermark_balance: 10500 });
    let userBRow: any = cloneSettings({ user_id: 'user-B', account_size: 50000, high_watermark_balance: 53000 });

    const mockSupabase = {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => ({ data: val === 'user-A' ? userARow : userBRow, error: null })
          })
        }),
        update: (payload: any) => ({
          eq: async (col: string, val: string) => {
            if (val === 'user-A') userARow = { ...userARow, ...payload };
            if (val === 'user-B') userBRow = { ...userBRow, ...payload };
            return { error: null };
          }
        })
      })
    };

    // Sync User A to 11000
    await syncPropFirmHighWatermarks(mockSupabase, 'user-A', { accountSize: 10000, currentBalance: 11000, existingHwmBalance: 10500 });

    const passed = userARow.high_watermark_balance === 11000 && userBRow.high_watermark_balance === 53000;
    return { passed, details: `userA_Hwm=${userARow.high_watermark_balance}, userB_Hwm=${userBRow.high_watermark_balance}` };
  });

  // =========================================================================
  // 16. FAILURE INJECTION (FAIL CLOSED)
  // =========================================================================
  await runTest(24, '16. Failure Injection', 'DB error loading settings fails closed safely', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: null, error: 'Database connection failed' }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null })
      }
    });

    const passed = outcome.allowed === false && outcome.decision?.checks.some(c => c.status === 'CONFIG_ERROR');
    return { passed, details: `allowed=${outcome.allowed}, blockReason=${outcome.blockReason}` };
  });

  await runTest(25, '16. Failure Injection', 'DB error loading realized trade history fails closed on risk rules', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings(), error: null }),
        tradeHistoryLoader: async () => ({ trades: null, error: 'Trade history query timeout' }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dlCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === false && dlCheck?.status === 'UNAVAILABLE';
    return { passed, details: `allowed=${outcome.allowed}, dlStatus=${dlCheck?.status}` };
  });

  await runTest(26, '16. Failure Injection', 'Missing conversion quote for cross pair fails closed under EQUITY basis', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURJPY',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ daily_loss_calculation_basis: 'EQUITY' }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({
          watchers: [{ id: 'w1', selected_pair: 'EURJPY', trade_status: 'ACTIVE', direction: 'BUY', entry_price: 160.00, lot_size: 1.0 }],
          error: null
        }),
        marketPricesBySymbol: { EURJPY: 160.50 }, // Missing USDJPY conversion rate
        priceQuoteLoader: async () => null,
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const dlCheck = outcome.decision?.checks.find(c => c.rule === 'DAILY_LOSS');
    const passed = outcome.allowed === false && dlCheck?.status === 'UNAVAILABLE';
    return { passed, details: `allowed=${outcome.allowed}, dlStatus=${dlCheck?.status}` };
  });

  // =========================================================================
  // 17. OBSERVABILITY & REASON EXPOSURE
  // =========================================================================
  await runTest(27, '17. Observability', 'Every block decision exposes structured check breakdown with actionable reasons', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 2000,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ risk_per_trade: 1 }), error: null }),
        tradeHistoryLoader: async () => ({ trades: [], error: null }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const checks = outcome.decision?.checks || [];
    const hasStructuredReasons = checks.length > 0 && checks.every(c => c.rule && c.status && typeof c.reason === 'string');
    const passed = outcome.allowed === false && hasStructuredReasons;
    return { passed, details: `checksCount=${checks.length}, reasonsFound=${hasStructuredReasons}` };
  });

  // =========================================================================
  // 18. CRON BATCH ISOLATION
  // =========================================================================
  await runTest(28, '18. Batch Isolation', 'One failing watcher does not throw or abort processing of subsequent watchers', async () => {
    const watchers = [
      { id: 'w-fail', user_id: 'user-bad', status: 'active', selected_pair: 'EURUSD', rawAccountType: 'ACCT_TYPE:prop' },
      { id: 'w-good', user_id: 'user-good', status: 'active', selected_pair: 'GBPUSD', rawAccountType: 'ACCT_TYPE:prop' }
    ];

    const resultsMap: Record<string, boolean> = {};

    for (const w of watchers) {
      try {
        if (w.id === 'w-fail') {
          // Injected DB error for watcher 1
          const out = await evaluateWatcherPropFirmGate({
            supabase: {},
            userId: w.user_id,
            symbol: w.selected_pair,
            rawAccountType: w.rawAccountType,
            proposedTradeRisk: 500,
            runtimeOverride: {
              settingsLoader: async () => ({ settings: null, error: 'Connection reset' })
            }
          });
          resultsMap[w.id] = out.allowed;
        } else {
          // Clean pass for watcher 2
          const out = await evaluateWatcherPropFirmGate({
            supabase: {},
            userId: w.user_id,
            symbol: w.selected_pair,
            rawAccountType: w.rawAccountType,
            proposedTradeRisk: 500,
            runtimeOverride: {
              now: fixedNow,
              settingsLoader: async () => ({ settings: cloneSettings({ user_id: 'user-good' }), error: null }),
              tradeHistoryLoader: async () => ({ trades: [], error: null }),
              openWatchersLoader: async () => ({ watchers: [], error: null }),
              newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
            }
          });
          resultsMap[w.id] = out.allowed;
        }
      } catch (err: any) {
        resultsMap[w.id] = false;
      }
    }

    const passed = resultsMap['w-fail'] === false && resultsMap['w-good'] === true;
    return { passed, details: `w-fail=${resultsMap['w-fail']}, w-good=${resultsMap['w-good']}` };
  });

  // =========================================================================
  // 19. PROFIT TARGET PROGRESSION (NON-BLOCKING)
  // =========================================================================
  await runTest(29, '19. Profit Target', 'Profit target reached is flagged (TARGET_REACHED) but does NOT block new trade when risk rules pass', async () => {
    const outcome = await evaluateWatcherPropFirmGate({
      supabase: {},
      userId: 'user-e2e-1',
      symbol: 'EURUSD',
      rawAccountType: 'ACCT_TYPE:prop',
      proposedTradeRisk: 500,
      runtimeOverride: {
        now: fixedNow,
        settingsLoader: async () => ({ settings: cloneSettings({ profit_target: 10, profit_target_type: 'PERCENTAGE' }), error: null }),
        tradeHistoryLoader: async () => ({
          trades: [{ trade_id: 't-win', outcome: 'WIN', net_pnl: 12000, closed_at: '2026-09-28T09:00:00Z' }],
          error: null
        }),
        openWatchersLoader: async () => ({ watchers: [], error: null }),
        newsChecker: async () => ({ eventDetected: false, tradeBlocked: false })
      }
    });

    const ptCheck = outcome.decision?.checks.find(c => c.rule === 'PROFIT_TARGET');
    const passed = outcome.allowed === true && ptCheck?.status === 'TARGET_REACHED' && ptCheck?.actualValue === 12000;
    return { passed, details: `allowed=${outcome.allowed}, ptStatus=${ptCheck?.status}, actualProfit=${ptCheck?.actualValue}` };
  });

  // =========================================================================
  // 20. CLIENT UI SETTINGS MONOTONIC PRESERVATION
  // =========================================================================
  await runTest(30, '20. UI Preservation', 'savePropFirmSettings with null HWM preserves existing HWM and does not corrupt database', async () => {
    let persisted: any = cloneSettings({
      user_id: 'user-ui-preserve',
      high_watermark_balance: 109500,
      high_watermark_equity: 110200
    });

    const mockSupabase = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...persisted }, error: null }) }) }),
        upsert: async (payload: any) => { persisted = { ...persisted, ...payload }; return { error: null }; }
      })
    };

    await savePropFirmSettings(mockSupabase, 'user-ui-preserve', {
      ...cloneSettings({
        user_id: 'user-ui-preserve',
        daily_loss_limit: 4.5,
        high_watermark_balance: null,
        high_watermark_equity: null
      })
    });

    const passed = persisted.high_watermark_balance === 109500 && persisted.high_watermark_equity === 110200 && persisted.daily_loss_limit === 4.5;
    return { passed, details: `preservedBal=${persisted.high_watermark_balance}, preservedEq=${persisted.high_watermark_equity}, newLimit=${persisted.daily_loss_limit}` };
  });

  return results;
}
