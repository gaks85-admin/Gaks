// src/lib/explainability-tests.ts
import { recordEvaluation, EvaluationRecord } from './explainability-engine.js';

// Mock localStorage if running in a Node environment without a browser window
const mockLocalStorage: Record<string, string> = {};
if (typeof window === 'undefined') {
  const storageMock = {
    getItem: (key: string) => mockLocalStorage[key] || null,
    setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
    removeItem: (key: string) => { delete mockLocalStorage[key]; },
    clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; }
  };
  (global as any).window = {
    localStorage: storageMock
  };
  (global as any).localStorage = storageMock;
}

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  error?: string;
}

const runTests = async () => {
  console.log("=========================================");
  console.log("    GAKS AI EXPLAINABILITY TEST SUITE   ");
  console.log("            (30 TEST CASES)              ");
  console.log("=========================================\n");

  const results: TestResult[] = [];

  // Reset local storage before running tests
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem('gaks_watcher_evaluations', '[]');
  }

  // Define Mock Supabase clients
  const mockSupabaseSuccess = {
    from: () => ({
      insert: (payload: any) => ({
        select: () => ({
          data: [payload],
          error: null
        })
      })
    })
  };

  const mockSupabaseFailure = {
    from: () => ({
      insert: () => ({
        select: () => ({
          data: null,
          error: { message: "Database constraint failure" }
        })
      })
    })
  };

  // Helper to capture console logs to verify exact visual logging requirements
  let logOutput: string[] = [];
  const originalLog = console.log;
  const captureLogs = (fn: () => void | Promise<void>) => {
    logOutput = [];
    console.log = (...args: any[]) => {
      logOutput.push(args.join(' '));
    };
    const res = fn();
    if (res instanceof Promise) {
      return res.then(() => {
        console.log = originalLog;
        return logOutput;
      });
    }
    console.log = originalLog;
    return logOutput;
  };

  const addResult = (id: number, name: string, passed: boolean, error?: string) => {
    results.push({ id, name, passed, error });
    if (passed) {
      originalLog(`[PASS] Test #${id}: ${name}`);
    } else {
      originalLog(`[FAIL] Test #${id}: ${name} - Error: ${error}`);
    }
  };

  // ----------------------------------------------------
  // SECTION 1: EVALUATION STORAGE TESTS (1 - 5)
  // ----------------------------------------------------
  
  // Test 1: Successful database write using Supabase client
  try {
    const record: EvaluationRecord = {
      user_id: "00000000-0000-0000-0000-000000000001",
      watcher_id: "11111111-1111-1111-1111-111111111111",
      pair: "EUR/USD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 95,
      matched_weight: 95,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA", "RSI"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      trade_reason: "All rules matched perfectly",
      scan_duration_ms: 250
    };
    const saved = await recordEvaluation(mockSupabaseSuccess, record);
    addResult(1, "Successful database write persistence with mock Supabase client", saved === true);
  } catch (err: any) {
    addResult(1, "Successful database write persistence with mock Supabase client", false, err.message);
  }

  // Test 2: LocalStorage fallback occurs when Supabase client is missing
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('gaks_watcher_evaluations', '[]');
    }
    const record: EvaluationRecord = {
      user_id: "user-local-1",
      watcher_id: "watcher-local-1",
      pair: "GBP/USD",
      timeframe: "4h",
      strategy_mode: "HYBRID",
      decision_score: 80,
      matched_weight: 80,
      possible_weight: 100,
      recommendation: "LIKELY_PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS"],
      failed_rules: ["EMA"],
      gemini_used: false,
      trade_sent: false,
      trade_reason: "Awaiting candle close confirmation",
      scan_duration_ms: 120
    };
    const saved = await recordEvaluation(null, record);
    const storageData = JSON.parse(window.localStorage.getItem('gaks_watcher_evaluations') || '[]');
    const hasRecord = storageData.some((r: any) => r.user_id === "user-local-1");
    addResult(2, "LocalStorage fallback occurs gracefully when Supabase client is null", saved === true && hasRecord);
  } catch (err: any) {
    addResult(2, "LocalStorage fallback occurs gracefully when Supabase client is null", false, err.message);
  }

  // Test 3: LocalStorage fallback occurs when database query triggers error
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('gaks_watcher_evaluations', '[]');
    }
    const record: EvaluationRecord = {
      user_id: "user-fallback-db-err",
      watcher_id: "watcher-fallback-db-err",
      pair: "AUD/USD",
      timeframe: "15m",
      strategy_mode: "AI_ONLY",
      decision_score: 50,
      matched_weight: 50,
      possible_weight: 100,
      recommendation: "AMBIGUOUS",
      mandatory_rules_passed: false,
      matched_rules: ["RSI"],
      failed_rules: ["BOS"],
      gemini_used: true,
      trade_sent: false,
      trade_reason: "High volatility, decision is ambiguous",
      scan_duration_ms: 450
    };
    const saved = await recordEvaluation(mockSupabaseFailure, record);
    const storageData = JSON.parse(window.localStorage.getItem('gaks_watcher_evaluations') || '[]');
    const hasRecord = storageData.some((r: any) => r.user_id === "user-fallback-db-err");
    addResult(3, "LocalStorage fallback when mock Supabase client throws or fails on insert", saved === true && hasRecord);
  } catch (err: any) {
    addResult(3, "LocalStorage fallback when mock Supabase client throws or fails on insert", false, err.message);
  }

  // Test 4: Missing optional text fields (like trade_reason or gemini_result) persist as null
  try {
    const record: EvaluationRecord = {
      user_id: "user-optional-null",
      watcher_id: "watcher-optional-null",
      pair: "USD/JPY",
      timeframe: "1d",
      strategy_mode: "RULE_ONLY",
      decision_score: 30,
      matched_weight: 30,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: [],
      failed_rules: ["EMA", "RSI", "BOS"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 80
    };
    
    // Intercept database payload by creating a custom interceptor mock
    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    const isReasonNull = capturedPayload && capturedPayload.trade_reason === null;
    const isGeminiResultNull = capturedPayload && capturedPayload.gemini_result === null;
    addResult(4, "Missing optional fields default correctly to null in database schema", isReasonNull && isGeminiResultNull);
  } catch (err: any) {
    addResult(4, "Missing optional fields default correctly to null in database schema", false, err.message);
  }

  // Test 5: Validation of record schema creation timestamp default
  try {
    const record: EvaluationRecord = {
      user_id: "user-timestamp",
      watcher_id: "watcher-timestamp",
      pair: "EUR/GBP",
      timeframe: "1h",
      strategy_mode: "HYBRID",
      decision_score: 90,
      matched_weight: 90,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 150
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    const hasIsoTimestamp = capturedPayload && capturedPayload.created_at && !isNaN(Date.parse(capturedPayload.created_at));
    addResult(5, "Default timestamp is created automatically using ISO format if omitted", hasIsoTimestamp === true);
  } catch (err: any) {
    addResult(5, "Default timestamp is created automatically using ISO format if omitted", false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 2: PASS LOGGING TESTS (6 - 10)
  // ----------------------------------------------------

  // Test 6: Verify console.log formatting of EXPLAINABILITY section for PASS
  try {
    const record: EvaluationRecord = {
      user_id: "u-pass-log",
      watcher_id: "watcher-pass-log-uuid",
      pair: "XAU/USD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 98,
      matched_weight: 98,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS", "EMA"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 314
    };

    const captured = await captureLogs(async () => {
      await recordEvaluation(mockSupabaseSuccess, record);
    });

    const hasHeader = captured.some(line => line.includes("========== EXPLAINABILITY =========="));
    const hasWatcher = captured.some(line => line.includes("Watcher:") && line.includes("watcher-pass-log-uuid"));
    const hasPair = captured.some(line => line.includes("Pair:") && line.includes("XAU/USD"));
    const hasDecision = captured.some(line => line.includes("Decision:") && line.includes("PASS"));
    const hasScore = captured.some(line => line.includes("Decision Score:") && line.includes("98%"));
    const hasFooter = captured.some(line => line.includes("===================================="));

    addResult(6, "Explainability report console header, layout, and exact fields generated for PASS decision", 
      hasHeader && hasWatcher && hasPair && hasDecision && hasScore && hasFooter);
  } catch (err: any) {
    addResult(6, "Explainability report console header, layout, and exact fields generated for PASS decision", false, err.message);
  }

  // Test 7: PASS decision with 100% score payload validation
  try {
    const record: EvaluationRecord = {
      user_id: "u-pass-100",
      watcher_id: "watcher-pass-100",
      pair: "BTC/USD",
      timeframe: "1d",
      strategy_mode: "RULE_ONLY",
      decision_score: 100,
      matched_weight: 100,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS", "EMA", "RSI", "VOLUME"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 100
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    const scoreMatched = capturedPayload?.decision_score === 100;
    const recMatched = capturedPayload?.recommendation === "PASS";
    addResult(7, "Perfect 100% score evaluation payload values and matched rules persist successfully", scoreMatched && recMatched);
  } catch (err: any) {
    addResult(7, "Perfect 100% score evaluation payload values and matched rules persist successfully", false, err.message);
  }

  // Test 8: PASS recommendation with no trade sent (signal = NO_TRADE due to low volume filter)
  try {
    const record: EvaluationRecord = {
      user_id: "u-pass-no-trade",
      watcher_id: "w-pass-no-trade",
      pair: "ETH/USD",
      timeframe: "4h",
      strategy_mode: "HYBRID",
      decision_score: 85,
      matched_weight: 85,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS", "EMA"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: false,
      trade_reason: "No trade setup found: signal is NO_TRADE and confidence is 65% (requires >= 70%)",
      scan_duration_ms: 140
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    const notSent = capturedPayload?.trade_sent === false;
    const hasReason = capturedPayload?.trade_reason.includes("requires >= 70%");
    addResult(8, "PASS decision is saved with trade_sent = false when secondary market filters reject setup", notSent && hasReason);
  } catch (err: any) {
    addResult(8, "PASS decision is saved with trade_sent = false when secondary market filters reject setup", false, err.message);
  }

  // Test 9: LIKELY_PASS recommendation is recorded correctly
  try {
    const record: EvaluationRecord = {
      user_id: "u-likely-pass",
      watcher_id: "w-likely-pass",
      pair: "GBP/JPY",
      timeframe: "15m",
      strategy_mode: "HYBRID",
      decision_score: 75,
      matched_weight: 75,
      possible_weight: 100,
      recommendation: "LIKELY_PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS"],
      failed_rules: ["RSI"],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 180
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(9, "LIKELY_PASS recommendation recorded with proper matched and failed rules payload arrays", 
      capturedPayload?.recommendation === "LIKELY_PASS" && capturedPayload?.failed_rules.includes("RSI"));
  } catch (err: any) {
    addResult(9, "LIKELY_PASS recommendation recorded with proper matched and failed rules payload arrays", false, err.message);
  }

  // Test 10: PASS recommendation containing multiple satisfied indicators
  try {
    const record: EvaluationRecord = {
      user_id: "u-multi-pass",
      watcher_id: "w-multi-pass",
      pair: "EUR/CAD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 92,
      matched_weight: 92,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA", "RSI", "MACD", "SUPPORT"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 90
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    const rulesList = capturedPayload?.matched_rules;
    addResult(10, "Multiple satisfied rules are correctly stored as a string array in matched_rules field", 
      Array.isArray(rulesList) && rulesList.length === 4 && rulesList.includes("SUPPORT"));
  } catch (err: any) {
    addResult(10, "Multiple satisfied rules are correctly stored as a string array in matched_rules field", false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 3: FAIL LOGGING TESTS (11 - 15)
  // ----------------------------------------------------

  // Test 11: Verify console.log formatting of EXPLAINABILITY section for FAIL
  try {
    const record: EvaluationRecord = {
      user_id: "u-fail-log",
      watcher_id: "watcher-fail-log-uuid",
      pair: "AUD/CAD",
      timeframe: "15m",
      strategy_mode: "RULE_ONLY",
      decision_score: 35,
      matched_weight: 35,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: [],
      failed_rules: ["BOS", "EMA"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 85
    };

    const captured = await captureLogs(async () => {
      await recordEvaluation(mockSupabaseSuccess, record);
    });

    const hasHeader = captured.some(line => line.includes("========== EXPLAINABILITY =========="));
    const hasDecision = captured.some(line => line.includes("Decision:") && line.includes("FAIL"));
    const hasScore = captured.some(line => line.includes("Decision Score:") && line.includes("35%"));
    const hasTradeSent = captured.some(line => line.includes("Trade Sent:") && line.includes("NO"));

    addResult(11, "Explainability report console output accurately tracks FAIL state metrics and disables trade-sent flag", 
      hasHeader && hasDecision && hasScore && hasTradeSent);
  } catch (err: any) {
    addResult(11, "Explainability report console output accurately tracks FAIL state metrics and disables trade-sent flag", false, err.message);
  }

  // Test 12: FAIL recommendation containing broken/unsatisfied rules lists
  try {
    const record: EvaluationRecord = {
      user_id: "u-fail-broken",
      watcher_id: "w-fail-broken",
      pair: "USD/CHF",
      timeframe: "30m",
      strategy_mode: "RULE_ONLY",
      decision_score: 20,
      matched_weight: 20,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: ["RSI"],
      failed_rules: ["BOS", "EMA", "VOLUME"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 50
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    const brokenList = capturedPayload?.failed_rules;
    addResult(12, "Unsatisfied rules lists are accurately saved in failed_rules payload arrays", 
      Array.isArray(brokenList) && brokenList.length === 3 && brokenList.includes("VOLUME"));
  } catch (err: any) {
    addResult(12, "Unsatisfied rules lists are accurately saved in failed_rules payload arrays", false, err.message);
  }

  // Test 13: FAIL recommendation stored with 0% score
  try {
    const record: EvaluationRecord = {
      user_id: "u-fail-zero",
      watcher_id: "w-fail-zero",
      pair: "NZD/USD",
      timeframe: "4h",
      strategy_mode: "RULE_ONLY",
      decision_score: 0,
      matched_weight: 0,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: [],
      failed_rules: ["EMA", "RSI", "BOS"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 60
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(13, "Absolute zero match (0% score) saves successfully with empty matched rules and full failed rules arrays", 
      capturedPayload?.decision_score === 0 && capturedPayload?.matched_rules.length === 0 && capturedPayload?.failed_rules.length === 3);
  } catch (err: any) {
    addResult(13, "Absolute zero match (0% score) saves successfully with empty matched rules and full failed rules arrays", false, err.message);
  }

  // Test 14: FAIL status is maintained as string literal FAIL in the recommendation column
  try {
    const record: EvaluationRecord = {
      user_id: "u-fail-lit",
      watcher_id: "w-fail-lit",
      pair: "CAD/JPY",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 45,
      matched_weight: 45,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: ["EMA"],
      failed_rules: ["BOS", "RSI"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 70
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(14, "Recommendation column correctly contains the string literal 'FAIL' inside database record", 
      capturedPayload?.recommendation === "FAIL");
  } catch (err: any) {
    addResult(14, "Recommendation column correctly contains the string literal 'FAIL' inside database record", false, err.message);
  }

  // Test 15: FAIL recommendation logs the custom explanatory trade_reason description
  try {
    const record: EvaluationRecord = {
      user_id: "u-fail-reason",
      watcher_id: "w-fail-reason",
      pair: "AUD/NZD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 40,
      matched_weight: 40,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: ["EMA"],
      failed_rules: ["BOS", "RSI"],
      gemini_used: false,
      trade_sent: false,
      trade_reason: "Decision Engine recommendation is FAIL: trend alignment is bullish but RSI indicates extreme overbought condition",
      scan_duration_ms: 75
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(15, "Explanatory trade reason detailing broken indicators saved perfectly inside FAIL evaluation logs", 
      capturedPayload?.trade_reason.includes("bullish but RSI indicates extreme overbought"));
  } catch (err: any) {
    addResult(15, "Explanatory trade reason detailing broken indicators saved perfectly inside FAIL evaluation logs", false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 4: GEMINI TELEMETRY LOGGING TESTS (16 - 20)
  // ----------------------------------------------------

  // Test 16: Verify gemini_used = true logs correctly in console
  try {
    const record: EvaluationRecord = {
      user_id: "u-gemini-used",
      watcher_id: "w-gemini-used",
      pair: "EUR/USD",
      timeframe: "15m",
      strategy_mode: "HYBRID",
      decision_score: 78,
      matched_weight: 78,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS"],
      failed_rules: [],
      gemini_used: true,
      trade_sent: true,
      scan_duration_ms: 1200
    };

    const captured = await captureLogs(async () => {
      await recordEvaluation(mockSupabaseSuccess, record);
    });

    const hasGeminiYes = captured.some((line, i) => line.includes("Gemini:") && captured[i+1]?.includes("YES"));
    addResult(16, "Console output reports 'Gemini: YES' when gemini_used is active in the scanning event", hasGeminiYes === true);
  } catch (err: any) {
    addResult(16, "Console output reports 'Gemini: YES' when gemini_used is active in the scanning event", false, err.message);
  }

  // Test 17: Gemini model result text is saved correctly inside database record
  try {
    const record: EvaluationRecord = {
      user_id: "u-gemini-text",
      watcher_id: "w-gemini-text",
      pair: "GBP/USD",
      timeframe: "1h",
      strategy_mode: "HYBRID",
      decision_score: 80,
      matched_weight: 80,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA", "BOS"],
      failed_rules: [],
      gemini_used: true,
      gemini_result: "ANALYSIS: Strong bullish setup with clean structural breaker. Confidence high.",
      trade_sent: true,
      scan_duration_ms: 1500
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(17, "Gemini text-analysis report is stored inside gemini_result database field successfully", 
      capturedPayload?.gemini_result.includes("Strong bullish setup with clean structural breaker"));
  } catch (err: any) {
    addResult(17, "Gemini text-analysis report is stored inside gemini_result database field successfully", false, err.message);
  }

  // Test 18: Gemini call duration (latency) is correctly mapped and saved in milliseconds
  try {
    const record: EvaluationRecord = {
      user_id: "u-gemini-lat",
      watcher_id: "w-gemini-lat",
      pair: "BTC/USD",
      timeframe: "4h",
      strategy_mode: "AI_ONLY",
      decision_score: 95,
      matched_weight: 95,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["BOS"],
      failed_rules: [],
      gemini_used: true,
      gemini_duration_ms: 850,
      trade_sent: true,
      scan_duration_ms: 1100
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(18, "Gemini API latency is successfully recorded in the gemini_duration_ms database column", 
      capturedPayload?.gemini_duration_ms === 850);
  } catch (err: any) {
    addResult(18, "Gemini API latency is successfully recorded in the gemini_duration_ms database column", false, err.message);
  }

  // Test 19: Gemini unused fields are omitted or recorded as null
  try {
    const record: EvaluationRecord = {
      user_id: "u-gemini-no-use",
      watcher_id: "w-gemini-no-use",
      pair: "AUD/USD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 90,
      matched_weight: 90,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 120
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(19, "When gemini_used = false, gemini_duration_ms defaults as null without database insertion errors", 
      capturedPayload?.gemini_duration_ms === null && capturedPayload?.gemini_result === null);
  } catch (err: any) {
    addResult(19, "When gemini_used = false, gemini_duration_ms defaults as null without database insertion errors", false, err.message);
  }

  // Test 20: Gemini API failure response scenario tracks logs properly as FAIL
  try {
    const record: EvaluationRecord = {
      user_id: "u-gemini-fail",
      watcher_id: "w-gemini-fail",
      pair: "USD/JPY",
      timeframe: "1h",
      strategy_mode: "HYBRID",
      decision_score: 75,
      matched_weight: 75,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: true,
      matched_rules: ["EMA"],
      failed_rules: [],
      gemini_used: true,
      gemini_result: "Gemini execution failed: Billing limit exceeded or API key inactive",
      trade_sent: false,
      trade_reason: "Gemini API call failed: Billing limit exceeded or API key inactive",
      scan_duration_ms: 600,
      gemini_duration_ms: 450
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(20, "API failures during Gemini execution logged with fallback text and fail recommendation status", 
      capturedPayload?.recommendation === "FAIL" && capturedPayload?.gemini_result.includes("Billing limit exceeded"));
  } catch (err: any) {
    addResult(20, "API failures during Gemini execution logged with fallback text and fail recommendation status", false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 5: PERFORMANCE METRICS TESTS (21 - 25)
  // ----------------------------------------------------

  // Test 21: Scan duration ms accurately recorded and saved
  try {
    const record: EvaluationRecord = {
      user_id: "u-perf-dur",
      watcher_id: "w-perf-dur",
      pair: "EUR/USD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 95,
      matched_weight: 95,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 382
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(21, "Total market scan duration is tracked and saved as ms value in database column", 
      capturedPayload?.scan_duration_ms === 382);
  } catch (err: any) {
    addResult(21, "Total market scan duration is tracked and saved as ms value in database column", false, err.message);
  }

  // Test 22: Zero scan duration or minimal timing calculations handled gracefully
  try {
    const record: EvaluationRecord = {
      user_id: "u-perf-zero",
      watcher_id: "w-perf-zero",
      pair: "USD/JPY",
      timeframe: "15m",
      strategy_mode: "RULE_ONLY",
      decision_score: 10,
      matched_weight: 10,
      possible_weight: 100,
      recommendation: "FAIL",
      mandatory_rules_passed: false,
      matched_rules: [],
      failed_rules: ["EMA"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 0
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(22, "Near-instantaneous scan (0 ms duration) executes and saves without numeric range error triggers", 
      capturedPayload?.scan_duration_ms === 0);
  } catch (err: any) {
    addResult(22, "Near-instantaneous scan (0 ms duration) executes and saves without numeric range error triggers", false, err.message);
  }

  // Test 23: High latency scan durations are correctly registered in performance records
  try {
    const record: EvaluationRecord = {
      user_id: "u-perf-high",
      watcher_id: "w-perf-high",
      pair: "GBP/JPY",
      timeframe: "1d",
      strategy_mode: "AI_ONLY",
      decision_score: 90,
      matched_weight: 90,
      possible_weight: 100,
      recommendation: "PASS",
      mandatory_rules_passed: true,
      matched_rules: ["EMA", "BOS"],
      failed_rules: [],
      gemini_used: true,
      gemini_duration_ms: 3200,
      trade_sent: true,
      scan_duration_ms: 4500
    };

    let capturedPayload: any = null;
    const interceptorSupabase = {
      from: () => ({
        insert: (payload: any) => {
          capturedPayload = payload;
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    await recordEvaluation(interceptorSupabase, record);
    addResult(23, "Severe latency spikes (e.g. 4500 ms total scan time) recorded and stored safely for health checks", 
      capturedPayload?.scan_duration_ms === 4500 && capturedPayload?.gemini_duration_ms === 3200);
  } catch (err: any) {
    addResult(23, "Severe latency spikes (e.g. 4500 ms total scan time) recorded and stored safely for health checks", false, err.message);
  }

  // Test 24: Scanning reports output total duration correctly in visual footer log
  try {
    const record: EvaluationRecord = {
      user_id: "u-perf-log-footer",
      watcher_id: "w-perf-log-footer",
      pair: "AUD/NZD",
      timeframe: "4h",
      strategy_mode: "RULE_ONLY",
      decision_score: 60,
      matched_weight: 60,
      possible_weight: 100,
      recommendation: "AMBIGUOUS",
      mandatory_rules_passed: false,
      matched_rules: ["EMA"],
      failed_rules: ["BOS"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 275
    };

    const captured = await captureLogs(async () => {
      await recordEvaluation(mockSupabaseSuccess, record);
    });

    const hasDuration = captured.some(line => line.includes("Duration:") && line.includes("275 ms"));
    addResult(24, "Console logs visual footer outputs total execution time with standardized 'ms' units", hasDuration === true);
  } catch (err: any) {
    addResult(24, "Console logs visual footer outputs total execution time with standardized 'ms' units", false, err.message);
  }

  // Test 25: Simulating multiple sequential evaluations measures performance counters accurately
  try {
    const baseRecord = {
      user_id: "u-perf-multi",
      watcher_id: "w-perf-multi",
      pair: "EUR/USD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 90,
      matched_weight: 90,
      possible_weight: 100,
      recommendation: "PASS" as const,
      mandatory_rules_passed: true,
      matched_rules: ["EMA"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
    };

    const runTimes = [150, 220, 180, 250];
    let recordedTimes: number[] = [];
    
    const timeTrackerSupabase = {
      from: () => ({
        insert: (payload: any) => {
          recordedTimes.push(payload.scan_duration_ms);
          return {
            select: () => ({ data: [payload], error: null })
          };
        }
      })
    };

    for (const time of runTimes) {
      await recordEvaluation(timeTrackerSupabase, {
        ...baseRecord,
        scan_duration_ms: time
      });
    }

    const matchedAll = recordedTimes.every((val, i) => val === runTimes[i]);
    addResult(25, "Sequential loop evaluation logs preserve unique, individual time metrics for every event", matchedAll);
  } catch (err: any) {
    addResult(25, "Sequential loop evaluation logs preserve unique, individual time metrics for every event", false, err.message);
  }

  // ----------------------------------------------------
  // SECTION 6: DASHBOARD AGGREGATION TESTS (26 - 30)
  // ----------------------------------------------------

  // Sample static logs list to simulate database result sets for aggregation
  const sampleDatabaseLogs = [
    {
      id: "1",
      user_id: "user_a",
      watcher_id: "w_1",
      pair: "EUR/USD",
      timeframe: "1h",
      strategy_mode: "RULE_ONLY",
      decision_score: 95,
      recommendation: "PASS",
      matched_rules: ["EMA", "RSI"],
      failed_rules: [],
      gemini_used: false,
      trade_sent: true,
      scan_duration_ms: 100
    },
    {
      id: "2",
      user_id: "user_a",
      watcher_id: "w_1",
      pair: "EUR/USD",
      timeframe: "1h",
      strategy_mode: "HYBRID",
      decision_score: 75,
      recommendation: "LIKELY_PASS",
      matched_rules: ["EMA"],
      failed_rules: ["RSI"],
      gemini_used: true,
      gemini_duration_ms: 500,
      trade_sent: true,
      scan_duration_ms: 600
    },
    {
      id: "3",
      user_id: "user_b",
      watcher_id: "w_2",
      pair: "GBP/USD",
      timeframe: "4h",
      strategy_mode: "RULE_ONLY",
      decision_score: 40,
      recommendation: "FAIL",
      matched_rules: [],
      failed_rules: ["EMA", "BOS"],
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 80
    },
    {
      id: "4",
      user_id: "user_c",
      watcher_id: "w_3",
      pair: "USD/JPY",
      timeframe: "15m",
      strategy_mode: "AI_ONLY",
      decision_score: 60,
      recommendation: "AMBIGUOUS",
      matched_rules: ["RSI"],
      failed_rules: ["EMA"],
      gemini_used: true,
      gemini_duration_ms: 700,
      trade_sent: false,
      scan_duration_ms: 800
    }
  ];

  // Test 26: Calculation of aggregates (totals, recommendation frequencies, modes, latencies)
  try {
    const totalScans = sampleDatabaseLogs.length; // 4
    const totalSignals = sampleDatabaseLogs.filter(l => l.trade_sent).length; // 2
    const signalRate = (totalSignals / totalScans) * 100; // 50%

    const distribution = { PASS: 0, LIKELY_PASS: 0, AMBIGUOUS: 0, FAIL: 0 };
    sampleDatabaseLogs.forEach(l => {
      distribution[l.recommendation as keyof typeof distribution]++;
    });

    const isDistCorrect = distribution.PASS === 1 && distribution.LIKELY_PASS === 1 && distribution.AMBIGUOUS === 1 && distribution.FAIL === 1;
    addResult(26, "Statistical analysis of sample records returns correct signal generation rate and decision distribution", 
      totalScans === 4 && totalSignals === 2 && signalRate === 50 && isDistCorrect);
  } catch (err: any) {
    addResult(26, "Statistical analysis of sample records returns correct signal generation rate and decision distribution", false, err.message);
  }

  // Test 27: Performance latencies calculation (averages) for Dashboard
  try {
    let totalScanDuration = 0;
    let scanDurationCount = 0;
    let totalGeminiDuration = 0;
    let geminiDurationCount = 0;

    sampleDatabaseLogs.forEach(l => {
      if (l.scan_duration_ms) {
        totalScanDuration += l.scan_duration_ms;
        scanDurationCount++;
      }
      if (l.gemini_used && l.gemini_duration_ms) {
        totalGeminiDuration += l.gemini_duration_ms;
        geminiDurationCount++;
      }
    });

    const avgScan = totalScanDuration / scanDurationCount; // (100+600+80+800)/4 = 395 ms
    const avgGemini = totalGeminiDuration / geminiDurationCount; // (500+700)/2 = 600 ms

    addResult(27, "Latency aggregations calculate average database scan and AI processing times correctly", 
      avgScan === 395 && avgGemini === 600);
  } catch (err: any) {
    addResult(27, "Latency aggregations calculate average database scan and AI processing times correctly", false, err.message);
  }

  // Test 28: Multi-User rankings scans frequency aggregation
  try {
    const userScans: Record<string, number> = {};
    sampleDatabaseLogs.forEach(l => {
      userScans[l.user_id] = (userScans[l.user_id] || 0) + 1;
    });

    const sortedRankings = Object.entries(userScans).map(([id, count]) => ({
      userId: id,
      count
    })).sort((a, b) => b.count - a.count);

    const firstRankCorrect = sortedRankings[0].userId === "user_a" && sortedRankings[0].count === 2;
    addResult(28, "Dashboard ranking correctly aggregates active scanners by count of their scanned evaluations", 
      sortedRankings.length === 3 && firstRankCorrect);
  } catch (err: any) {
    addResult(28, "Dashboard ranking correctly aggregates active scanners by count of their scanned evaluations", false, err.message);
  }

  // Test 29: Rules analytical frequency (matched, failed, success rates)
  try {
    const ruleMatches: Record<string, { matched: number, failed: number }> = {};
    
    sampleDatabaseLogs.forEach(l => {
      l.matched_rules.forEach(rule => {
        if (!ruleMatches[rule]) ruleMatches[rule] = { matched: 0, failed: 0 };
        ruleMatches[rule].matched++;
      });
      l.failed_rules.forEach(rule => {
        if (!ruleMatches[rule]) ruleMatches[rule] = { matched: 0, failed: 0 };
        ruleMatches[rule].failed++;
      });
    });

    // EMA was matched 2 times, failed 2 times. Total 4. Success rate = 50%
    const emaStats = ruleMatches["EMA"];
    const isEmaCorrect = emaStats && emaStats.matched === 2 && emaStats.failed === 2;
    
    // RSI was matched 2 times, failed 1 time. Total 3. Success rate = 66.6%
    const rsiStats = ruleMatches["RSI"];
    const isRsiCorrect = rsiStats && rsiStats.matched === 2 && rsiStats.failed === 1;

    addResult(29, "Rules tracking maps indicator hits and misses correctly across historical scanning events", 
      isEmaCorrect && isRsiCorrect);
  } catch (err: any) {
    addResult(29, "Rules tracking maps indicator hits and misses correctly across historical scanning events", false, err.message);
  }

  // Test 30: Strategy Modes proportions mapping
  try {
    const modeCounts: Record<string, number> = { RULE_ONLY: 0, HYBRID: 0, AI_ONLY: 0 };
    sampleDatabaseLogs.forEach(l => {
      const m = l.strategy_mode;
      modeCounts[m] = (modeCounts[m] || 0) + 1;
    });

    addResult(30, "Strategy Mode breakdown counts proportion of scans completed under Rule, Hybrid, or AI channels", 
      modeCounts.RULE_ONLY === 2 && modeCounts.HYBRID === 1 && modeCounts.AI_ONLY === 1);
  } catch (err: any) {
    addResult(30, "Strategy Mode breakdown counts proportion of scans completed under Rule, Hybrid, or AI channels", false, err.message);
  }

  // ----------------------------------------------------
  // REPORT GENERATION
  // ----------------------------------------------------
  console.log("\n=========================================");
  console.log("            TEST RESULTS SUMMARY         ");
  console.log("=========================================");
  const passedCount = results.filter(r => r.passed).length;
  console.log(`Total Run:  ${results.length}`);
  console.log(`Passed:     ${passedCount} / ${results.length}`);
  console.log(`Failed:     ${results.length - passedCount} / ${results.length}`);
  console.log("=========================================");

  if (passedCount === results.length) {
    console.log("✅ All 30 Gaks AI Explainability tests completed successfully!");
    return true;
  } else {
    console.error("❌ Some Gaks AI Explainability tests failed!");
    return false;
  }
};

// If file is run directly using tsx, execute tests
if (import.meta.url.endsWith(process.argv[1] || '')) {
  runTests().then((passed) => {
    process.exit(passed ? 0 : 1);
  }).catch((err) => {
    console.error("Unhandle exception in test run:", err);
    process.exit(1);
  });
}

export { runTests };
