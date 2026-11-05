/**
 * GAKS AI — Stage F: Historical Data Inventory & Simulation Readiness Gate
 * Inspects all production datasets, calculates inventory attributes, validation status,
 * content hashes, missing candle counts, duplicate timestamps, and coverage matrices.
 */

import { listBacktestDatasets, getBacktestDatasetDetails, getBacktestDatasetCandles, BENCHMARK_DATASET_ID, DAY1_DATASET_ID } from './backtest-service.js';
import { computeDatasetHash } from './backtest-import-utils.js';
import { validateHistoricalDataset } from './backtest-validator.js';
import { timeframeToMinutes } from './timeframe.js';

export interface DatasetInventoryItem {
  datasetId: string;
  symbol: string;
  timeframe: string;
  firstTimestamp: string;
  lastTimestamp: string;
  calendarYearsCovered: number[];
  totalCandleCount: number;
  missingCandleCount: number;
  duplicateTimestampCount: number;
  validationStatus: string;
  datasetVersion: string;
  contentHash: string;
  readinessPassed: boolean;
  readinessFailures: string[];
}

export async function runDatasetInventoryAndReadinessGate(): Promise<{
  inventory: DatasetInventoryItem[];
  coverageMatrix: Record<string, Record<string, number[]>>;
  allReady: boolean;
}> {
  console.log('============================================================================');
  console.log('GAKS AI — STAGE F: HISTORICAL DATA INVENTORY & SIMULATION READINESS GATE');
  console.log('============================================================================\n');

  const datasets = await listBacktestDatasets();
  const inventory: DatasetInventoryItem[] = [];
  const coverageMatrix: Record<string, Record<string, number[]>> = {}; // Symbol -> Timeframe -> Years[]

  for (const ds of datasets) {
    const candles = await getBacktestDatasetCandles(ds.id);
    const hash = candles.length > 0 ? computeDatasetHash(candles) : 'no_candles_hash';
    const firstTs = candles[0]?.timestamp || ds.start_time || 'N/A';
    const lastTs = candles[candles.length - 1]?.timestamp || ds.end_time || 'N/A';

    // Calculate calendar years covered
    const yearsSet = new Set<number>();
    for (const c of candles) {
      if (c.timestamp) {
        const yr = new Date(c.timestamp).getUTCFullYear();
        if (!isNaN(yr)) yearsSet.add(yr);
      }
    }
    const calendarYearsCovered = Array.from(yearsSet).sort((a, b) => a - b);

    // Validate dataset using Stage D4 validator
    const expectedMinutes = timeframeToMinutes(ds.timeframe);
    const valReport = validateHistoricalDataset(candles, {
      symbol: ds.symbol,
      timeframe: ds.timeframe,
      expectedIntervalMinutes: expectedMinutes,
      isCrypto: ds.symbol.includes('BTC') || ds.symbol.includes('ETH')
    } as any);

    const missingCount = valReport.missingCandleCount || 0;
    const dupCount = valReport.duplicateCount || 0;
    const validationStatus = ds.validation_report?.status || valReport.status || 'READY';

    // Simulation Readiness Gate Checks
    const failures: string[] = [];
    if (validationStatus === 'INVALID') {
      failures.push('Dataset validation status is INVALID');
    }
    if (candles.length === 0) {
      failures.push('Dataset has zero candles');
    }
    if (dupCount > 0) {
      failures.push(`Dataset contains ${dupCount} duplicate timestamps`);
    }

    const readinessPassed = failures.length === 0;

    const item: DatasetInventoryItem = {
      datasetId: ds.id,
      symbol: ds.symbol,
      timeframe: ds.timeframe,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
      calendarYearsCovered,
      totalCandleCount: candles.length || ds.row_count,
      missingCandleCount: missingCount,
      duplicateTimestampCount: dupCount,
      validationStatus,
      datasetVersion: ds.version || '1.0.0',
      contentHash: hash,
      readinessPassed,
      readinessFailures: failures
    };

    inventory.push(item);

    // Build coverage matrix
    if (!coverageMatrix[ds.symbol]) {
      coverageMatrix[ds.symbol] = {};
    }
    coverageMatrix[ds.symbol][ds.timeframe] = calendarYearsCovered;

    // Log item report
    console.log(`[DATASET INVENTORY RECORD]`);
    console.log(`- Dataset ID: ${item.datasetId}`);
    console.log(`- Instrument / Symbol: ${item.symbol}`);
    console.log(`- Timeframe: ${item.timeframe}`);
    console.log(`- First Candle Timestamp: ${item.firstTimestamp}`);
    console.log(`- Last Candle Timestamp: ${item.lastTimestamp}`);
    console.log(`- Calendar Years Covered: [${item.calendarYearsCovered.join(', ')}]`);
    console.log(`- Total Candle Count: ${item.totalCandleCount}`);
    console.log(`- Missing Candle Count: ${item.missingCandleCount}`);
    console.log(`- Duplicate Timestamps: ${item.duplicateTimestampCount}`);
    console.log(`- Validation Status: ${item.validationStatus}`);
    console.log(`- Dataset Version: ${item.datasetVersion}`);
    console.log(`- Content Hash (SHA-256): ${item.contentHash}`);
    console.log(`- Simulation Readiness Gate: ${item.readinessPassed ? 'PASSED (ELIGIBLE)' : 'REJECTED: ' + item.readinessFailures.join(', ')}`);
    console.log('------------------------------------------------------------\n');
  }

  console.log('=== COVERAGE MATRIX ===');
  console.log(JSON.stringify(coverageMatrix, null, 2));
  console.log('============================================================\n');

  const allReady = inventory.every(i => i.readinessPassed);

  return {
    inventory,
    coverageMatrix,
    allReady
  };
}

runDatasetInventoryAndReadinessGate().catch(err => {
  console.error('Inventory audit failed:', err);
  process.exit(1);
});
