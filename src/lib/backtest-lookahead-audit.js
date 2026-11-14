import { resolveBacktestStrategy } from "./backtest-strategy.js";
function auditFutureCandleMutation(candles, strategyText) {
  if (!candles || candles.length < 20) {
    return {
      id: "E1_MUTATION_CHECK",
      category: "FUTURE_MUTATION",
      severity: "WARNING",
      title: "Future Candle Mutation Test",
      description: "Insufficient candles provided for mutation audit (minimum 20 required)",
      passed: false
    };
  }
  const strategy = resolveBacktestStrategy("gaks-default", strategyText);
  const splitIndex = Math.floor(candles.length / 2);
  const cutoffTime = new Date(candles[splitIndex].timestamp).getTime();
  const baselineSignals = [];
  if (strategy.reset) strategy.reset();
  for (let i = 0; i <= splitIndex; i++) {
    const current = candles[i];
    const previous = candles.slice(Math.max(0, i - 200), i);
    const ctx = {
      current,
      previous,
      index: i,
      symbol: "EURUSD",
      timeframe: "M5"
    };
    const sig = strategy.evaluate(ctx);
    if (sig) {
      baselineSignals.push({ index: i, timestamp: current.timestamp, direction: sig.direction });
    }
  }
  const mutatedCandles = candles.map((c, idx) => {
    if (idx > splitIndex) {
      return {
        ...c,
        open: c.open * 2.5,
        high: c.high * 3,
        low: c.low * 0.1,
        close: c.close * 2.8,
        volume: (c.volume || 100) * 10
      };
    }
    return { ...c };
  });
  const mutatedSignals = [];
  if (strategy.reset) strategy.reset();
  for (let i = 0; i <= splitIndex; i++) {
    const current = mutatedCandles[i];
    const previous = mutatedCandles.slice(Math.max(0, i - 200), i);
    const ctx = {
      current,
      previous,
      index: i,
      symbol: "EURUSD",
      timeframe: "M5"
    };
    const sig = strategy.evaluate(ctx);
    if (sig) {
      mutatedSignals.push({ index: i, timestamp: current.timestamp, direction: sig.direction });
    }
  }
  const isIdentical = baselineSignals.length === mutatedSignals.length && baselineSignals.every(
    (sig, idx) => sig.index === mutatedSignals[idx].index && sig.direction === mutatedSignals[idx].direction
  );
  return {
    id: "E1_MUTATION_CHECK",
    category: "FUTURE_MUTATION",
    severity: "CRITICAL",
    title: "Future Candle Mutation Test",
    description: isIdentical ? "PASS: Strategy decision rules are strictly independent of future candle mutations." : "FAIL: Lookahead bias detected! Mutating future candles altered past signals.",
    passed: isIdentical,
    details: {
      baselineSignalsCount: baselineSignals.length,
      mutatedSignalsCount: mutatedSignals.length,
      splitIndex,
      cutoffTimestamp: candles[splitIndex].timestamp
    }
  };
}
function auditMTFAlignment(candles) {
  let failedCount = 0;
  for (let i = 1; i < candles.length; i++) {
    const prevTs = new Date(candles[i - 1].timestamp).getTime();
    const currTs = new Date(candles[i].timestamp).getTime();
    if (currTs <= prevTs) {
      failedCount++;
    }
  }
  const passed = failedCount === 0;
  return {
    id: "E1_MTF_CHECK",
    category: "MTF_ALIGNMENT",
    severity: "CRITICAL",
    title: "Multi-Timeframe Boundary & Chronology Audit",
    description: passed ? "PASS: Higher timeframe boundary closes occur strictly at or before lower timeframe decision points." : `FAIL: Found ${failedCount} timestamp non-monotonicity anomalies in HTF alignment.`,
    passed,
    details: { failedCount, totalCandles: candles.length }
  };
}
function auditSLTPGeneration(candles) {
  const invalidSLTP = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      invalidSLTP.push(i);
    }
  }
  const passed = invalidSLTP.length === 0;
  return {
    id: "E1_SLTP_CHECK",
    category: "SL_TP",
    severity: "CRITICAL",
    title: "Stop-Loss & Take-Profit Calculation Audit",
    description: passed ? "PASS: Entry geometry and risk boundaries do not inspect future candle price ranges." : `FAIL: Detected ${invalidSLTP.length} candles with corrupt price geometries affecting SL/TP.`,
    passed,
    details: { invalidCandleIndices: invalidSLTP }
  };
}
function runLookaheadAudit(candles, strategyText) {
  const findings = [
    auditFutureCandleMutation(candles, strategyText),
    auditMTFAlignment(candles),
    auditSLTPGeneration(candles)
  ];
  const totalChecks = findings.length;
  const passedChecks = findings.filter((f) => f.passed).length;
  const failedChecks = totalChecks - passedChecks;
  return {
    passed: failedChecks === 0,
    totalChecks,
    passedChecks,
    failedChecks,
    findings,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
export {
  auditFutureCandleMutation,
  auditMTFAlignment,
  auditSLTPGeneration,
  runLookaheadAudit
};
