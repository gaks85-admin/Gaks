export type DecisionGateType =
  | 'MARKET_DATA'
  | 'STRATEGY'
  | 'GEMINI'
  | 'QUALITY'
  | 'ADAPTIVE_LEARNING'
  | 'ADAPTIVE_QUALITY'
  | 'ADAPTIVE_EXECUTION'
  | 'CLOSED_LOOP_CALIBRATION'
  | 'RISK_GOVERNOR'
  | 'POSITION_SIZING'
  | 'TRADE_GEOMETRY'
  | 'FINAL_TELEGRAM';

export type GateStatus = 'PASS' | 'REJECT' | 'WAIT' | 'NOT_EVALUATED';

export interface DecisionGateResult {
  gate: DecisionGateType;
  status: GateStatus;
  reasonCode: string;
  reason: string;
  metrics?: Record<string, unknown>;
  timestamp: string;
}

export type FinalDecision = 'EXECUTE' | 'WAIT' | 'NO_TRADE';

export interface DecisionAttribution {
  finalDecision: FinalDecision;
  authoritativeReasonCode: string;
  authoritativeReason: string;
  rejectedGate?: DecisionGateType | null;
  rejectionReason?: string | null;
  decisionChain: DecisionGateResult[];
  tradeId?: string | null;
  userId: string;
  watcherId: string;
  pair: string;
  timeframe: string;
  direction?: 'BUY' | 'SELL' | 'NO_TRADE';
  setup?: string | null;
  regime?: string | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  expectedRR?: number | null;
  positionSize?: number | null;
  confidence?: number | null;
  qualityScore?: number | null;
  generatedAt: string;
}

export interface ResolveDecisionInput {
  userId: string;
  watcherId: string;
  pair: string;
  timeframe: string;
  direction?: 'BUY' | 'SELL' | 'NO_TRADE';
  setup?: string | null;
  regime?: string | null;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  expectedRR?: number | null;
  positionSize?: number | null;
  confidence?: number | null;
  qualityScore?: number | null;
  tradeId?: string | null;
  gates: DecisionGateResult[];
}

/**
 * Resolves the authoritative final decision and reason code from the decision gate chain
 * according to strict pipeline order and safety precedence.
 */
export function resolveAuthoritativeDecision(input: ResolveDecisionInput): DecisionAttribution {
  const generatedAt = new Date().toISOString();
  const gates = input.gates || [];

  // Canonical pipeline order
  const canonicalOrder: DecisionGateType[] = [
    'MARKET_DATA',
    'STRATEGY',
    'GEMINI',
    'QUALITY',
    'ADAPTIVE_LEARNING',
    'ADAPTIVE_QUALITY',
    'ADAPTIVE_EXECUTION',
    'CLOSED_LOOP_CALIBRATION',
    'RISK_GOVERNOR',
    'POSITION_SIZING',
    'TRADE_GEOMETRY',
    'FINAL_TELEGRAM'
  ];

  // Sort or map gates by canonical order
  const orderedGates: DecisionGateResult[] = [];
  for (const gateType of canonicalOrder) {
    const found = gates.find(g => g.gate === gateType);
    if (found) {
      orderedGates.push(found);
    } else {
      orderedGates.push({
        gate: gateType,
        status: 'NOT_EVALUATED',
        reasonCode: 'NOT_EVALUATED',
        reason: 'Gate was not evaluated in this evaluation run.',
        timestamp: generatedAt
      });
    }
  }

  // Determine final decision & authoritative reason by scanning in pipeline order
  let finalDecision: FinalDecision = 'EXECUTE';
  let authoritativeReasonCode = 'ALL_GATES_PASSED';
  let authoritativeReason = 'All evaluation gates passed successfully; trade authorized for execution.';
  let rejectedGate: DecisionGateType | null = null;
  let rejectionReason: string | null = null;

  for (const gate of orderedGates) {
    if (gate.status === 'REJECT') {
      finalDecision = 'NO_TRADE';
      authoritativeReasonCode = gate.reasonCode || `${gate.gate}_REJECTED`;
      authoritativeReason = gate.reason || `Rejected by ${gate.gate} gate.`;
      rejectedGate = gate.gate;
      rejectionReason = authoritativeReason;
      break;
    } else if (gate.status === 'WAIT') {
      finalDecision = 'WAIT';
      authoritativeReasonCode = gate.reasonCode || `${gate.gate}_WAIT`;
      authoritativeReason = gate.reason || `Execution paused / waiting by ${gate.gate} gate.`;
      rejectedGate = gate.gate;
      rejectionReason = authoritativeReason;
      break;
    }
  }

  const attribution: DecisionAttribution = {
    finalDecision,
    authoritativeReasonCode,
    authoritativeReason,
    rejectedGate,
    rejectionReason,
    decisionChain: orderedGates,
    tradeId: finalDecision === 'EXECUTE' ? (input.tradeId || null) : null,
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
