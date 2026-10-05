import { parseAndValidateCSV } from './backtest-csv';

/**
 * Test runner for CSV parser & validator
 */
export function runCSVParserTests(): { total: number; passed: number; failed: number; failures: string[] } {
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

  // Test 1: Empty CSV
  {
    const res = parseAndValidateCSV('');
    assert(!res.success, 'Test 1: Empty CSV should fail', res.error);
  }

  // Test 2: Missing required column (missing close)
  {
    const csv = `timestamp,open,high,low\n2025-01-01 00:00:00,1.0500,1.0550,1.0480`;
    const res = parseAndValidateCSV(csv);
    assert(!res.success && !!res.error && res.error.includes('close'), 'Test 2: Missing required column (close)', res.error);
  }

  // Test 3: Invalid number
  {
    const csv = `timestamp,open,high,low,close\n2025-01-01 00:00:00,1.0500,abc,1.0480,1.0510`;
    const res = parseAndValidateCSV(csv);
    assert(!res.success && !!res.error && res.error.includes('Invalid high price'), 'Test 3: Invalid number (abc)', res.error);
  }

  // Test 4: Invalid timestamp
  {
    const csv = `timestamp,open,high,low,close\nnot-a-date,1.0500,1.0550,1.0480,1.0510`;
    const res = parseAndValidateCSV(csv);
    assert(!res.success && !!res.error && res.error.includes('Invalid date format'), 'Test 4: Invalid timestamp', res.error);
  }

  // Test 5: Invalid OHLC relationship (High < Open)
  {
    const csv = `timestamp,open,high,low,close\n2025-01-01 00:00:00,1.0500,1.0400,1.0380,1.0450`;
    const res = parseAndValidateCSV(csv);
    assert(!res.success && !!res.error && res.error.includes('High price'), 'Test 5: Invalid OHLC (High < Open)', res.error);
  }

  // Test 6: Duplicate timestamp
  {
    const csv = `timestamp,open,high,low,close\n2025-01-01 00:00:00,1.0500,1.0550,1.0480,1.0510\n2025-01-01 00:00:00,1.0510,1.0560,1.0490,1.0520`;
    const res = parseAndValidateCSV(csv);
    assert(!res.success && !!res.error && res.error.includes('Duplicate timestamp'), 'Test 6: Duplicate timestamp', res.error);
  }

  // Test 7: Unsorted data (should be automatically sorted chronologically and pass)
  {
    const csv = `timestamp,open,high,low,close\n2025-01-01 00:05:00,1.0510,1.0560,1.0490,1.0520\n2025-01-01 00:00:00,1.0500,1.0550,1.0480,1.0510`;
    const res = parseAndValidateCSV(csv);
    assert(res.success && res.candles[0].timestamp < res.candles[1].timestamp, 'Test 7: Unsorted data automatically sorted chronologically', res.error);
  }

  // Test 8: Valid CSV with 2025 data
  {
    const csv = `time,open,high,low,close,volume\n2025-01-01 00:00:00,1.0500,1.0550,1.0480,1.0510,100\n2025-12-31 23:55:00,1.0800,1.0850,1.0780,1.0810,150`;
    const res = parseAndValidateCSV(csv);
    assert(res.success && res.rowCount === 2 && res.covers2025 === true, 'Test 8: Valid 2025 CSV parsed correctly', res.error);
  }

  return { total, passed, failed: total - passed, failures };
}
