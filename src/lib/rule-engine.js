import { compileStrategy } from "./strategy-compiler.js";
import {
  buildStrategyBlueprint,
  computeAtr,
  executeStrategyBlueprint
} from "./strategy-modules/index.js";
function evaluateRules(watcher, candles, options = {}) {
  const safeCandles = Array.isArray(candles) ? candles : [];
  const strategyText = options.strategyText || watcher?.strategy_text || watcher?.strategy || watcher?.compiled_strategy_text || "";
  let compiled = options.compiledStrategy || null;
  if (!compiled && typeof strategyText === "string" && strategyText.trim().length > 0) {
    compiled = compileStrategy(strategyText);
  }
  const blueprint = options.blueprint || compiled?.blueprint || (compiled ? buildStrategyBlueprint(compiled) : void 0);
  const watcherActive = Boolean(watcher && watcher.status === "active");
  const tradeStatusOk = watcher?.has_open_trade !== true && watcher?.trade_status !== "OPEN";
  const nowMs = (options.now || /* @__PURE__ */ new Date()).getTime();
  const lastScan = watcher?.last_scan_at ? new Date(watcher.last_scan_at).getTime() : 0;
  const cooldownMs = 60 * 1e3;
  const cooldownPassed = !watcher?.last_scan_at || nowMs - lastScan >= cooldownMs;
  const userTimeframeValid = Boolean(watcher?.selected_timeframe);
  const report = blueprint && blueprint.activatedModuleIds.length > 0 && safeCandles.length >= 2 ? executeStrategyBlueprint(compiled || blueprint, safeCandles, {
    pair: watcher?.selected_pair,
    timeframe: watcher?.selected_timeframe,
    now: options.now
  }) : null;
  const ms = report?.marketStructure || {};
  const results = report?.resultsByModule || {};
  const atr = Number((ms.volatilityInformation?.atr ?? computeAtr(safeCandles, 14)) || 0);
  const rawTrend = String(ms.trend || "SIDEWAYS").toUpperCase();
  const trend = rawTrend === "BULLISH" ? "Bullish" : rawTrend === "BEARISH" ? "Bearish" : "Neutral";
  const isActivated = (id) => Boolean(report?.executedModules.includes(id));
  const sessionRes = results["session"];
  const marketSessionActive = isActivated("session") ? Boolean(sessionRes?.matched) : true;
  const session = sessionRes?.metrics?.activeSessions?.join("/") || ms.session || "Any UTC Session";
  const atrRes = results["atr"];
  const atrFilterPassed = isActivated("atr") ? Boolean(atrRes?.matched) : atr > 0;
  const emaRes = results["ema"];
  const emaTrendPassed = isActivated("ema") ? Boolean(emaRes?.matched) : true;
  const supportRes = results["support"] || results["support_rejection"];
  const resistanceRes = results["resistance"] || results["resistance_rejection"];
  const srActive = isActivated("support") || isActivated("resistance") || isActivated("support_rejection") || isActivated("resistance_rejection");
  const supportProximity = Boolean(supportRes?.matched);
  const resistanceProximity = Boolean(resistanceRes?.matched);
  const srProximityPassed = srActive ? supportProximity || resistanceProximity : true;
  const breakoutRes = results["trendline_breakout"];
  const breakout = Boolean(breakoutRes?.matched);
  const trendlineBreakoutPassed = isActivated("trendline_breakout") ? breakout : true;
  const volumeRes = results["volume_confirmation"];
  const volumeConfirmed = Boolean(volumeRes?.matched);
  const volumeConfirmationPassed = isActivated("volume_confirmation") ? volumeConfirmed : true;
  const mandatoryRulesPassed = report ? report.mandatoryPassed : true;
  const details = {
    watcherActive,
    tradeStatusOk,
    cooldownPassed,
    marketSessionActive,
    atrFilterPassed,
    emaTrendPassed,
    srProximityPassed,
    trendlineBreakoutPassed,
    volumeConfirmationPassed,
    userTimeframeValid,
    mandatoryRulesPassed
  };
  const preflightPassed = watcherActive && tradeStatusOk && cooldownPassed && userTimeframeValid;
  const score = report ? report.score : Math.round(
    [watcherActive, tradeStatusOk, cooldownPassed, atrFilterPassed, userTimeframeValid].filter(Boolean).length / 5 * 100
  );
  const passed = report ? Boolean(preflightPassed && report.passed) : Boolean(preflightPassed && atrFilterPassed);
  return {
    trend,
    atr,
    session,
    breakout,
    volumeConfirmed,
    supportProximity,
    resistanceProximity,
    score,
    passed,
    geminiCalled: false,
    blueprint,
    activatedModules: report?.activatedModules || [],
    skippedModules: report?.skippedModules || [],
    passedModules: report?.passedModules || [],
    failedModules: report?.failedModules || [],
    moduleResults: results,
    details
  };
}
function logRuleEngineAudit(result) {
  console.log(`
========== MODULAR RULE ENGINE ==========`);
  console.log(`Trend: ${result.trend}`);
  console.log(`ATR: ${result.atr.toFixed(5)}`);
  console.log(`Session: ${result.session}`);
  if (result.activatedModules && result.activatedModules.length > 0) {
    console.log(`Activated Modules (${result.activatedModules.length}): [${result.activatedModules.join(", ")}]`);
    console.log(`Passed Modules: [${(result.passedModules || []).join(", ")}]`);
    console.log(`Failed Modules: [${(result.failedModules || []).join(", ")}]`);
  }
  console.log(`Score: ${result.score}/100`);
  console.log(`Passed: ${result.passed ? "YES" : "NO"}`);
  console.log(`Gemini Called: ${result.geminiCalled ? "YES" : "NO"}`);
  console.log(`=========================================
`);
}
export {
  evaluateRules,
  logRuleEngineAudit
};
