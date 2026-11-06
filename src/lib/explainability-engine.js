async function recordEvaluation(supabase, record) {
  const startTime = Date.now();
  let storedSuccessfully = false;
  const payload = {
    user_id: record.user_id,
    watcher_id: record.watcher_id,
    pair: record.pair,
    timeframe: record.timeframe,
    strategy_mode: record.strategy_mode,
    decision_score: record.decision_score,
    matched_weight: record.matched_weight,
    possible_weight: record.possible_weight,
    recommendation: record.recommendation,
    mandatory_rules_passed: record.mandatory_rules_passed,
    matched_rules: record.matched_rules,
    failed_rules: record.failed_rules,
    gemini_used: record.gemini_used,
    gemini_result: record.gemini_result || null,
    trade_sent: record.trade_sent,
    trade_reason: record.trade_reason || null,
    scan_duration_ms: record.scan_duration_ms,
    gemini_duration_ms: record.gemini_duration_ms || null,
    created_at: record.created_at || (/* @__PURE__ */ new Date()).toISOString(),
    decision_snapshot: record.decision_snapshot || {}
  };
  if (supabase && typeof supabase.from === "function") {
    try {
      const { data, error } = await supabase.from("watcher_evaluations").insert(payload).select();
      if (!error) {
        storedSuccessfully = true;
      } else {
        console.warn(`[Explainability Engine] Database insert failed:`, error.message);
      }
    } catch (dbErr) {
      console.warn(`[Explainability Engine] Exception during database write:`, dbErr);
    }
  }
  if (!storedSuccessfully && typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    try {
      const storageKey = "gaks_watcher_evaluations";
      const existingStr = localStorage.getItem(storageKey) || "[]";
      const existing = JSON.parse(existingStr);
      const mockRecord = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + "-" + Date.now(),
        ...payload
      };
      existing.push(mockRecord);
      localStorage.setItem(storageKey, JSON.stringify(existing));
      storedSuccessfully = true;
    } catch (storageErr) {
      console.error(`[Explainability Engine] LocalStorage write failed:`, storageErr);
    }
  }
  const shortWatcher = record.watcher_id ? record.watcher_id.length > 8 ? record.watcher_id.slice(0, 8) + "..." : record.watcher_id : "unknown";
  console.log(`[EXPLAIN] saved | watcher=${shortWatcher} | decision=${record.recommendation || (record.trade_sent ? "TRADE" : "NO_TRADE")}`);
  return storedSuccessfully;
}
export {
  recordEvaluation
};
