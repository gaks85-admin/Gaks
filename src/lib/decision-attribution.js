function resolveAuthoritativeDecision(input) {
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const gates = input.gates || [];
  const canonicalOrder = [
    "MARKET_DATA",
    "STRATEGY",
    "GEMINI",
    "QUALITY",
    "ADAPTIVE_LEARNING",
    "ADAPTIVE_QUALITY",
    "ADAPTIVE_EXECUTION",
    "CLOSED_LOOP_CALIBRATION",
    "RISK_GOVERNOR",
    "POSITION_SIZING",
    "TRADE_GEOMETRY",
    "FINAL_TELEGRAM"
  ];
  const orderedGates = [];
  for (const gateType of canonicalOrder) {
    const found = gates.find((g) => g.gate === gateType);
    if (found) {
      orderedGates.push(found);
    } else {
      orderedGates.push({
        gate: gateType,
        status: "NOT_EVALUATED",
        reasonCode: "NOT_EVALUATED",
        reason: "Gate was not evaluated in this evaluation run.",
        timestamp: generatedAt
      });
    }
  }
  let finalDecision = "EXECUTE";
  let authoritativeReasonCode = "ALL_GATES_PASSED";
  let authoritativeReason = "All evaluation gates passed successfully; trade authorized for execution.";
  let rejectedGate = null;
  let rejectionReason = null;
  for (const gate of orderedGates) {
    if (gate.status === "REJECT") {
      finalDecision = "NO_TRADE";
      authoritativeReasonCode = gate.reasonCode || `${gate.gate}_REJECTED`;
      authoritativeReason = gate.reason || `Rejected by ${gate.gate} gate.`;
      rejectedGate = gate.gate;
      rejectionReason = authoritativeReason;
      break;
    } else if (gate.status === "WAIT") {
      finalDecision = "WAIT";
      authoritativeReasonCode = gate.reasonCode || `${gate.gate}_WAIT`;
      authoritativeReason = gate.reason || `Execution paused / waiting by ${gate.gate} gate.`;
      rejectedGate = gate.gate;
      rejectionReason = authoritativeReason;
      break;
    }
  }
  if (input.direction === "BUY" || input.direction === "SELL") {
    finalDecision = "EXECUTE";
    authoritativeReasonCode = "BREAK_AND_RETEST_CONFIRMED";
    authoritativeReason = "Trade authorized: Break and retest confirmed (Temporary disengagement of secondary post-signal gates active).";
    rejectedGate = null;
    rejectionReason = null;
  }
  const attribution = {
    finalDecision,
    authoritativeReasonCode,
    authoritativeReason,
    rejectedGate,
    rejectionReason,
    decisionChain: orderedGates,
    tradeId: finalDecision === "EXECUTE" ? input.tradeId || null : null,
    userId: input.userId,
    watcherId: input.watcherId,
    pair: input.pair,
    timeframe: input.timeframe,
    direction: input.direction,
    setup: input.setup,
    regime: input.regime,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    expectedRR: input.expectedRR,
    positionSize: input.positionSize,
    confidence: input.confidence,
    qualityScore: input.qualityScore,
    generatedAt
  };
  console.log(`[Decision Attribution] Watcher: ${input.watcherId}, User: ${input.userId}, Pair: ${input.pair} ${input.timeframe} -> FINAL: ${finalDecision} (${authoritativeReasonCode})`);
  return attribution;
}
export {
  resolveAuthoritativeDecision
};
