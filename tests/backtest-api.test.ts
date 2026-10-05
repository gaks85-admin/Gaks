import { createBacktestDataset, listBacktestDatasets, getBacktestDatasetDetails, deleteBacktestDataset } from '../src/lib/backtest-service.js';
import { parseAndValidateCSV } from '../src/lib/backtest-csv.js';

export async function runBacktestAPITests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
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

  console.log('[Backtest API Tests] Running tests...');

  // Test 1: Valid Dataset Creation & Verification
  const validCsv = `time,open,high,low,close,volume
2025-01-01 00:00:00,1.0500,1.0550,1.0480,1.0510,100
2025-01-01 00:05:00,1.0510,1.0560,1.0490,1.0520,110
2025-12-31 23:55:00,1.0800,1.0850,1.0780,1.0810,150`;

  let createdDatasetId: string | null = null;

  try {
    const res = await createBacktestDataset({
      userId: 'test-admin-id',
      name: 'Test 2025 EURUSD M5',
      symbol: 'EURUSD',
      timeframe: 'M5',
      sourceFilename: 'eurusd_2025_m5.csv',
      csvContent: validCsv
    });

    assert(res.success && !!res.dataset, 'Test 1: Create Backtest Dataset', res.error);
    if (res.dataset) {
      createdDatasetId = res.dataset.id;
      assert(res.dataset.row_count === 3, 'Test 1b: Dataset row_count === 3', `got ${res.dataset.row_count}`);
      assert(res.dataset.status === 'ready', 'Test 1c: Dataset status === ready', res.dataset.status);
      assert(res.dataset.symbol === 'EURUSD', 'Test 1d: Normalized symbol', res.dataset.symbol);
      assert(res.dataset.covers_2025 === true, 'Test 1e: Covers 2025 flag is true', String(res.dataset.covers_2025));
    }
  } catch (err: any) {
    assert(false, 'Test 1: Create Backtest Dataset Exception', err.message);
  }

  // Test 2: List Datasets
  try {
    const list = await listBacktestDatasets();
    assert(Array.isArray(list) && list.some(d => d.id === createdDatasetId), 'Test 2: List Backtest Datasets includes created dataset');
  } catch (err: any) {
    assert(false, 'Test 2: List Backtest Datasets Exception', err.message);
  }

  // Test 3: Get Dataset Details
  if (createdDatasetId) {
    try {
      const details = await getBacktestDatasetDetails(createdDatasetId);
      assert(details.success && !!details.dataset, 'Test 3: Get Dataset Details Success');
      assert(Array.isArray(details.sampleCandles) && details.sampleCandles.length === 3, 'Test 3b: Sample candles count === 3');
    } catch (err: any) {
      assert(false, 'Test 3: Get Dataset Details Exception', err.message);
    }
  }

  // Test 4: Invalid CSV Rejection during Dataset Creation
  try {
    const invalidCsv = `time,open,high,low,close\n2025-01-01 00:00:00,1.0500,1.0400,1.0480,1.0510`; // high < open
    const res = await createBacktestDataset({
      userId: 'test-admin-id',
      name: 'Invalid Dataset',
      symbol: 'EURUSD',
      timeframe: 'M5',
      sourceFilename: 'invalid.csv',
      csvContent: invalidCsv
    });

    assert(!res.success && !!res.error, 'Test 4: Rejection of Invalid CSV Dataset Creation', res.error);
  } catch (err: any) {
    assert(false, 'Test 4: Invalid CSV Dataset Exception', err.message);
  }

  // Test 5: Delete Dataset
  if (createdDatasetId) {
    try {
      const delRes = await deleteBacktestDataset(createdDatasetId);
      assert(delRes.success, 'Test 5: Delete Dataset Success');

      const details = await getBacktestDatasetDetails(createdDatasetId);
      assert(!details.success, 'Test 5b: Deleted Dataset no longer found');
    } catch (err: any) {
      assert(false, 'Test 5: Delete Dataset Exception', err.message);
    }
  }

  return { total, passed, failed: total - passed, failures };
}
