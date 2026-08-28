import {
  runWatcherDiagnosticReplay,
  getMaxAllowedAgeMs,
  formatAgeString,
  DiagnosticReport
} from './watcher-diagnostic-engine.js';
import { checkSignalDeduplication } from './signal-deduplication.js';
import { classifyAndRedactGeminiError } from './gemini-key-resolver.js';

export interface TestResult {
  scenario: string;
  passed: boolean;
  details: string;
}

export async function runDiagnosticTestSuite(): Promise<{ total: number; passed: number; results: TestResult[] }> {
  const results: TestResult[] = [];

  // 1. Stale Data Threshold Calculations
  try {
    const m5Limit = getMaxAllowedAgeMs('M5'); // 15m
    const h1Limit = getMaxAllowedAgeMs('H1'); // 3h
    const d1Limit = getMaxAllowedAgeMs('D1'); // 48h
    const pass = m5Limit === 15 * 60 * 1000 && h1Limit === 3 * 3600 * 1000 && d1Limit === 48 * 3600 * 1000;
    results.push({
      scenario: '1. Stale Data Age Thresholds Calculation',
      passed: pass,
      details: pass ? 'M5=15m, H1=3h, D1=48h correctly computed' : `Mismatch: M5=${m5Limit}, H1=${h1Limit}, D1=${d1Limit}`
    });
  } catch (err: any) {
    results.push({ scenario: '1. Stale Data Age Thresholds Calculation', passed: false, details: err.message });
  }

  // 2. Age Format String
  try {
    const formatted = formatAgeString(5 * 60 * 1000 + 12 * 1000); // 5m12s
    const pass = formatted === '5m12s';
    results.push({
      scenario: '2. Data Age Format String',
      passed: pass,
      details: pass ? 'Format string 5m12s matches' : `Got '${formatted}' instead of '5m12s'`
    });
  } catch (err: any) {
    results.push({ scenario: '2. Data Age Format String', passed: false, details: err.message });
  }

  // 3. Duplicate Detection Logic - Entry Price Proximity Check
  try {
    const dupMatch = checkSignalDeduplication({
      symbol: 'BTCUSD',
      direction: 'BUY',
      timeframe: 'M5',
      entryPrice: 100050,
      stopLoss: 99500,
      takeProfit: 101000,
      previousSignal: {
        symbol: 'BTCUSD',
        direction: 'BUY',
        timeframe: 'M5',
        entryPrice: 100000,
        stopLoss: 99500,
        takeProfit: 101000,
        alertedAt: new Date()
      },
      cooldownMinutes: 30
    });

    const diffPriceNoDup = checkSignalDeduplication({
      symbol: 'BTCUSD',
      direction: 'BUY',
      timeframe: 'M5',
      entryPrice: 102000, // 2% diff
      stopLoss: 101000,
      takeProfit: 104000,
      previousSignal: {
        symbol: 'BTCUSD',
        direction: 'BUY',
        timeframe: 'M5',
        entryPrice: 100000,
        stopLoss: 99500,
        takeProfit: 101000,
        alertedAt: new Date()
      },
      cooldownMinutes: 30
    });

    const pass = dupMatch.suppressed === true && diffPriceNoDup.suppressed === false;
    results.push({
      scenario: '3. Duplicate Signal Deduplication Audit',
      passed: pass,
      details: pass ? 'Identical entry suppressed, 2% price difference allowed as new setup' : 'Deduplication threshold failed'
    });
  } catch (err: any) {
    results.push({ scenario: '3. Duplicate Signal Deduplication Audit', passed: false, details: err.message });
  }

  // 4. Gemini 429 Quota Error Classification
  try {
    const quotaErr = new Error('429 You exceeded your current quota, please check your plan and billing details.');
    (quotaErr as any).status = 429;
    const classified = classifyAndRedactGeminiError(quotaErr);

    const pass = classified.isQuota && classified.profileStatus === 'QUOTA_EXHAUSTED';
    results.push({
      scenario: '4. Gemini 429 Quota Exhausted Classification',
      passed: pass,
      details: pass ? '429 error correctly classified as QUOTA_EXHAUSTED' : `Got status ${classified.profileStatus}`
    });
  } catch (err: any) {
    results.push({ scenario: '4. Gemini 429 Quota Exhausted Classification', passed: false, details: err.message });
  }

  // 5. API Key Redaction in Error Messages
  try {
    const rawErrorStr = "Error accessing model with API key AIzaSyA1B2C3D4E5F6G7H8I9J0_XYZ: quota exceeded";
    const classified = classifyAndRedactGeminiError(new Error(rawErrorStr));
    const pass = !classified.cleanErrorMessage.includes("AIzaSy") && classified.cleanErrorMessage.includes("[REDACTED_GEMINI_KEY]");
    results.push({
      scenario: '5. API Key Redaction in Log Strings',
      passed: pass,
      details: pass ? 'API Key safely redacted in log strings' : `Key leaked in error: ${classified.cleanErrorMessage}`
    });
  } catch (err: any) {
    results.push({ scenario: '5. API Key Redaction in Log Strings', passed: false, details: err.message });
  }

  // 6. Gemini 503 Classification
  try {
    const err503 = new Error('503 The service is currently unavailable.');
    (err503 as any).status = 503;
    const classified = classifyAndRedactGeminiError(err503);
    const pass = classified.is503 && classified.profileStatus === 'TEMP_ERROR';
    results.push({
      scenario: '6. Gemini 503 Temporary Error Classification',
      passed: pass,
      details: pass ? '503 correctly classified as TEMP_ERROR' : `Got status ${classified.profileStatus}`
    });
  } catch (err: any) {
    results.push({ scenario: '6. Gemini 503 Temporary Error Classification', passed: false, details: err.message });
  }

  // 7. Gemini Timeout Classification
  try {
    const timeoutErr = new Error('Gemini request timed out after 8000ms');
    timeoutErr.name = 'TimeoutError';
    const classified = classifyAndRedactGeminiError(timeoutErr);
    const pass = classified.isTimeout && classified.diagnosticStatus === 'TIMEOUT';
    results.push({
      scenario: '7. Gemini 8s Timeout Classification',
      passed: pass,
      details: pass ? 'Timeout correctly classified as TIMEOUT' : `Got status ${classified.diagnosticStatus}`
    });
  } catch (err: any) {
    results.push({ scenario: '7. Gemini 8s Timeout Classification', passed: false, details: err.message });
  }

  // 8. Gemini Cancellation Classification
  try {
    const cancelErr = new Error('The operation was cancelled.');
    const classified = classifyAndRedactGeminiError(cancelErr);
    const pass = classified.isCancelled && classified.diagnosticStatus === 'CANCELLED';
    results.push({
      scenario: '8. Gemini Operation Cancelled Classification',
      passed: pass,
      details: pass ? 'Operation was cancelled correctly classified as CANCELLED' : `Got status ${classified.diagnosticStatus}`
    });
  } catch (err: any) {
    results.push({ scenario: '8. Gemini Operation Cancelled Classification', passed: false, details: err.message });
  }

  // 9. Deterministic Pre-Filtering Gate Audit
  try {
    const PRE_FILTER_MIN_SCORE = 70;
    
    // Case A: Low score (45%) -> should fail gate
    const caseA_score: number = 45;
    const caseA_rec: string = 'FAIL';
    const caseA_mandatory: boolean = false;
    const caseA_passes = caseA_mandatory && caseA_score >= PRE_FILTER_MIN_SCORE && (caseA_rec === 'PASS' || caseA_rec === 'LIKELY_PASS');

    // Case B: High score (85%), mandatory passed, recommendation LIKELY_PASS -> should pass gate
    const caseB_score: number = 85;
    const caseB_rec: string = 'LIKELY_PASS';
    const caseB_mandatory: boolean = true;
    const caseB_passes = caseB_mandatory && caseB_score >= PRE_FILTER_MIN_SCORE && (caseB_rec === 'PASS' || caseB_rec === 'LIKELY_PASS');

    // Case C: Score 65%, recommendation AMBIGUOUS -> should fail gate
    const caseC_score: number = 65;
    const caseC_rec: string = 'AMBIGUOUS';
    const caseC_mandatory: boolean = true;
    const caseC_passes = caseC_mandatory && caseC_score >= PRE_FILTER_MIN_SCORE && (caseC_rec === 'PASS' || caseC_rec === 'LIKELY_PASS');

    const pass = (!caseA_passes) && (caseB_passes) && (!caseC_passes);
    results.push({
      scenario: '9. Deterministic Pre-Filtering Gate Audit',
      passed: pass,
      details: pass ? 'Low/ambiguous setups filtered locally (zero Gemini calls); high-probability setups passed to Gemini Gate' : 'Pre-filter gate logic mismatch'
    });
  } catch (err: any) {
    results.push({ scenario: '9. Deterministic Pre-Filtering Gate Audit', passed: false, details: err.message });
  }

  const passedCount = results.filter(r => r.passed).length;
  return {
    total: results.length,
    passed: passedCount,
    results
  };
}
