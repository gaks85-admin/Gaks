import { runBacktest } from './backtest-engine.js';
import { createBacktestDataset, deleteBacktestDataset } from './backtest-service.js';
import { parseAndValidateCSV } from './backtest-csv.js';

export async function runEngineUnitTests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
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

  console.log('[Backtest Engine Tests] Starting tests...');

  // Setup: Create a test dataset
  const testCsv = `time,open,high,low,close,volume
2025-01-01 00:00:00,1.0500,1.0550,1.0480,1.0510,100
2025-01-01 00:05:00,1.0510,1.0560,1.0490,1.0520,110
2025-01-01 00:10:00,1.0520,1.0580,1.0510,1.0570,120
2025-01-01 00:15:00,1.0570,1.0590,1.0530,1.0540,115
2025-01-01 00:20:00,1.0540,1.0550,1.0480,1.0490,130
2025-01-01 00:25:00,1.0490,1.0500,1.0420,1.0430,140
2025-01-01 00:30:00,1.0430,1.0450,1.0390,1.0400,150`;

  let datasetId = '';

  try {
    const createRes = await createBacktestDataset({
      userId: 'test-admin',
      name: 'Engine Test Dataset',
      symbol: 'EURUSD',
      timeframe: 'M5',
      sourceFilename: 'test.csv',
      csvContent: testCsv
    });

    if (createRes.success && createRes.dataset) {
      datasetId = createRes.dataset.id;
    }
  } catch (err: any) {
    console.error('Setup dataset creation error:', err);
  }

  // Test 1: Missing / Non-existent Dataset
  try {
    const res = await runBacktest({
      datasetId: 'non-existent-id-12345',
      initialBalance: 100000,
      symbol: 'EURUSD',
      timeframe: 'M5'
    });
    assert(!res.success && !!res.error, 'Test 1: Missing dataset fails gracefully', res.error);
  } catch (err: any) {
    assert(false, 'Test 1 Exception', err.message);
  }

  // Test 2: Invalid Balance Rejection
  try {
    const res = await runBacktest({
      datasetId,
      initialBalance: -500,
      symbol: 'EURUSD',
      timeframe: 'M5'
    });
    assert(!res.success && !!res.error && res.error.includes('Initial balance'), 'Test 2: Invalid initial balance rejected', res.error);
  } catch (err: any) {
    assert(false, 'Test 2 Exception', err.message);
  }

  // Test 3: Successful Backtest Run on Ready Dataset
  let run1Result: any = null;
  try {
    const res = await runBacktest({
      datasetId,
      initialBalance: 100000,
      symbol: 'EURUSD',
      timeframe: 'M5',
      strategyId: 'ema-crossover'
    });

    run1Result = res;

    assert(res.success === true, 'Test 3: Backtest run succeeds on ready dataset', res.error);
    assert(res.candlesProcessed === 7, 'Test 3b: Processed exactly 7 candles', `got ${res.candlesProcessed}`);
    assert(res.initialBalance === 100000, 'Test 3c: Initial balance matches config', `got ${res.initialBalance}`);
    assert(res.startTime === '2025-01-01T00:00:00.000Z', 'Test 3d: Start time matches first candle', res.startTime);
    assert(res.endTime === '2025-01-01T00:30:00.000Z', 'Test 3e: End time matches last candle', res.endTime);
  } catch (err: any) {
    assert(false, 'Test 3 Exception', err.message);
  }

  // Test 4: Determinism Test (Run exact same backtest twice, assert 100% identical outputs)
  try {
    const run2Result = await runBacktest({
      datasetId,
      initialBalance: 100000,
      symbol: 'EURUSD',
      timeframe: 'M5',
      strategyId: 'ema-crossover'
    });

    assert(run1Result !== null && run2Result.success === true, 'Test 4: Second run succeeds');
    assert(run1Result.candlesProcessed === run2Result.candlesProcessed, 'Test 4b: Identical candlesProcessed count');
    assert(run1Result.signalsGenerated === run2Result.signalsGenerated, 'Test 4c: Identical signalsGenerated count');
    assert(JSON.stringify(run1Result.signals) === JSON.stringify(run2Result.signals), 'Test 4d: Identical signal array');
    assert(run1Result.startTime === run2Result.startTime, 'Test 4e: Identical startTime');
    assert(run1Result.endTime === run2Result.endTime, 'Test 4f: Identical endTime');
  } catch (err: any) {
    assert(false, 'Test 4 Exception', err.message);
  }

  // Test 5: Look-Ahead Bias & Chronological Isolation
  try {
    // Run backtest with start & end time filter
    const res = await runBacktest({
      datasetId,
      initialBalance: 50000,
      symbol: 'EURUSD',
      timeframe: 'M5',
      startTime: '2025-01-01T00:05:00.000Z',
      endTime: '2025-01-01T00:20:00.000Z'
    });

    assert(res.success && res.candlesProcessed === 4, 'Test 5: Time range filtering correctly limits processed candles to 4');
  } catch (err: any) {
    assert(false, 'Test 5 Exception', err.message);
  }

  // Cleanup
  if (datasetId) {
    await deleteBacktestDataset(datasetId);
  }

  return { total, passed, failed: total - passed, failures };
}
