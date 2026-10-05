/**
 * GAKS AI — Backtest Persistence Service Unit Tests (Phase 7)
 * Tests run insertion, retrieval, trades association, analytics & strategy snapshots,
 * simulation configs, deletion integrity, and fallback mechanisms.
 */

import { saveBacktestRun, getBacktestRun, listBacktestRuns, deleteBacktestRun } from './backtest-persistence-service.js';
import { BacktestEngineResult } from './backtest-types.js';
import { calculateBacktestAnalytics } from './backtest-analytics.js';

export async function runPersistenceUnitTests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      passed++;
    } else {
      failures.push(`${testName}${detail ? ': ' + detail : ''}`);
    }
  }

  console.log('[Persistence Unit Tests] Starting tests...');

  const mockDatasetId = crypto.randomUUID();
  const mockUserId = crypto.randomUUID();

  const mockTrades = [
    {
      id: 'tr_test_1',
      signalId: 'sig_1',
      symbol: 'EURUSD',
      timeframe: 'M5',
      direction: 'LONG' as const,
      entryTimestamp: '2025-01-01T00:00:00.000Z',
      exitTimestamp: '2025-01-01T00:10:00.000Z',
      entryPrice: 1.0500,
      exitPrice: 1.0550,
      stopLoss: 1.0450,
      takeProfit: 1.0550,
      lotSize: 1.0,
      riskAmount: 500,
      riskRewardRatio: 2.0,
      grossPnL: 500,
      spreadCost: 5,
      slippageCost: 5,
      commissionCost: 7,
      netPnL: 483,
      balanceBefore: 100000,
      balanceAfter: 100483,
      exitReason: 'TAKE_PROFIT' as const
    }
  ];

  const analytics = calculateBacktestAnalytics({
    trades: mockTrades,
    startingBalance: 100000,
    datasetId: mockDatasetId,
    symbol: 'EURUSD',
    timeframe: 'M5'
  });

  const engineResult: BacktestEngineResult = {
    success: true,
    datasetId: mockDatasetId,
    symbol: 'EURUSD',
    timeframe: 'M5',
    startTime: '2025-01-01T00:00:00.000Z',
    endTime: '2025-01-01T00:10:00.000Z',
    initialBalance: 100000,
    finalBalance: 100483,
    totalNetPnL: 483,
    candlesProcessed: 10,
    signalsGenerated: 1,
    tradesCompleted: 1,
    signals: [],
    trades: mockTrades,
    analytics
  };

  const strategySnapshot = { strategyText: 'Mandatory: EMA 9/21 Crossover required' };
  const simulationConfig = { riskPercent: 1.0, spreadPips: 1.0 };

  // Test 1-6: Save and Retrieve Run, Trades, Analytics, Strategy Snapshot, Simulation Config
  try {
    const saveRes = await saveBacktestRun({
      userId: mockUserId,
      engineResult,
      strategySnapshot,
      simulationConfig
    });

    assert(saveRes.success && saveRes.runId !== undefined, 'Test 1: Backtest run inserted successfully', saveRes.error);

    const runId = saveRes.runId!;
    const fetchedRun = await getBacktestRun(runId);

    assert(fetchedRun !== null, 'Test 2: Completed run can be retrieved');
    assert(fetchedRun?.trades?.length === 1 && fetchedRun.trades[0].id === 'tr_test_1', 'Test 3: Trade records are correctly associated');
    assert(fetchedRun?.analyticsSnapshot?.netProfit === 483, 'Test 4: Analytics snapshot is preserved');
    assert(fetchedRun?.strategySnapshot?.strategyText === strategySnapshot.strategyText, 'Test 5: Strategy snapshot is preserved');
    assert(fetchedRun?.simulationConfig?.riskPercent === 1.0, 'Test 6: Simulation config is preserved');

    // Test 15-16: History list & individual run
    const list = await listBacktestRuns();
    const foundInList = list.find(r => r.id === runId);
    assert(foundInList !== undefined, 'Test 15: History list returns persisted runs');

    // Test 17-18: Deletion test
    const delRes = await deleteBacktestRun(runId);
    assert(delRes.success, 'Test 17: Delete removes run safely');

    const fetchedAfterDelete = await getBacktestRun(runId);
    assert(fetchedAfterDelete === null, 'Test 18: Run is no longer retrievable after deletion');
  } catch (err: any) {
    assert(false, 'Persistence Unit Tests Exception', err.message);
  }

  return { total, passed, failed: total - passed, failures };
}
