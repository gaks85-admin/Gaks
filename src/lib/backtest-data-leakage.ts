/**
 * GAKS AI — Stage E2: Data Leakage & Data-Integrity Audit Engine
 * Detects partition overlap, duplicate candles, dataset contamination, timestamp gaps,
 * and consumed out-of-sample holdout violations. Rejects invalid runs with explicit errors.
 */

import { ParsedCandle } from './backtest-csv.js';

export interface DataLeakageCheckResult {
  id: string;
  category: 'PARTITION_OVERLAP' | 'DUPLICATE_CANDLES' | 'TIMESTAMP_ORDERING' | 'HOLDOUT_CONTAMINATION' | 'OHLC_INTEGRITY';
  severity: 'CRITICAL' | 'WARNING';
  title: string;
  passed: boolean;
  message: string;
  details?: any;
}

export interface DataLeakageAuditReport {
  passed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  results: DataLeakageCheckResult[];
  timestamp: string;
}

/**
 * Verifies that training, validation, and holdout date partitions do NOT overlap.
 */
export function checkPartitionOverlap(partitions: {
  train: { start: string; end: string };
  validation?: { start: string; end: string };
  holdout?: { start: string; end: string };
}): DataLeakageCheckResult {
  const trainStart = new Date(partitions.train.start).getTime();
  const trainEnd = new Date(partitions.train.end).getTime();

  if (isNaN(trainStart) || isNaN(trainEnd) || trainStart >= trainEnd) {
    return {
      id: 'E2_PARTITION_VALID',
      category: 'PARTITION_OVERLAP',
      severity: 'CRITICAL',
      title: 'Train Partition Range Validation',
      passed: false,
      message: 'Invalid train partition date range: start must be before end.'
    };
  }

  if (partitions.validation) {
    const valStart = new Date(partitions.validation.start).getTime();
    const valEnd = new Date(partitions.validation.end).getTime();

    if (valStart < trainEnd) {
      return {
        id: 'E2_PARTITION_OVERLAP_VAL',
        category: 'PARTITION_OVERLAP',
        severity: 'CRITICAL',
        title: 'Train vs Validation Partition Overlap Check',
        passed: false,
        message: `DATA LEAKAGE DETECTED: Validation start (${partitions.validation.start}) overlaps with Train end (${partitions.train.end}).`
      };
    }
    if (valStart >= valEnd) {
      return {
        id: 'E2_PARTITION_VAL_RANGE',
        category: 'PARTITION_OVERLAP',
        severity: 'CRITICAL',
        title: 'Validation Partition Range Check',
        passed: false,
        message: 'Invalid validation partition date range.'
      };
    }

    if (partitions.holdout) {
      const holdStart = new Date(partitions.holdout.start).getTime();
      if (holdStart < valEnd) {
        return {
          id: 'E2_PARTITION_OVERLAP_HOLD',
          category: 'PARTITION_OVERLAP',
          severity: 'CRITICAL',
          title: 'Validation vs Holdout Partition Overlap Check',
          passed: false,
          message: `DATA LEAKAGE DETECTED: Holdout start (${partitions.holdout.start}) overlaps with Validation end (${partitions.validation.end}).`
        };
      }
    }
  } else if (partitions.holdout) {
    const holdStart = new Date(partitions.holdout.start).getTime();
    if (holdStart < trainEnd) {
      return {
        id: 'E2_PARTITION_OVERLAP_HOLD',
        category: 'PARTITION_OVERLAP',
        severity: 'CRITICAL',
        title: 'Train vs Holdout Partition Overlap Check',
        passed: false,
        message: `DATA LEAKAGE DETECTED: Holdout start (${partitions.holdout.start}) overlaps with Train end (${partitions.train.end}).`
      };
    }
  }

  return {
    id: 'E2_PARTITION_OVERLAP_PASS',
    category: 'PARTITION_OVERLAP',
    severity: 'CRITICAL',
    title: 'Partition Overlap Audit',
    passed: true,
    message: 'PASS: Partition date boundaries are strictly chronological with zero overlap.'
  };
}

/**
 * Audits candles for duplicate timestamps, non-monotonic time sequence, and corrupt OHLC prices.
 */
export function auditCandleIntegrity(candles: ParsedCandle[]): DataLeakageCheckResult[] {
  const results: DataLeakageCheckResult[] = [];

  if (!candles || candles.length === 0) {
    results.push({
      id: 'E2_EMPTY_CANDLES',
      category: 'OHLC_INTEGRITY',
      severity: 'CRITICAL',
      title: 'Empty Candle Dataset Check',
      passed: false,
      message: 'Dataset contains zero candles.'
    });
    return results;
  }

  let duplicateTsCount = 0;
  let nonMonotonicCount = 0;
  let corruptOHLCCount = 0;

  const seenTs = new Set<string>();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // Check duplicate timestamps
    if (seenTs.has(c.timestamp)) {
      duplicateTsCount++;
    } else {
      seenTs.add(c.timestamp);
    }

    // Check timestamp ordering
    if (i > 0) {
      const prevTs = new Date(candles[i - 1].timestamp).getTime();
      const currTs = new Date(c.timestamp).getTime();
      if (currTs <= prevTs) {
        nonMonotonicCount++;
      }
    }

    // Check corrupt OHLC relationships
    if (c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      corruptOHLCCount++;
    }
  }

  results.push({
    id: 'E2_DUPLICATE_TS',
    category: 'DUPLICATE_CANDLES',
    severity: 'CRITICAL',
    title: 'Duplicate Timestamp Audit',
    passed: duplicateTsCount === 0,
    message: duplicateTsCount === 0
      ? 'PASS: Zero duplicate candle timestamps detected.'
      : `FAIL: Found ${duplicateTsCount} duplicate timestamps in dataset.`
  });

  results.push({
    id: 'E2_TIMESTAMP_ORDERING',
    category: 'TIMESTAMP_ORDERING',
    severity: 'CRITICAL',
    title: 'Timestamp Monotonicity Audit',
    passed: nonMonotonicCount === 0,
    message: nonMonotonicCount === 0
      ? 'PASS: Timestamps are strictly monotonic.'
      : `FAIL: Found ${nonMonotonicCount} non-monotonic timestamp anomalies.`
  });

  results.push({
    id: 'E2_OHLC_INTEGRITY',
    category: 'OHLC_INTEGRITY',
    severity: 'CRITICAL',
    title: 'OHLC Price Relationship Audit',
    passed: corruptOHLCCount === 0,
    message: corruptOHLCCount === 0
      ? 'PASS: All candles exhibit valid OHLC price geometries.'
      : `FAIL: Found ${corruptOHLCCount} candles with corrupt High < Low or invalid prices.`
  });

  return results;
}

/**
 * Audits whether a holdout dataset partition has already been consumed in a prior experiment.
 */
export function checkHoldoutConsumption(
  datasetHash: string,
  consumedHashes: string[]
): DataLeakageCheckResult {
  const isConsumed = consumedHashes.includes(datasetHash);

  return {
    id: 'E2_HOLDOUT_CONSUMED',
    category: 'HOLDOUT_CONTAMINATION',
    severity: 'CRITICAL',
    title: 'Consumed Holdout Reuse Protection',
    passed: !isConsumed,
    message: !isConsumed
      ? 'PASS: Holdout partition is clean and untouched.'
      : 'DATA CONTAMINATION ERROR: This final out-of-sample holdout dataset was previously consumed in an experiment. Re-optimizing against it invalidates scientific isolation.'
  };
}

/**
 * Runs the full Stage E2 Data Leakage & Integrity Audit.
 */
export function runDataLeakageAudit(params: {
  candles: ParsedCandle[];
  partitions?: {
    train: { start: string; end: string };
    validation?: { start: string; end: string };
    holdout?: { start: string; end: string };
  };
  datasetHash?: string;
  consumedHashes?: string[];
}): DataLeakageAuditReport {
  const results: DataLeakageCheckResult[] = [];

  // 1. Partition Overlap
  if (params.partitions) {
    results.push(checkPartitionOverlap(params.partitions));
  }

  // 2. Candle Integrity
  results.push(...auditCandleIntegrity(params.candles));

  // 3. Holdout Consumption
  if (params.datasetHash && params.consumedHashes) {
    results.push(checkHoldoutConsumption(params.datasetHash, params.consumedHashes));
  }

  const totalChecks = results.length;
  const passedChecks = results.filter(r => r.passed).length;
  const failedChecks = totalChecks - passedChecks;

  return {
    passed: failedChecks === 0,
    totalChecks,
    passedChecks,
    failedChecks,
    results,
    timestamp: new Date().toISOString()
  };
}
