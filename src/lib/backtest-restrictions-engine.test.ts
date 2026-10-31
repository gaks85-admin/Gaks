/**
 * GAKS AI — Phase B2 Historical Restrictions Engine Test Suite
 * Validates deterministic parity for:
 * 1. Historical Market Hours & Weekend Closures (Forex/Gold/Indices vs Crypto)
 * 2. Historical Session Filter with IANA DST-aware timezones (BST/GMT, EDT/EST, Tokyo)
 * 3. Production Quality Gate Loss-Streak Safety Overlay (2 losses -> 80%, 3 losses -> 85%, >=4 losses -> 101%)
 * 4. Production Risk Governor & 4-Hour Stop-Loss Cooldown
 * 5. Prop-Firm Gate (Personal bypass, missing fail-closed, Static & Trailing drawdown, Daily reset)
 * 6. Historical Economic News Gate (NOT AVAILABLE explicit reporting & data interface)
 * 7. Sequential Gate Execution Order without double counting
 */

import {
  isMarketOpenHistorically,
  getActiveMarketSessions,
  evaluateSessionMatch,
  HistoricalRestrictionsGovernor,
  classifyHistoricalTradeOutcome
} from './backtest-restrictions-engine.js';
import { PropFirmSettings } from './prop-firm-service.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (!condition) {
    console.error(`❌ [FAIL] ${testName}`, details !== undefined ? details : '');
    throw new Error(`Assertion failed: ${testName}`);
  } else {
    passedTests++;
    console.log(`✅ [PASS] ${testName}`);
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('GAKS AI — PHASE B2 HISTORICAL RESTRICTIONS TEST SUITE');
  console.log('======================================================\n');

  const makeLossTrade = (id: string, netPnL = -100): any => ({
    id,
    signalId: `sig-${id}`,
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-15T09:00:00Z',
    exitTimestamp: '2026-06-15T10:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0700,
    stopLoss: 1.0700,
    takeProfit: 1.0900,
    lotSize: 0.1,
    riskAmount: 100,
    riskRewardRatio: 1.0,
    grossPnL: netPnL,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL,
    balanceBefore: 10000,
    balanceAfter: 10000 + netPnL,
    exitReason: 'STOP_LOSS'
  });

  // -------------------------------------------------------------------------
  // TEST GROUP 1: Historical Market Hours & Schedules
  // -------------------------------------------------------------------------
  console.log('--- Test Group 1: Historical Market Hours ---');

  // Forex on Saturday afternoon (UTC)
  const forexSaturday = isMarketOpenHistorically('EURUSD', '2026-06-20T14:00:00Z');
  assert(forexSaturday.isOpen === false, 'EURUSD is closed on Saturday');

  // Forex on Wednesday mid-day (UTC)
  const forexWednesday = isMarketOpenHistorically('EURUSD', '2026-06-17T14:00:00Z');
  assert(forexWednesday.isOpen === true, 'EURUSD is open on Wednesday');

  // Crypto on Saturday (24/7/365)
  const btcSaturday = isMarketOpenHistorically('BTCUSD', '2026-06-20T14:00:00Z');
  assert(btcSaturday.isOpen === true, 'BTCUSD is open on Saturday (24/7 crypto)');

  // Gold on Sunday before reopening (e.g. 15:00 NY time -> 19:00 UTC)
  // Gold reopens Sunday 18:00 NY (22:00 UTC)
  const goldSundayPreOpen = isMarketOpenHistorically('XAUUSD', '2026-06-21T18:00:00Z');
  assert(goldSundayPreOpen.isOpen === false, 'XAUUSD is closed on Sunday prior to 18:00 NY');

  // -------------------------------------------------------------------------
  // TEST GROUP 2: Historical Sessions & IANA DST Transitions
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 2: Historical Session Detection ---');

  // Summer date (BST in London is UTC+1, EDT in NY is UTC-4)
  // 10:00 UTC => 11:00 London (active), 06:00 NY (not yet active)
  const summerLondonOnly = getActiveMarketSessions('2026-06-15T10:00:00Z');
  assert(summerLondonOnly.includes('London'), 'Summer 10:00 UTC includes London');
  assert(!summerLondonOnly.includes('New York'), 'Summer 10:00 UTC does not include New York (06:00 NY)');

  // 14:00 UTC => 15:00 London (active), 10:00 NY (active)
  const summerOverlap = getActiveMarketSessions('2026-06-15T14:00:00Z');
  assert(summerOverlap.includes('London') && summerOverlap.includes('New York'), 'Summer 14:00 UTC includes both London and NY overlap');

  // Tokyo Session (09:00 - 18:00 Tokyo = 00:00 - 09:00 UTC)
  // 04:00 UTC => 13:00 Tokyo (active)
  const tokyoSession = getActiveMarketSessions('2026-06-15T04:00:00Z');
  assert(tokyoSession.includes('Asian') || tokyoSession.includes('Tokyo'), '04:00 UTC includes Asian/Tokyo session');
  assert(!tokyoSession.includes('London'), '04:00 UTC does not include London');

  // Session rule matching
  const matchLondon = evaluateSessionMatch(['London'], ['London', 'New York']);
  assert(matchLondon.matched === true, 'Strategy session [London] matches active [London, New York]');

  const matchTokyoFail = evaluateSessionMatch(['Tokyo'], ['London']);
  assert(matchTokyoFail.matched === false, 'Strategy session [Tokyo] rejects when only [London] is active');

  // -------------------------------------------------------------------------
  // TEST GROUP 3: Quality Gate with Loss-Streak Safety Overlay
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 3: Quality Gate Loss-Streak Safety ---');

  const govQG = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });

  // Base setup: score 76 with 0 consecutive losses (requires 75)
  const pass0Loss = govQG.evaluateCandidate({
    timestamp: '2026-06-17T14:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 76
  });
  assert(pass0Loss.passed === true, 'Candidate with score 76 passes with 0 consecutive losses');

  // Simulate 2 consecutive losses
  govQG.onTradeClosed({
    id: 't1',
    signalId: 's1',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T14:00:00Z',
    exitTimestamp: '2026-06-17T15:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0780,
    stopLoss: 1.0780,
    takeProfit: 1.0840,
    lotSize: 1.0,
    riskAmount: 200,
    riskRewardRatio: 2.0,
    grossPnL: -200,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -200,
    balanceBefore: 10000,
    balanceAfter: 9800,
    exitReason: 'STOP_LOSS'
  });

  // Advance time past 4-hr cooldown to isolate quality gate
  govQG.onCandle('2026-06-17T20:00:00Z', 9800, 9800);

  govQG.onTradeClosed({
    id: 't2',
    signalId: 's2',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T20:00:00Z',
    exitTimestamp: '2026-06-17T21:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0780,
    stopLoss: 1.0780,
    takeProfit: 1.0840,
    lotSize: 1.0,
    riskAmount: 200,
    riskRewardRatio: 2.0,
    grossPnL: -200,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -200,
    balanceBefore: 9800,
    balanceAfter: 9600,
    exitReason: 'STOP_LOSS'
  });

  // Now consecutive losses = 2. Cooldown expires at 21:00 + 4h = 2026-06-18 01:00.
  // Evaluate at 2026-06-18 02:00:00Z (after cooldown) with score 76 (should fail: needs >= 80)
  const fail2Loss = govQG.evaluateCandidate({
    timestamp: '2026-06-18T02:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 76
  });
  assert(fail2Loss.passed === false && fail2Loss.blockedGate === 'QUALITY_GATE', 'Candidate with score 76 fails under 2-loss streak (requires 80%)');

  // Candidate with score 82 passes under 2-loss streak
  const pass2Loss = govQG.evaluateCandidate({
    timestamp: '2026-06-18T02:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 82
  });
  assert(pass2Loss.passed === true, 'Candidate with score 82 passes under 2-loss streak (threshold 80%)');

  // Simulate 3rd and 4th consecutive loss
  govQG.onTradeClosed({
    id: 't3',
    signalId: 's3',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-18T02:00:00Z',
    exitTimestamp: '2026-06-18T03:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0780,
    stopLoss: 1.0780,
    takeProfit: 1.0840,
    lotSize: 1.0,
    riskAmount: 200,
    riskRewardRatio: 2.0,
    grossPnL: -200,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -200,
    balanceBefore: 9600,
    balanceAfter: 9400,
    exitReason: 'STOP_LOSS'
  });

  govQG.onTradeClosed({
    id: 't4',
    signalId: 's4',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-18T08:00:00Z',
    exitTimestamp: '2026-06-18T09:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0780,
    stopLoss: 1.0780,
    takeProfit: 1.0840,
    lotSize: 1.0,
    riskAmount: 200,
    riskRewardRatio: 2.0,
    grossPnL: -200,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -200,
    balanceBefore: 9400,
    balanceAfter: 9200,
    exitReason: 'STOP_LOSS'
  });

  // Now consecutive losses = 4. Even a score of 98 must be rejected outright (101% requirement)
  const fail4Loss = govQG.evaluateCandidate({
    timestamp: '2026-06-18T15:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 98
  });
  assert(fail4Loss.passed === false && fail4Loss.blockedGate === 'QUALITY_GATE', 'Candidate rejected when consecutive losses >= 4');

  // -------------------------------------------------------------------------
  // TEST GROUP 4: Post-Trade Cooldown (4-Hour Loss vs 5-Minute Win/Breakeven)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 4: Historical Cooldown Parity & State Isolation ---');

  const govCooldown = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });

  // 4A: Trade hits STOP_LOSS at 10:00:00 UTC -> 4-hour cooldown until 14:00:00 UTC
  govCooldown.onTradeClosed({
    id: 't_cd_sl',
    signalId: 's_cd_sl',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T09:00:00Z',
    exitTimestamp: '2026-06-17T10:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0780,
    stopLoss: 1.0780,
    takeProfit: 1.0840,
    lotSize: 1.0,
    riskAmount: 100,
    riskRewardRatio: 2.0,
    grossPnL: -100,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -100,
    balanceBefore: 10000,
    balanceAfter: 9900,
    exitReason: 'STOP_LOSS'
  });

  assert(govCooldown.getCooldownReasonType() === 'LOSS', 'STOP_LOSS sets cooldownReasonType to LOSS');
  const expected4hExpiry = new Date('2026-06-17T10:00:00Z').getTime() + 4 * 60 * 60 * 1000;
  assert(govCooldown.getCooldownUntilTimestamp() === expected4hExpiry, 'STOP_LOSS sets exact 4-hour cooldown timestamp (14:00:00 UTC)');

  // Candidate evaluated 2 hours later (12:00 UTC) -> should be blocked by COOLDOWN
  const cdBlocked = govCooldown.evaluateCandidate({
    timestamp: '2026-06-17T12:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 90
  });
  assert(cdBlocked.passed === false && cdBlocked.blockedGate === 'COOLDOWN', 'Candidate at 2 hours into 4-hour cooldown is blocked');
  assert(cdBlocked.reason?.includes('Active 4-hour post-loss cooldown') === true, 'Reason cites Active 4-hour post-loss cooldown');

  // Candidate evaluated at exact expiry boundary (14:00:00 UTC) -> candleTime >= cooldownUntil -> ALLOWED
  const cdExactExpiry = govCooldown.evaluateCandidate({
    timestamp: '2026-06-17T14:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 90
  });
  assert(cdExactExpiry.passed === true, 'Candidate at exact 4-hour boundary (14:00:00 UTC) passes (exclusive boundary)');

  // 4B: SAME_CANDLE_STOP_LOSS also sets 4-hour cooldown
  govCooldown.onTradeClosed({
    id: 't_cd_scsl',
    signalId: 's_cd_scsl',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T14:15:00Z',
    exitTimestamp: '2026-06-17T14:30:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0780,
    stopLoss: 1.0780,
    takeProfit: 1.0840,
    lotSize: 1.0,
    riskAmount: 100,
    riskRewardRatio: 2.0,
    grossPnL: -100,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -100,
    balanceBefore: 9900,
    balanceAfter: 9800,
    exitReason: 'SAME_CANDLE_STOP_LOSS'
  });
  assert(govCooldown.getCooldownReasonType() === 'LOSS', 'SAME_CANDLE_STOP_LOSS sets cooldownReasonType to LOSS');
  const expectedScslExpiry = new Date('2026-06-17T14:30:00Z').getTime() + 4 * 60 * 60 * 1000;
  assert(govCooldown.getCooldownUntilTimestamp() === expectedScslExpiry, 'SAME_CANDLE_STOP_LOSS sets exact 4-hour cooldown (18:30:00 UTC)');

  // 4C: WIN sets 5-minute cooldown (300,000 ms)
  const govWinCooldown = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });
  govWinCooldown.onTradeClosed({
    id: 't_cd_win',
    signalId: 's_cd_win',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T10:00:00Z',
    exitTimestamp: '2026-06-17T10:10:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0820,
    stopLoss: 1.0790,
    takeProfit: 1.0820,
    lotSize: 1.0,
    riskAmount: 100,
    riskRewardRatio: 2.0,
    grossPnL: 200,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: 200,
    balanceBefore: 10000,
    balanceAfter: 10200,
    exitReason: 'TAKE_PROFIT'
  });
  assert(govWinCooldown.getCooldownReasonType() === 'POST_TRADE', 'WIN sets cooldownReasonType to POST_TRADE');
  const expectedWinExpiry = new Date('2026-06-17T10:10:00Z').getTime() + 5 * 60 * 1000;
  assert(govWinCooldown.getCooldownUntilTimestamp() === expectedWinExpiry, 'WIN sets exact 5-minute cooldown (10:15:00 UTC)');

  // Candidate evaluated 2 minutes into 5-minute WIN cooldown (10:12:00 UTC) -> BLOCKED
  const winCdBlocked = govWinCooldown.evaluateCandidate({
    timestamp: '2026-06-17T10:12:00Z',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'BUY',
    confidence: 85
  });
  assert(winCdBlocked.passed === false && winCdBlocked.blockedGate === 'COOLDOWN', 'Candidate at 2 mins into 5-minute WIN cooldown is blocked');
  assert(winCdBlocked.reason?.includes('Active 5-minute post-trade cooldown') === true, 'Reason cites Active 5-minute post-trade cooldown');

  // Candidate evaluated at exact 5-minute boundary (10:15:00 UTC) -> ALLOWED
  const winCdExactExpiry = govWinCooldown.evaluateCandidate({
    timestamp: '2026-06-17T10:15:00Z',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'BUY',
    confidence: 85
  });
  assert(winCdExactExpiry.passed === true, 'Candidate at exact 5-minute WIN cooldown boundary passes');

  // 4D: BREAKEVEN sets 5-minute cooldown (300,000 ms)
  const govBeCooldown = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });
  govBeCooldown.onTradeClosed({
    id: 't_cd_be',
    signalId: 's_cd_be',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T11:00:00Z',
    exitTimestamp: '2026-06-17T11:05:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0800,
    stopLoss: 1.0790,
    takeProfit: 1.0820,
    lotSize: 1.0,
    riskAmount: 100,
    riskRewardRatio: 2.0,
    grossPnL: 0,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: 0,
    balanceBefore: 10000,
    balanceAfter: 10000,
    exitReason: 'BREAKEVEN'
  });
  assert(govBeCooldown.getCooldownReasonType() === 'POST_TRADE', 'BREAKEVEN sets cooldownReasonType to POST_TRADE');
  const expectedBeExpiry = new Date('2026-06-17T11:05:00Z').getTime() + 5 * 60 * 1000;
  assert(govBeCooldown.getCooldownUntilTimestamp() === expectedBeExpiry, 'BREAKEVEN sets exact 5-minute cooldown (11:10:00 UTC)');

  // Candidate evaluated 3 minutes into 5-minute BREAKEVEN cooldown (11:08:00 UTC) -> BLOCKED
  const beCdBlocked = govBeCooldown.evaluateCandidate({
    timestamp: '2026-06-17T11:08:00Z',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'BUY',
    confidence: 85
  });
  assert(beCdBlocked.passed === false && beCdBlocked.blockedGate === 'COOLDOWN', 'Candidate at 3 mins into 5-minute BREAKEVEN cooldown is blocked');

  // Candidate evaluated at exact 5-minute boundary (11:10:00 UTC) -> ALLOWED
  const beCdExactExpiry = govBeCooldown.evaluateCandidate({
    timestamp: '2026-06-17T11:10:00Z',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'BUY',
    confidence: 85
  });
  assert(beCdExactExpiry.passed === true, 'Candidate at exact 5-minute BREAKEVEN cooldown boundary passes');

  // 4E: State Isolation — reset() completely clears cooldown state
  govBeCooldown.reset();
  assert(govBeCooldown.getCooldownUntilTimestamp() === 0, 'reset() completely resets cooldownUntilTimestamp to 0');
  assert(govBeCooldown.getCooldownReasonType() === 'POST_TRADE', 'reset() resets cooldownReasonType to POST_TRADE');

  // Candidate evaluated immediately at 11:06:00 UTC after reset() passes without cooldown interference
  const afterResetPass = govBeCooldown.evaluateCandidate({
    timestamp: '2026-06-17T11:06:00Z',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'BUY',
    confidence: 85
  });
  assert(afterResetPass.passed === true, 'Candidate immediately after reset() passes without cooldown blockage');

  // 4F: State Isolation — distinct governor instances do not leak cooldown
  const govInstA = new HistoricalRestrictionsGovernor({ initialBalance: 10000, symbol: 'EURUSD' });
  const govInstB = new HistoricalRestrictionsGovernor({ initialBalance: 10000, symbol: 'GBPUSD' });
  govInstA.onTradeClosed({
    ...makeLossTrade('instA-loss'),
    exitTimestamp: '2026-06-17T12:00:00Z'
  });
  assert(govInstA.getCooldownUntilTimestamp() > 0, 'Instance A is in cooldown');
  assert(govInstB.getCooldownUntilTimestamp() === 0, 'Instance B has independent zero cooldown');
  const instBPass = govInstB.evaluateCandidate({
    timestamp: '2026-06-17T12:30:00Z',
    symbol: 'GBPUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 85
  });
  assert(instBPass.passed === true, 'Instance B candidate passes freely despite Instance A active cooldown');

  // -------------------------------------------------------------------------
  // TEST GROUP 5: Prop-Firm Gate (Personal vs Prop, Static & Trailing, Daily Reset)
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 5: Prop-Firm Gate Simulation ---');

  // 5A: Personal account bypasses prop-firm gate completely
  const govPersonal = new HistoricalRestrictionsGovernor({
    initialBalance: 100000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });
  const passPersonal = govPersonal.evaluateCandidate({
    timestamp: '2026-06-17T14:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 85
  });
  assert(passPersonal.passed === true, 'Personal account bypasses prop-firm gate');

  // 5B: Prop firm account with missing settings fails closed
  const govPropMissing = new HistoricalRestrictionsGovernor({
    initialBalance: 100000,
    symbol: 'EURUSD',
    accountType: 'prop',
    propFirmSettings: null
  });
  const failPropMissing = govPropMissing.evaluateCandidate({
    timestamp: '2026-06-17T14:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 85
  });
  assert(failPropMissing.passed === false && failPropMissing.blockedGate === 'PROP_FIRM', 'Prop account with missing settings fails closed');

  // 5C: Prop firm account with STATIC drawdown
  const staticSettings: PropFirmSettings = {
    user_id: 'test-user',
    firm_name: 'FTMO',
    account_phase: '1',
    account_size: 100000,
    daily_loss_limit: 5, // 5% = $5,000
    daily_loss_limit_type: 'PERCENTAGE',
    daily_loss_calculation_basis: 'BALANCE',
    maximum_drawdown: 10, // 10% = $10,000 floor at $90,000
    drawdown_type: 'STATIC',
    drawdown_calculation_basis: 'BALANCE',
    risk_per_trade: 1,
    risk_per_trade_type: 'PERCENTAGE',
    news_restriction_enabled: false,
    news_buffer_before_minutes: 30,
    news_buffer_after_minutes: 30
  };

  const govPropStatic = new HistoricalRestrictionsGovernor({
    initialBalance: 100000,
    symbol: 'EURUSD',
    accountType: 'prop',
    propFirmSettings: staticSettings
  });

  // Simulate a loss dropping balance to $89,500 (below $90,000 floor)
  govPropStatic.onTradeClosed({
    id: 't_breach',
    signalId: 's_breach',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T10:00:00Z',
    exitTimestamp: '2026-06-17T11:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0695,
    stopLoss: 1.0695,
    takeProfit: 1.1000,
    lotSize: 10.0,
    riskAmount: 10500,
    riskRewardRatio: 2.0,
    grossPnL: -10500,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -10500,
    balanceBefore: 100000,
    balanceAfter: 89500,
    exitReason: 'STOP_LOSS'
  });

  // Next day: 2026-06-18T10:00:00Z (daily loss reset to 0, but permanent drawdown breached)
  const staticBreached = govPropStatic.evaluateCandidate({
    timestamp: '2026-06-18T10:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 90
  });
  assert(staticBreached.passed === false && staticBreached.blockedGate === 'PROP_FIRM', 'Prop account with static drawdown breached blocks subsequent trades');

  // 5D: Prop firm account with TRAILING drawdown
  const trailingSettings: PropFirmSettings = {
    ...staticSettings,
    drawdown_type: 'TRAILING'
  };

  const govPropTrailing = new HistoricalRestrictionsGovernor({
    initialBalance: 100000,
    symbol: 'EURUSD',
    accountType: 'prop',
    propFirmSettings: trailingSettings
  });

  // First trade wins: balance reaches $106,000 (high-watermark rises to $106,000)
  govPropTrailing.onTradeClosed({
    id: 't_win',
    signalId: 's_win',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T10:00:00Z',
    exitTimestamp: '2026-06-17T11:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0860,
    stopLoss: 1.0770,
    takeProfit: 1.0860,
    lotSize: 10.0,
    riskAmount: 3000,
    riskRewardRatio: 2.0,
    grossPnL: 6000,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: 6000,
    balanceBefore: 100000,
    balanceAfter: 106000,
    exitReason: 'TAKE_PROFIT'
  });

  // High watermark is now 106,000. Trailing floor is 106,000 - 10,000 = 96,000.
  // Next trade loses $10,500, dropping balance to $95,500 (below $96,000 trailing floor)
  govPropTrailing.onTradeClosed({
    id: 't_trail_loss',
    signalId: 's_trail_loss',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-17T12:00:00Z',
    exitTimestamp: '2026-06-17T13:00:00Z',
    entryPrice: 1.0860,
    exitPrice: 1.0755,
    stopLoss: 1.0755,
    takeProfit: 1.1000,
    lotSize: 10.0,
    riskAmount: 10500,
    riskRewardRatio: 2.0,
    grossPnL: -10500,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -10500,
    balanceBefore: 106000,
    balanceAfter: 95500,
    exitReason: 'STOP_LOSS'
  });

  // Next day: 2026-06-18T10:00:00Z (daily loss reset to 0, trailing drawdown breach active)
  const trailBreached = govPropTrailing.evaluateCandidate({
    timestamp: '2026-06-18T10:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 90
  });
  assert(trailBreached.passed === false && trailBreached.blockedGate === 'PROP_FIRM', 'Trailing drawdown breached when balance drops below trailing watermark floor');

  // -------------------------------------------------------------------------
  // TEST GROUP 6: Economic News Gate & Historical Events Interface
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 6: Economic News Gate ---');

  // Without events: marked NOT AVAILABLE in summary, 0 blocks
  const govNoNews = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal',
    historicalNewsEvents: null
  });
  const summaryNoNews = govNoNews.getSummary();
  assert(summaryNoNews.economicNewsStatus.status === 'NOT_AVAILABLE', 'Summary explicitly reports economic news NOT_AVAILABLE');
  assert(summaryNoNews.rejectionsByGate.economicNews === 0, 'Zero news blocks when no historical dataset provided');

  // With historical events: candle within 30 min window is blocked
  const govWithNews = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal',
    historicalNewsEvents: [
      {
        id: 'news-1',
        title: 'US CPI Release',
        impact: 'HIGH',
        timestamp: '2026-06-17T12:30:00Z'
      }
    ]
  });

  // Candle at 12:45 UTC (15 mins after CPI release, within 30m buffer)
  const newsBlocked = govWithNews.evaluateCandidate({
    timestamp: '2026-06-17T12:45:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 85
  });
  assert(newsBlocked.passed === false && newsBlocked.blockedGate === 'ECONOMIC_NEWS', 'Candidate within ±30m buffer of High-Impact event is blocked');

  // Candle at 13:15 UTC (45 mins after CPI release, outside 30m buffer)
  const newsPassed = govWithNews.evaluateCandidate({
    timestamp: '2026-06-17T13:15:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 85
  });
  assert(newsPassed.passed === true, 'Candidate outside ±30m buffer of High-Impact event passes');

  // -------------------------------------------------------------------------
  // TEST GROUP 7: RESTRICTED_SELECTIVITY Parity & Confidence 80% Threshold
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 7: RESTRICTED_SELECTIVITY Parity ---');

  // Governor with 10 trades and 12% drawdown (>= 10% RESTRICT threshold) but 0 consecutive losses
  const govRestrict = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });

  // Seed 9 trades to reach WEAK sample size tier (totalTrades = 10)
  for (let k = 0; k < 9; k++) {
    govRestrict.onTradeClosed({
      id: `seed-${k}`,
      signalId: `sig-${k}`,
      symbol: 'EURUSD',
      timeframe: 'M15',
      direction: 'LONG',
      entryTimestamp: '2026-06-15T09:00:00Z',
      exitTimestamp: '2026-06-15T09:30:00Z',
      entryPrice: 1.0800,
      exitPrice: 1.0810,
      stopLoss: 1.0790,
      takeProfit: 1.0820,
      lotSize: 0.1,
      riskAmount: 100,
      riskRewardRatio: 2.0,
      grossPnL: 0,
      spreadCost: 0,
      slippageCost: 0,
      commissionCost: 0,
      netPnL: 0,
      balanceBefore: 10000,
      balanceAfter: 10000,
      exitReason: 'BREAKEVEN'
    });
  }

  // 10th trade: Drawdown loss taking balance down to 8800 (12% drawdown) on previous day
  govRestrict.onTradeClosed({
    id: 'seed-dd-loss',
    signalId: 'sig-dd',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-16T09:00:00Z',
    exitTimestamp: '2026-06-16T10:00:00Z',
    entryPrice: 1.0800,
    exitPrice: 1.0680,
    stopLoss: 1.0680,
    takeProfit: 1.1000,
    lotSize: 1.0,
    riskAmount: 1200,
    riskRewardRatio: 2.0,
    grossPnL: -1200,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: -1200,
    balanceBefore: 10000,
    balanceAfter: 8800,
    exitReason: 'TAKE_PROFIT' // exitReason non-SL so cooldown doesn't trigger
  });

  // A winning trade next to reset consecutiveLosses to 0, leaving pure 11.9% drawdown
  govRestrict.onTradeClosed({
    id: 'seed-win-reset',
    signalId: 'sig-win',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'LONG',
    entryTimestamp: '2026-06-16T11:00:00Z',
    exitTimestamp: '2026-06-16T12:00:00Z',
    entryPrice: 1.0680,
    exitPrice: 1.0700,
    stopLoss: 1.0670,
    takeProfit: 1.0700,
    lotSize: 0.1,
    riskAmount: 10,
    riskRewardRatio: 2.0,
    grossPnL: 10,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnL: 10,
    balanceBefore: 8800,
    balanceAfter: 8810,
    exitReason: 'TAKE_PROFIT'
  });

  // Balance is 8810 against peak 10000 -> 11.9% drawdown (>= 10.0% RESTRICT threshold)
  // consecutiveLosses is 0. Quality Gate alone accepts >= 75%.
  // Test 7A: RESTRICTED_SELECTIVITY with confidence 79%: rejected by Risk Governor
  const eval79 = govRestrict.evaluateCandidate({
    timestamp: '2026-06-17T10:00:00Z', // Wednesday 10:00 UTC London
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 79
  });
  assert(eval79.passed === false, 'RESTRICTED_SELECTIVITY with confidence 79% is rejected');
  assert(eval79.blockedGate === 'RISK_GOVERNOR', 'RESTRICTED_SELECTIVITY rejection is attributed to RISK_GOVERNOR');
  assert(eval79.reason?.includes('strict 80% threshold') === true, 'Rejection reason cites strict 80% threshold');

  // Test 7B: RESTRICTED_SELECTIVITY with confidence 80%: allowed
  const eval80 = govRestrict.evaluateCandidate({
    timestamp: '2026-06-17T10:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 80
  });
  assert(eval80.passed === true, 'RESTRICTED_SELECTIVITY with confidence 80% is allowed');

  // Test 7C: Drawdown-induced RESTRICTED_SELECTIVITY confirmed with 0 consecutive losses
  assert(govRestrict.getConsecutiveLosses() === 0, 'RESTRICTED_SELECTIVITY was caused by drawdown rather than loss streak');

  // Test 7D: NO_TRADE from Risk Governor is still rejected regardless of confidence
  const govSevereDd = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });
  for (let k = 0; k < 10; k++) {
    govSevereDd.onTradeClosed({
      id: `sev-${k}`,
      signalId: `sig-${k}`,
      symbol: 'EURUSD',
      timeframe: 'M15',
      direction: 'LONG',
      entryTimestamp: '2026-06-15T09:00:00Z',
      exitTimestamp: '2026-06-15T09:30:00Z',
      entryPrice: 1.0800,
      exitPrice: 1.0800,
      stopLoss: 1.0790,
      takeProfit: 1.0820,
      lotSize: 0.1,
      riskAmount: 100,
      riskRewardRatio: 2.0,
      grossPnL: k === 9 ? -3000 : 0,
      spreadCost: 0,
      slippageCost: 0,
      commissionCost: 0,
      netPnL: k === 9 ? -3000 : 0,
      balanceBefore: 10000,
      balanceAfter: k === 9 ? 7000 : 10000,
      exitReason: 'TAKE_PROFIT'
    });
  }
  const evalNoTrade = govSevereDd.evaluateCandidate({
    timestamp: '2026-06-17T10:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 95
  });
  assert(evalNoTrade.passed === false && evalNoTrade.blockedGate === 'RISK_GOVERNOR', 'NO_TRADE status still rejects even with 95% confidence');

  // Test 7E: Normal ALLOW result is unchanged
  const govNormal = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });
  const evalNormal = govNormal.evaluateCandidate({
    timestamp: '2026-06-17T10:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 76
  });
  assert(evalNormal.passed === true, 'Normal ALLOW candidate passes with standard confidence (76%)');

  // -------------------------------------------------------------------------
  // TEST GROUP 8: Breakeven Loss-Streak Reset Parity
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 8: Breakeven Loss-Streak Reset Parity ---');

  // Test 8A: Two losses followed by a WIN resets streak to 0
  const govStreakWin = new HistoricalRestrictionsGovernor({ initialBalance: 10000, symbol: 'EURUSD', accountType: 'personal' });
  govStreakWin.onTradeClosed(makeLossTrade('loss-1'));
  govStreakWin.onTradeClosed(makeLossTrade('loss-2'));
  assert(govStreakWin.getConsecutiveLosses() === 2, 'Two losses set consecutiveLosses to 2');
  govStreakWin.onTradeClosed({
    ...makeLossTrade('win-3'),
    exitReason: 'TAKE_PROFIT',
    netPnL: 150,
    balanceAfter: 9950
  });
  assert(govStreakWin.getConsecutiveLosses() === 0, 'Two losses followed by a WIN resets streak to zero');
  assert(govStreakWin.getConsecutiveWins() === 1, 'Winning trade increments consecutiveWins to 1');

  // Test 8B: Two losses followed by a BREAKEVEN resets streak to 0
  const govStreakBE = new HistoricalRestrictionsGovernor({ initialBalance: 10000, symbol: 'EURUSD', accountType: 'personal' });
  govStreakBE.onTradeClosed(makeLossTrade('loss-1'));
  govStreakBE.onTradeClosed(makeLossTrade('loss-2'));
  assert(govStreakBE.getConsecutiveLosses() === 2, 'Two losses set consecutiveLosses to 2 before BREAKEVEN');
  govStreakBE.onTradeClosed({
    ...makeLossTrade('be-3'),
    exitReason: 'BREAKEVEN',
    netPnL: 0,
    balanceAfter: 9800
  });
  assert(govStreakBE.getConsecutiveLosses() === 0, 'Two losses followed by a BREAKEVEN resets streak to zero');
  assert(govStreakBE.getConsecutiveWins() === 0, 'BREAKEVEN does NOT increment consecutiveWins (remains 0)');

  // Test 8C: Two losses followed by a genuine LOSS increments streak to 3
  const govStreak3Loss = new HistoricalRestrictionsGovernor({ initialBalance: 10000, symbol: 'EURUSD', accountType: 'personal' });
  govStreak3Loss.onTradeClosed(makeLossTrade('loss-1'));
  govStreak3Loss.onTradeClosed(makeLossTrade('loss-2'));
  govStreak3Loss.onTradeClosed(makeLossTrade('loss-3', -75));
  assert(govStreak3Loss.getConsecutiveLosses() === 3, 'Two losses followed by a genuine LOSS increments streak to three');

  // Test 8D: A trade with a small negative net PnL is NOT incorrectly classified as breakeven
  const tradeSmallLoss: any = {
    ...makeLossTrade('small-loss'),
    exitReason: 'DATASET_END',
    netPnL: -5.00,
    balanceAfter: 9995
  };
  const classifiedSmallLoss = classifyHistoricalTradeOutcome(tradeSmallLoss);
  assert(classifiedSmallLoss === 'LOSS', 'Trade with -$5.00 net PnL is classified as LOSS, not BREAKEVEN');

  const govSmallLoss = new HistoricalRestrictionsGovernor({ initialBalance: 10000, symbol: 'EURUSD', accountType: 'personal' });
  govSmallLoss.onTradeClosed(makeLossTrade('loss-1'));
  govSmallLoss.onTradeClosed(makeLossTrade('loss-2'));
  govSmallLoss.onTradeClosed(tradeSmallLoss);
  assert(govSmallLoss.getConsecutiveLosses() === 3, 'Small negative loss (-$5.00) increments streak to 3 (does not reset)');

  // Test 8E: Candidate quality threshold parity after breakeven vs after 3 losses
  const evalAfterBE = govStreakBE.evaluateCandidate({
    timestamp: '2026-06-17T15:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 76
  });
  assert(evalAfterBE.passed === true, 'Candidate after BREAKEVEN receives standard 75% quality requirement and passes');

  const evalAfter3Loss = govStreak3Loss.evaluateCandidate({
    timestamp: '2026-06-17T15:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 82
  });
  assert(evalAfter3Loss.passed === false && evalAfter3Loss.blockedGate === 'QUALITY_GATE', 'Candidate after 3 losses receives 85% requirement and fails');

  // -------------------------------------------------------------------------
  // TEST GROUP 9: Sequential Gate Order & Non-Double Counting
  // -------------------------------------------------------------------------
  console.log('\n--- Test Group 9: Gate Short-Circuiting & No Double Counting ---');

  const govNoDouble = new HistoricalRestrictionsGovernor({
    initialBalance: 10000,
    symbol: 'EURUSD',
    accountType: 'personal'
  });

  const evalSat = govNoDouble.evaluateCandidate({
    timestamp: '2026-06-20T12:00:00Z', // Saturday
    symbol: 'EURUSD',
    timeframe: 'M15',
    direction: 'BUY',
    confidence: 50 // Would also fail quality gate if evaluated
  });
  assert(evalSat.passed === false, 'Saturday candidate fails Gate 1');
  assert(evalSat.blockedGate === 'MARKET_HOURS', 'Candidate blocked specifically by MARKET_HOURS');

  const summaryDouble = govNoDouble.getSummary();
  assert(summaryDouble.rejectionsByGate.marketHours === 1, 'Market hours rejection counter is exactly 1');
  assert(summaryDouble.rejectionsByGate.qualityGate === 0, 'Quality gate was short-circuited; rejection count is 0');
  assert(summaryDouble.rejectionsByGate.riskGovernor === 0, 'Risk governor was short-circuited; rejection count is 0');

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`PHASE B2 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('======================================================\n');
}

runTestSuite().catch(err => {
  console.error('Test Suite encountered fatal error:', err);
  process.exit(1);
});

