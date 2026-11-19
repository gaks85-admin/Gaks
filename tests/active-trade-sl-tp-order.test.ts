import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateActiveTradeExit,
  evaluateActiveTradeExitWithHistory,
  resolveActiveTradeMonitoringPlan,
  calculatePipsDistance,
  buildActiveTradeTelemetry
} from '../src/lib/active-trade-monitor.js';
import { buildTelegramTradeOutcomeMessage } from '../src/lib/telegram-formatter.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test('GBPUSD SELL spike-then-drop regression: SL (1.31629) hit before TP (1.31345) even when currentPrice is 1.31345', () => {
  const result = evaluateActiveTradeExitWithHistory({
    direction: 'SELL',
    entryPrice: 1.31542,
    stopLoss: 1.31629,
    takeProfit: 1.31345,
    openedAt: '2026-11-19T14:35:00Z',
    currentPrice: 1.31345,
    candles: [
      // Pre-entry wick must be ignored
      { timestamp: '2026-11-19T14:25:00Z', open: 1.31600, high: 1.31705, low: 1.31580, close: 1.31590 },
      // Post-entry bounce below SL
      { timestamp: '2026-11-19T15:00:00Z', open: 1.31542, high: 1.31585, low: 1.31450, close: 1.31465 },
      // 16:35 spike above SL (1.31629) before moving toward TP
      { timestamp: '2026-11-19T16:35:00Z', open: 1.31595, high: 1.31660, low: 1.31560, close: 1.31585 },
      // 17:05 drop reaching TP (1.31345)
      { timestamp: '2026-11-19T17:05:00Z', open: 1.31520, high: 1.31525, low: 1.31105, close: 1.31345 }
    ]
  });

  assert.equal(result.exitStatus, 'SL_HIT');
  assert.equal(result.outcome, 'LOSS');
  assert.equal(result.realizedR, -1.0);
  assert.equal(result.exitPrice, 1.31629);
  assert.equal(result.triggeredBy, 'CANDLE_HISTORY');
  assert.equal(result.triggerCandleTimestamp, '2026-11-19T16:35:00Z');

  const pips = calculatePipsDistance('GBPUSD', 1.31542, result.exitPrice);
  assert.equal(pips, 8.7);

  const msg = buildTelegramTradeOutcomeMessage({
    pair: 'GBPUSD',
    direction: 'SELL',
    entryPrice: 1.31542,
    exitPrice: result.exitPrice,
    stopLoss: 1.31629,
    takeProfit: 1.31345,
    outcome: 'LOSS',
    pips,
    realizedR: result.realizedR,
    totalTrades: 1,
    wins: 0,
    losses: 1,
    winRate: 0,
    pairTotalTrades: 1,
    pairWins: 0,
    pairWinRate: 0
  });
  assert.ok(msg.includes('STOP LOSS HIT'));
  assert.ok(msg.includes('LOSS ❌'));
  assert.ok(msg.includes('1.31629'));
  assert.ok(!msg.includes('TAKE PROFIT HIT'));
});

test('Same-candle collision enforces conservative STOP_LOSS_FIRST tie-breaking', () => {
  const buySameBar = evaluateActiveTradeExitWithHistory({
    direction: 'BUY',
    entryPrice: 1.31500,
    stopLoss: 1.31400,
    takeProfit: 1.31700,
    openedAt: '2026-11-19T15:00:00Z',
    currentPrice: 1.31720,
    candles: [
      { timestamp: '2026-11-19T15:05:00Z', open: 1.31500, high: 1.31750, low: 1.31380, close: 1.31710 }
    ]
  });

  assert.equal(buySameBar.exitStatus, 'SL_HIT');
  assert.equal(buySameBar.outcome, 'LOSS');
  assert.equal(buySameBar.realizedR, -1.0);
  assert.equal(buySameBar.exitPrice, 1.31400);
  assert.equal(buySameBar.ambiguousSameCandle, true);
});

test('Anti-lookahead: candles opening before openedAt do not trigger false SL', () => {
  const res = evaluateActiveTradeExitWithHistory({
    direction: 'SELL',
    entryPrice: 1.31542,
    stopLoss: 1.31629,
    takeProfit: 1.31345,
    openedAt: '2026-11-19T14:35:30Z',
    currentPrice: 1.31510,
    candles: [
      // Rejection candle at 14:34 & entry bar open 14:35:00Z (30s before entry) must NOT trigger SL
      { timestamp: '2026-11-19T14:34:00Z', open: 1.31610, high: 1.31670, low: 1.31590, close: 1.31600 },
      { timestamp: '2026-11-19T14:35:00Z', open: 1.31600, high: 1.31645, low: 1.31535, close: 1.31540 },
      // Post-entry candle stays safely inside SL/TP
      { timestamp: '2026-11-19T14:36:00Z', open: 1.31540, high: 1.31560, low: 1.31500, close: 1.31510 }
    ]
  });

  assert.equal(res.exitStatus, 'HOLDING');
  assert.equal(res.outcome, 'ACTIVE');
});

test('Unordered (newest-first) candles still evaluate chronologically', () => {
  const res = evaluateActiveTradeExitWithHistory({
    direction: 'BUY',
    entryPrice: 1.10000,
    stopLoss: 1.09900,
    takeProfit: 1.10200,
    openedAt: '2026-11-19T10:00:00Z',
    currentPrice: 1.10210,
    candles: [
      // Newest first in array (TP bar first, SL bar second chronologically earlier)
      { timestamp: '2026-11-19T10:10:00Z', open: 1.09980, high: 1.10220, low: 1.09970, close: 1.10210 },
      { timestamp: '2026-11-19T10:05:00Z', open: 1.10000, high: 1.10010, low: 1.09890, close: 1.09980 }
    ]
  });

  assert.equal(res.exitStatus, 'SL_HIT');
  assert.equal(res.triggerCandleTimestamp, '2026-11-19T10:05:00Z');
  assert.equal(res.exitPrice, 1.09900);
});

test('Legitimate TP_HIT without prior SL hit resolves WIN at takeProfit barrier', () => {
  const res = evaluateActiveTradeExitWithHistory({
    direction: 'SELL',
    entryPrice: 1.31542,
    stopLoss: 1.31629,
    takeProfit: 1.31345,
    openedAt: '2026-11-19T14:35:00Z',
    currentPrice: 1.31370,
    candles: [
      { timestamp: '2026-11-19T14:40:00Z', open: 1.31542, high: 1.31610, low: 1.31480, close: 1.31490 },
      { timestamp: '2026-11-19T15:10:00Z', open: 1.31490, high: 1.31495, low: 1.31330, close: 1.31370 }
    ]
  });

  assert.equal(res.exitStatus, 'TP_HIT');
  assert.equal(res.outcome, 'WIN');
  assert.equal(res.exitPrice, 1.31345);
  assert.equal(res.triggeredBy, 'CANDLE_HISTORY');
  assert.ok(res.realizedR >= 2.26 && res.realizedR <= 2.27);
});

test('Graceful fallback to currentPrice when candles are unavailable & SL checked before TP', () => {
  const fallbackTp = evaluateActiveTradeExitWithHistory({
    direction: 'SELL',
    entryPrice: 1.31542,
    stopLoss: 1.31629,
    takeProfit: 1.31345,
    openedAt: '2026-11-19T14:35:00Z',
    currentPrice: 1.31340,
    candles: []
  });
  assert.equal(fallbackTp.exitStatus, 'TP_HIT');
  assert.equal(fallbackTp.triggeredBy, 'SPOT_PRICE');
  assert.equal(fallbackTp.exitPrice, 1.31345);

  // Degenerate SL == TP single-price check still returns SL_HIT
  const degenerate = evaluateActiveTradeExit('BUY', 1.31500, 1.31500, 1.31500, 1.31500);
  assert.equal(degenerate.exitStatus, 'SL_HIT');
});

test('Monitoring plan chooses finest timeframe with cache-friendly discrete counts', () => {
  const now = new Date('2026-11-19T18:00:00Z').getTime();
  assert.deepEqual(resolveActiveTradeMonitoringPlan('2026-11-19T16:30:00Z', now), { timeframe: 'M1', requiredCount: 180 });
  assert.deepEqual(resolveActiveTradeMonitoringPlan('2026-11-19T13:00:00Z', now), { timeframe: 'M1', requiredCount: 500 });
  assert.deepEqual(resolveActiveTradeMonitoringPlan('2026-11-19T06:00:00Z', now), { timeframe: 'M5', requiredCount: 300 });
  assert.deepEqual(resolveActiveTradeMonitoringPlan('2026-11-18T00:00:00Z', now), { timeframe: 'M15', requiredCount: 300 });
  assert.deepEqual(resolveActiveTradeMonitoringPlan('2026-11-10T00:00:00Z', now), { timeframe: 'H1', requiredCount: 300 });
});

test('Telemetry respects exitStatus override when historical candle triggered SL', () => {
  const telemetry = buildActiveTradeTelemetry(
    {
      trade_status: 'ACTIVE',
      selected_pair: 'GBPUSD',
      selected_timeframe: 'M5',
      direction: 'SELL',
      entry_price: 1.31542,
      stop_loss: 1.31629,
      take_profit: 1.31345,
      opened_at: '2026-11-19T14:35:00Z'
    },
    1.31345,
    { exitStatus: 'SL_HIT' }
  );
  assert.ok(telemetry);
  assert.equal(telemetry.status, 'SL_HIT');
});

test('Source parity: both cron and manual scan use evaluateActiveTradeExitWithHistory and resolvedExitPrice', () => {
  const cronSrc = fs.readFileSync(path.join(process.cwd(), 'api/cron/market-watcher.ts'), 'utf8');
  const scanSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/watcher-handlers/scan.ts'), 'utf8');

  for (const [label, src] of [['cron', cronSrc], ['scan', scanSrc]] as const) {
    assert.ok(src.includes('evaluateActiveTradeExitWithHistory('), `${label} must call evaluateActiveTradeExitWithHistory`);
    assert.ok(src.includes('resolveActiveTradeMonitoringPlan('), `${label} must call resolveActiveTradeMonitoringPlan`);
    assert.ok(src.includes("exitEval.exitStatus === 'SL_HIT'"), `${label} must handle SL_HIT`);
    assert.ok(src.includes("exitEval.exitStatus === 'TP_HIT'"), `${label} must handle TP_HIT`);
    assert.ok(src.includes('exit_price: resolvedExitPrice'), `${label} must record resolvedExitPrice`);
    assert.ok(src.includes('exitPrice: resolvedExitPrice'), `${label} must send resolvedExitPrice in Telegram/response`);
  }
});
