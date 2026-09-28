import {
  adaptNewsCheckToPropFirmGate,
  evaluatePropFirmRules,
  PropFirmRuleInput
} from './prop-firm-engine.js';
import { PropFirmSettings } from './prop-firm-service.js';
import type { EconomicEventResult } from './economic-event-service.js';

export interface TestResult {
  testNumber: number;
  name: string;
  passed: boolean;
  message: string;
}

const baseValidSettings: PropFirmSettings = {
  user_id: 'test-user',
  firm_name: 'FTMO',
  account_phase: 'Phase 1',
  account_size: 100000,
  profit_target: 8,
  profit_target_type: 'PERCENTAGE',
  daily_loss_limit: 5,
  daily_loss_limit_type: 'PERCENTAGE',
  daily_loss_calculation_basis: 'BALANCE',
  daily_reset_time: '00:00',
  daily_reset_timezone: 'UTC',
  maximum_drawdown: 10,
  drawdown_type: 'STATIC',
  drawdown_calculation_basis: 'BALANCE',
  risk_per_trade: 1,
  risk_per_trade_type: 'PERCENTAGE',
  maximum_trades_per_day: 3,
  news_restriction_enabled: false,
  news_buffer_before_minutes: 5,
  news_buffer_after_minutes: 5
};

export function runPropFirmEngineTests(): TestResult[] {
  const results: TestResult[] = [];

  const addTest = (num: number, name: string, fn: () => boolean, failMsg: string) => {
    try {
      const ok = fn();
      results.push({
        testNumber: num,
        name,
        passed: ok,
        message: ok ? 'PASS' : failMsg
      });
    } catch (err: any) {
      results.push({
        testNumber: num,
        name,
        passed: false,
        message: `FAIL (Exception): ${err.message}`
      });
    }
  };

  // ==================================================
  // DAILY LOSS TESTS (1–8)
  // ==================================================

  // 1. Daily loss below limit → ALLOW
  addTest(1, 'Daily loss below limit allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 99000,
      accountEquity: 99000,
      startingAccountSize: 100000,
      currentDailyPnl: -1000, // $1,000 loss < $5,000 limit
      currentDrawdown: 1000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return res.allowed && res.checks.some(c => c.rule === 'DAILY_LOSS' && c.status === 'PASS');
  }, 'Daily loss below limit should allow trade.');

  // 2. Daily loss at limit → BLOCK
  addTest(2, 'Daily loss at limit blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 95000,
      accountEquity: 95000,
      startingAccountSize: 100000,
      currentDailyPnl: -5000, // $5,000 loss == $5,000 limit (5% of $100k)
      currentDrawdown: 5000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'DAILY_LOSS' && c.status === 'BLOCK');
  }, 'Daily loss at limit should block trade.');

  // 3. Proposed risk exceeds remaining daily allowance → BLOCK
  addTest(3, 'Proposed risk exceeds remaining daily loss allowance', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 95300,
      accountEquity: 95300,
      startingAccountSize: 100000,
      currentDailyPnl: -4700, // $300 remaining out of $5,000 limit
      currentDrawdown: 4700,
      proposedTradeRisk: 500, // $500 > $300 remaining
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'DAILY_LOSS' && c.status === 'BLOCK');
  }, 'Proposed risk exceeding remaining daily loss allowance should block.');

  // 4. Percentage daily loss uses start-of-day/account_size reference, NOT shrunk intraday balance
  addTest(4, 'Percentage daily loss uses dailyStartBalance/account_size reference', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 5% daily loss limit
      accountBalance: 95500, // shrunk intraday balance after -$4,500 loss
      accountEquity: 95500,
      dailyStartBalance: 100000, // 5% of $100,000 = $5,000 (NOT 5% of $95,500 = $4,775)
      startingAccountSize: 100000,
      currentDailyPnl: -4500,
      currentDrawdown: 4500,
      proposedTradeRisk: 400, // $4,500 + $400 = $4,900 <= $5,000 (would falsely fail if limit shrunk to $4,775)
      tradesTakenToday: 1
    });
    const dailyCheck = res.checks.find(c => c.rule === 'DAILY_LOSS');
    return res.allowed && dailyCheck?.status === 'PASS' && dailyCheck?.limit === 5000;
  }, 'Percentage daily loss must use start-of-day reference ($5,000), not shrunk intraday balance.');

  // 5. Amount-based daily loss limit
  addTest(5, 'Amount-based daily loss limit blocks when breached', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        daily_loss_limit: 2500,
        daily_loss_limit_type: 'AMOUNT'
      },
      accountBalance: 97800,
      accountEquity: 97800,
      startingAccountSize: 100000,
      currentDailyPnl: -2200,
      currentDrawdown: 2200,
      proposedTradeRisk: 400, // $2,200 + $400 = $2,600 > $2,500
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'DAILY_LOSS' && c.status === 'BLOCK');
  }, 'Amount-based daily loss limit should block when loss + risk > amount limit.');

  // 6. BALANCE basis ignores open floating unrealized loss
  addTest(6, 'BALANCE daily loss basis ignores open floating loss', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        daily_loss_calculation_basis: 'BALANCE',
        drawdown_calculation_basis: 'BALANCE'
      },
      accountBalance: 99000, // $1,000 realized loss today
      accountEquity: 93500, // -$5,500 floating loss open
      startingAccountSize: 100000,
      currentDailyPnl: -1000,
      currentDrawdown: 1000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    const dailyCheck = res.checks.find(c => c.rule === 'DAILY_LOSS');
    return res.allowed && dailyCheck?.status === 'PASS' && dailyCheck?.actualValue === 1500;
  }, 'BALANCE daily loss basis should ignore open floating loss.');

  // 7. EQUITY basis includes floating unrealized loss even when currentDailyPnl === 0
  addTest(7, 'EQUITY daily loss basis counts floating loss when currentDailyPnl === 0', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        daily_loss_calculation_basis: 'EQUITY'
      },
      accountBalance: 100000,
      accountEquity: 94000, // -$6,000 floating loss exceeds $5,000 limit
      startingAccountSize: 100000,
      currentDailyPnl: 0, // 0 realized P/L today
      currentDrawdown: 6000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    const dailyCheck = res.checks.find(c => c.rule === 'DAILY_LOSS');
    return !res.allowed && dailyCheck?.status === 'BLOCK';
  }, 'EQUITY daily loss basis must block when floating loss breaches limit even if currentDailyPnl === 0.');

  // 8. EQUITY basis combines realized daily loss + open floating loss
  addTest(8, 'EQUITY daily loss basis combines realized and floating loss', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        daily_loss_calculation_basis: 'EQUITY'
      },
      accountBalance: 98000, // -$2,000 realized today
      accountEquity: 95200, // -$2,800 floating open -> total -$4,800 equity loss today
      dailyStartEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: -2000,
      currentDrawdown: 4800,
      proposedTradeRisk: 500, // $4,800 + $500 = $5,300 > $5,000 limit
      tradesTakenToday: 1
    });
    const dailyCheck = res.checks.find(c => c.rule === 'DAILY_LOSS');
    return !res.allowed && dailyCheck?.status === 'BLOCK' && dailyCheck?.actualValue === 5300;
  }, 'EQUITY daily loss basis must combine realized daily loss and floating loss.');

  // ==================================================
  // MAXIMUM DRAWDOWN — STATIC & TRAILING TESTS (9–17)
  // ==================================================

  // 9. Static drawdown within limit → ALLOW
  addTest(9, 'Static drawdown within limit allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 10% max drawdown ($10,000)
      accountBalance: 95000,
      accountEquity: 95000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 5000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return res.allowed && res.checks.some(c => c.rule === 'MAX_DRAWDOWN' && c.status === 'PASS');
  }, 'Static drawdown within limit should allow trade.');

  // 10. Static drawdown at/above limit → BLOCK
  addTest(10, 'Static drawdown at or above limit blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 10% max drawdown ($10,000)
      accountBalance: 90000,
      accountEquity: 90000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 10000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'MAX_DRAWDOWN' && c.status === 'BLOCK');
  }, 'Static drawdown at limit should block trade.');

  // 11. Static drawdown + proposedTradeRisk exceeds limit → BLOCK
  addTest(11, 'Static drawdown plus proposedTradeRisk exceeding limit blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 10% max drawdown ($10,000)
      accountBalance: 90400, // $9,600 static drawdown
      accountEquity: 90400,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 9600,
      proposedTradeRisk: 600, // $9,600 + $600 = $10,200 > $10,000
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'MAX_DRAWDOWN' && c.status === 'BLOCK');
  }, 'Static drawdown + proposed risk exceeding limit should block trade.');

  // 12. Static BALANCE vs EQUITY basis produces distinct results
  addTest(12, 'Static drawdown differentiates BALANCE vs EQUITY basis', () => {
    const commonInput: Omit<PropFirmRuleInput, 'settings'> = {
      accountBalance: 95000, // $5,000 balance drawdown (< $10,000 limit)
      accountEquity: 89500, // $10,500 equity drawdown (> $10,000 limit)
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 5000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    };

    const balanceRes = evaluatePropFirmRules({
      ...commonInput,
      settings: {
        ...baseValidSettings,
        drawdown_type: 'STATIC',
        drawdown_calculation_basis: 'BALANCE',
        daily_loss_calculation_basis: 'BALANCE'
      }
    });

    const equityRes = evaluatePropFirmRules({
      ...commonInput,
      settings: {
        ...baseValidSettings,
        drawdown_type: 'STATIC',
        drawdown_calculation_basis: 'EQUITY',
        daily_loss_calculation_basis: 'BALANCE'
      }
    });

    const balDd = balanceRes.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    const eqDd = equityRes.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    return balanceRes.allowed && balDd?.status === 'PASS' && !equityRes.allowed && eqDd?.status === 'BLOCK';
  }, 'Static drawdown must pass on BALANCE ($5k DD) and block on EQUITY ($10.5k DD).');

  // 13. Trailing drawdown within limit → ALLOW
  addTest(13, 'Trailing drawdown within limit allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        drawdown_type: 'TRAILING',
        drawdown_calculation_basis: 'EQUITY',
        maximum_drawdown: 10
      },
      accountBalance: 102000,
      accountEquity: 102000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 3000,
      highWatermarkEquity: 105000, // $3,000 below HWM < $10,000 limit
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return res.allowed && res.checks.some(c => c.rule === 'MAX_DRAWDOWN' && c.status === 'PASS');
  }, 'Trailing drawdown within limit should allow trade.');

  // 14. Trailing drawdown breach → BLOCK
  addTest(14, 'Trailing drawdown breach blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        drawdown_type: 'TRAILING',
        drawdown_calculation_basis: 'EQUITY',
        maximum_drawdown: 10
      },
      accountBalance: 94000,
      accountEquity: 94000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 11000,
      highWatermarkEquity: 105000, // $11,000 below HWM > $10,000 limit
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'MAX_DRAWDOWN' && c.status === 'BLOCK');
  }, 'Trailing drawdown breach should block trade.');

  // 15. Trailing drawdown limit is anchored to account_size (not inflated by HWM * %)
  addTest(15, 'Trailing drawdown limit uses account_size * %, not HWM * %', () => {
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        drawdown_type: 'TRAILING',
        drawdown_calculation_basis: 'EQUITY',
        maximum_drawdown: 10 // 10% of $100,000 = $10,000 (NOT 10% of $120,000 = $12,000)
      },
      accountBalance: 109500,
      accountEquity: 109500,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      highWatermarkEquity: 120000, // HWM = $120k, current = $109.5k -> drawdown from HWM is $10,500 (> $10,000 limit)
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    const ddCheck = res.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    return !res.allowed && ddCheck?.status === 'BLOCK' && ddCheck?.limit === 10000;
  }, 'Trailing drawdown limit must be $10,000 (10% of account_size), blocking $10,500 drawdown from $120k HWM.');

  // 16. Trailing drawdown differentiates BALANCE vs EQUITY basis
  addTest(16, 'Trailing drawdown differentiates BALANCE vs EQUITY basis', () => {
    const balanceRes = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        drawdown_type: 'TRAILING',
        drawdown_calculation_basis: 'BALANCE',
        maximum_drawdown: 10
      },
      accountBalance: 102000, // $3,000 below HWM balance ($105,000) -> PASS
      accountEquity: 94000, // floating drawdown ignored in BALANCE mode
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      highWatermarkBalance: 105000,
      highWatermarkEquity: 105000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });

    const equityRes = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        drawdown_type: 'TRAILING',
        drawdown_calculation_basis: 'EQUITY',
        maximum_drawdown: 10
      },
      accountBalance: 102000,
      accountEquity: 94000, // $11,000 below HWM equity ($105,000) -> BLOCK
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      highWatermarkBalance: 105000,
      highWatermarkEquity: 105000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });

    return (
      balanceRes.allowed &&
      !equityRes.allowed &&
      equityRes.checks.some(c => c.rule === 'MAX_DRAWDOWN' && c.status === 'BLOCK')
    );
  }, 'Trailing drawdown must use highWatermarkBalance - accountBalance in BALANCE mode and highWatermarkEquity - accountEquity in EQUITY mode.');

  // 17. Trailing drawdown without high-watermark → MAX_DRAWDOWN status UNAVAILABLE (NOT CONFIG_ERROR)
  addTest(17, 'Trailing drawdown without high watermark returns UNAVAILABLE', () => {
    const trailingSettings = { ...baseValidSettings, drawdown_type: 'TRAILING' as const };
    const res = evaluatePropFirmRules({
      settings: trailingSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      highWatermarkEquity: null,
      highWatermarkBalance: null,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    const configCheck = res.checks.find(c => c.rule === 'CONFIGURATION');
    const ddCheck = res.checks.find(c => c.rule === 'MAX_DRAWDOWN');
    return !res.allowed && configCheck?.status === 'PASS' && ddCheck?.status === 'UNAVAILABLE';
  }, 'Trailing drawdown without HWM should pass CONFIGURATION and return MAX_DRAWDOWN UNAVAILABLE.');

  // ==================================================
  // RISK PER TRADE TESTS (18–22)
  // ==================================================

  // 18. Risk below maximum → ALLOW
  addTest(18, 'Risk below maximum allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 1% = $1,000
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return res.allowed && res.checks.some(c => c.rule === 'RISK_PER_TRADE' && c.status === 'PASS');
  }, 'Risk below maximum should allow trade.');

  // 19. Risk at maximum → ALLOW
  addTest(19, 'Risk at maximum allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 1% = $1,000
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 1000,
      tradesTakenToday: 1
    });
    return res.allowed && res.checks.some(c => c.rule === 'RISK_PER_TRADE' && c.status === 'PASS');
  }, 'Risk exactly at maximum should allow trade.');

  // 20. Risk above maximum → BLOCK
  addTest(20, 'Risk above maximum blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 1% = $1,000
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 1500,
      tradesTakenToday: 1
    });
    return !res.allowed && res.checks.some(c => c.rule === 'RISK_PER_TRADE' && c.status === 'BLOCK');
  }, 'Risk above maximum should block trade.');

  // 21. Amount-based risk per trade
  addTest(21, 'Amount-based risk per trade enforced accurately', () => {
    const amtSettings: PropFirmSettings = {
      ...baseValidSettings,
      risk_per_trade: 400,
      risk_per_trade_type: 'AMOUNT'
    };
    const passRes = evaluatePropFirmRules({
      settings: amtSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 400,
      tradesTakenToday: 1
    });
    const blockRes = evaluatePropFirmRules({
      settings: amtSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 450,
      tradesTakenToday: 1
    });
    return passRes.allowed && !blockRes.allowed;
  }, 'Amount-based risk per trade should allow <= $400 and block > $400.');

  // 22. Zero, negative, or NaN proposedTradeRisk → BLOCK
  addTest(22, 'Zero, negative, or NaN proposedTradeRisk blocks trade', () => {
    const zeroRes = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 0,
      tradesTakenToday: 1
    });
    const negRes = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: -250,
      tradesTakenToday: 1
    });
    const nanRes = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: Number.NaN,
      tradesTakenToday: 1
    });
    return (
      !zeroRes.allowed &&
      zeroRes.checks.some(c => c.rule === 'RISK_PER_TRADE' && c.status === 'BLOCK') &&
      !negRes.allowed &&
      negRes.checks.some(c => c.rule === 'RISK_PER_TRADE' && c.status === 'BLOCK') &&
      !nanRes.allowed &&
      nanRes.checks.some(c => c.rule === 'RISK_PER_TRADE' && c.status === 'BLOCK')
    );
  }, 'proposedTradeRisk <= 0 or NaN must be blocked.');

  // ==================================================
  // MAXIMUM TRADES PER DAY TESTS (23–26)
  // ==================================================

  // 23. Below maximum trades → ALLOW
  addTest(23, 'Below maximum trades per day allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // max 3
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 2
    });
    return res.allowed && res.checks.some(c => c.rule === 'MAX_TRADES_PER_DAY' && c.status === 'PASS');
  }, 'Trades today below limit should allow trade.');

  // 24. At maximum trades → BLOCK
  addTest(24, 'At maximum trades per day blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // max 3
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 3
    });
    return !res.allowed && res.checks.some(c => c.rule === 'MAX_TRADES_PER_DAY' && c.status === 'BLOCK');
  }, 'Trades today at limit should block trade.');

  // 25. Unconfigured maximum trades (null) → ALLOW
  addTest(25, 'Unconfigured maximum trades per day allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: { ...baseValidSettings, maximum_trades_per_day: null },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 25
    });
    return res.allowed && res.checks.some(c => c.rule === 'MAX_TRADES_PER_DAY' && c.status === 'PASS');
  }, 'Unconfigured maximum trades should allow trade.');

  // 26. Negative, NaN, or fractional tradesTakenToday → BLOCK
  addTest(26, 'Negative, NaN, or fractional tradesTakenToday blocks trade', () => {
    const negRes = evaluatePropFirmRules({
      settings: { ...baseValidSettings, maximum_trades_per_day: null },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: -1
    });
    const fracRes = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1.5
    });
    const nanRes = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: Number.NaN
    });
    return (
      !negRes.allowed &&
      negRes.checks.some(c => c.rule === 'MAX_TRADES_PER_DAY' && c.status === 'BLOCK') &&
      !fracRes.allowed &&
      fracRes.checks.some(c => c.rule === 'MAX_TRADES_PER_DAY' && c.status === 'BLOCK') &&
      !nanRes.allowed &&
      nanRes.checks.some(c => c.rule === 'MAX_TRADES_PER_DAY' && c.status === 'BLOCK')
    );
  }, 'Negative, fractional, or NaN tradesTakenToday must block even when maximum_trades_per_day is null.');

  // ==================================================
  // NEWS RESTRICTION & ADAPTER TESTS (27–31)
  // ==================================================

  // 27. News restriction disabled → ALLOW
  addTest(27, 'News restriction disabled ignores news block', () => {
    const res = evaluatePropFirmRules({
      settings: { ...baseValidSettings, news_restriction_enabled: false },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1,
      newsGateResult: { blocked: true, reason: 'High impact NFP release' }
    });
    return res.allowed && res.checks.some(c => c.rule === 'NEWS_RESTRICTION' && c.status === 'PASS');
  }, 'Disabled news restriction should ignore news block.');

  // 28. News restriction enabled + clear news → ALLOW
  addTest(28, 'News restriction enabled with clear news allows trade', () => {
    const res = evaluatePropFirmRules({
      settings: { ...baseValidSettings, news_restriction_enabled: true },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1,
      newsGateResult: { blocked: false }
    });
    return res.allowed && res.checks.some(c => c.rule === 'NEWS_RESTRICTION' && c.status === 'PASS');
  }, 'Enabled news restriction with clear news should allow trade.');

  // 29. News restriction enabled + blocked news → BLOCK
  addTest(29, 'News restriction enabled with blocked news blocks trade', () => {
    const res = evaluatePropFirmRules({
      settings: { ...baseValidSettings, news_restriction_enabled: true },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1,
      newsGateResult: { blocked: true, reason: 'CPI release window' }
    });
    return !res.allowed && res.checks.some(c => c.rule === 'NEWS_RESTRICTION' && c.status === 'BLOCK');
  }, 'Enabled news restriction with blocked news should block trade.');

  // 30. News restriction enabled + missing newsGateResult → fail closed (UNAVAILABLE)
  addTest(30, 'News restriction enabled with missing newsGateResult fails closed', () => {
    const res = evaluatePropFirmRules({
      settings: { ...baseValidSettings, news_restriction_enabled: true },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1,
      newsGateResult: null
    });
    return !res.allowed && res.checks.some(c => c.rule === 'NEWS_RESTRICTION' && c.status === 'UNAVAILABLE');
  }, 'Enabled news restriction with missing newsGateResult must fail closed.');

  // 31. adaptNewsCheckToPropFirmGate maps EconomicEventResult and buffers accurately
  addTest(31, 'adaptNewsCheckToPropFirmGate maps EconomicEventResult and buffer settings', () => {
    const rawNewsCheck: EconomicEventResult = {
      eventDetected: true,
      eventName: 'FOMC Rate Decision',
      currency: 'USD',
      impact: 'HIGH',
      scheduledAt: '2026-09-28T18:00:00Z',
      minutesUntilEvent: 4,
      tradeBlocked: true,
      blockReason: 'News Gate: USD FOMC in 4m'
    };
    const adapted = adaptNewsCheckToPropFirmGate(rawNewsCheck, {
      news_buffer_before_minutes: 10,
      news_buffer_after_minutes: 15
    });
    const res = evaluatePropFirmRules({
      settings: {
        ...baseValidSettings,
        news_restriction_enabled: true,
        news_buffer_before_minutes: 10,
        news_buffer_after_minutes: 15
      },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1,
      newsGateResult: adapted
    });
    return (
      adapted !== null &&
      adapted.blocked === true &&
      adapted.bufferBeforeMinutes === 10 &&
      adapted.bufferAfterMinutes === 15 &&
      !res.allowed &&
      res.checks.some(
        c => c.rule === 'NEWS_RESTRICTION' && c.status === 'BLOCK' && c.reason === 'News Gate: USD FOMC in 4m'
      )
    );
  }, 'adaptNewsCheckToPropFirmGate should map NewsCheckResult and buffers into PropFirmNewsGateInput.');

  // ==================================================
  // PROFIT TARGET TESTS (32–34)
  // ==================================================

  // 32. Cumulative profit reaches target → TARGET_REACHED
  addTest(32, 'Cumulative profit reaching target reports TARGET_REACHED', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 8% = $8,000 target
      accountBalance: 108500, // $8,500 cumulative profit above $100,000 account_size
      accountEquity: 108500,
      startingAccountSize: 100000,
      currentDailyPnl: 500, // only $500 made today, but cumulative is $8,500
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    const ptCheck = res.checks.find(c => c.rule === 'PROFIT_TARGET');
    return res.allowed && ptCheck?.status === 'TARGET_REACHED' && ptCheck?.actualValue === 8500;
  }, 'Cumulative profit >= target must report TARGET_REACHED even if currentDailyPnl is small.');

  // 33. Daily profit alone cannot falsely report target reached when cumulative profit < target
  addTest(33, 'Intraday profit alone does not falsely trigger TARGET_REACHED', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings, // 8% = $8,000 target
      accountBalance: 102000, // cumulative profit is only $2,000 (recovering from prior $6,500 drawdown)
      accountEquity: 102000,
      startingAccountSize: 100000,
      currentDailyPnl: 8500, // +$8,500 today, but account is only at $102,000 overall
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    const ptCheck = res.checks.find(c => c.rule === 'PROFIT_TARGET');
    return res.allowed && ptCheck?.status === 'TARGET_NOT_REACHED' && ptCheck?.actualValue === 2000;
  }, 'Intraday currentDailyPnl alone must not falsely report TARGET_REACHED when cumulative profit is below target.');

  // 34. Profit target never blocks otherwise valid execution
  addTest(34, 'Profit target reached never blocks valid execution', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 112000,
      accountEquity: 112000,
      startingAccountSize: 100000,
      currentDailyPnl: 2000,
      currentDrawdown: 0,
      currentTotalProfit: 12000,
      proposedTradeRisk: 500,
      tradesTakenToday: 1
    });
    return res.allowed && res.checks.some(c => c.rule === 'PROFIT_TARGET' && c.status === 'TARGET_REACHED');
  }, 'Profit target is informational and must never block valid trades.');

  // ==================================================
  // CONFIGURATION & AGGREGATION TESTS (35–38)
  // ==================================================

  // 35. Missing configuration rejected with CONFIG_ERROR
  addTest(35, 'Missing configuration rejected with CONFIG_ERROR', () => {
    const res = evaluatePropFirmRules({
      settings: null,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 0
    });
    return !res.allowed && res.checks.some(c => c.rule === 'CONFIGURATION' && c.status === 'CONFIG_ERROR');
  }, 'Missing configuration must return CONFIG_ERROR.');

  // 36. Invalid enum rejected with CONFIG_ERROR
  addTest(36, 'Invalid enum value rejected with CONFIG_ERROR', () => {
    const invalidEnumSettings = {
      ...baseValidSettings,
      drawdown_calculation_basis: 'FLOATING' as any
    };
    const res = evaluatePropFirmRules({
      settings: invalidEnumSettings,
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 0
    });
    return !res.allowed && res.checks.some(c => c.rule === 'CONFIGURATION' && c.status === 'CONFIG_ERROR');
  }, 'Invalid enum values in settings must be rejected with CONFIG_ERROR.');

  // 37. NaN, Infinity, negative, or >100% percentage settings rejected with CONFIG_ERROR
  addTest(37, 'NaN, negative, or >100% percentage settings rejected with CONFIG_ERROR', () => {
    const over100Daily = evaluatePropFirmRules({
      settings: { ...baseValidSettings, daily_loss_limit: 150, daily_loss_limit_type: 'PERCENTAGE' },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 0
    });
    const negBuffer = evaluatePropFirmRules({
      settings: { ...baseValidSettings, news_buffer_before_minutes: -5 },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 0
    });
    const nonIntMaxTrades = evaluatePropFirmRules({
      settings: { ...baseValidSettings, maximum_trades_per_day: 2.5 },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 0
    });
    const negProfitTarget = evaluatePropFirmRules({
      settings: { ...baseValidSettings, profit_target: -10 },
      accountBalance: 100000,
      accountEquity: 100000,
      startingAccountSize: 100000,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk: 500,
      tradesTakenToday: 0
    });
    return (
      !over100Daily.allowed &&
      over100Daily.checks.some(c => c.status === 'CONFIG_ERROR') &&
      !negBuffer.allowed &&
      negBuffer.checks.some(c => c.status === 'CONFIG_ERROR') &&
      !nonIntMaxTrades.allowed &&
      nonIntMaxTrades.checks.some(c => c.status === 'CONFIG_ERROR') &&
      !negProfitTarget.allowed &&
      negProfitTarget.checks.some(c => c.status === 'CONFIG_ERROR')
    );
  }, 'Out-of-bounds percentage, negative buffer, non-integer max trades, or negative profit target must fail CONFIG_ERROR.');

  // 38. Multiple failing rules return all relevant failures
  addTest(38, 'Multiple failing rules return all failures', () => {
    const res = evaluatePropFirmRules({
      settings: baseValidSettings,
      accountBalance: 88000, // $12k static drawdown (> $10k limit)
      accountEquity: 88000,
      startingAccountSize: 100000,
      currentDailyPnl: -5500, // daily loss breached (> $5k limit)
      currentDrawdown: 12000,
      proposedTradeRisk: 2500, // risk per trade breached (> $1k limit)
      tradesTakenToday: 4 // max trades breached (4 >= 3)
    });
    const blockCount = res.checks.filter(c => c.status === 'BLOCK').length;
    return !res.allowed && blockCount === 4 && res.reasons.length === 4;
  }, 'Multiple failing rules should all report BLOCK status and populate reasons.');

  return results;
}
