export interface TraceData {
  watcherId: string;
  userId: string;
  pair: string;
  timeframe: string;
  currentCandleTime: string;
  closedCandleTime: string;

  // Stage 2: Market Structure
  marketStructure?: {
    trend: string;
    bos: string;
    choch: string;
    trendlineBreakout: string;
    liquiditySweep: string;
    support: string;
    resistance: string;
    volumeConfirmation: string;
    confirmationCandle: string;
    session: string;
    atr: string;
  };

  // Stage 3: Strategy Compiler
  strategyCompiler?: {
    strategyMode: string;
    compiledRules: string[];
    overallConfidence: string;
    matchedPhrases: string[];
    canonicalRules: string[];
  };

  // Stage 4: Decision Engine
  decisionEngine?: {
    decisionScore: string;
    recommendation: string;
    mandatoryRulesPassed: string;
    matchedRules: string[];
    failedRules: string[];
    geminiRequired: string;
  };

  // Stage 5: Gemini
  gemini?: {
    called: string;
    duration: string;
    promptSent: string;
    rawResponse: string;
    parsedSatisfaction: string;
    parsedConfidence: string;
    parsedDirection: string;
  };

  // Stage 6: Risk Engine
  riskEngine?: {
    accountSize: string;
    riskPercentage: string;
    riskAmount: string;
    stopLossDistance: string;
    takeProfitDistance: string;
    calculatedLotSize: string;
    lotType: string;
    accepted: string;
    rejectionReason: string;
  };

  // Stage 7: Telegram
  telegram?: {
    sent: string;
    chatId: string;
    message: string;
  };

  // Stage 8: Complete
  complete?: {
    status: string;
    duration: string;
    timestamp: string;
  };
}

export function logPipelineTrace(data: TraceData) {
  const parts: string[] = [];

  // Stage 1
  parts.push(`========== PIPELINE ==========`);
  parts.push(`Watcher ID: ${data.watcherId}`);
  parts.push(`User ID: ${data.userId}`);
  parts.push(`Pair: ${data.pair}`);
  parts.push(`Timeframe: ${data.timeframe}`);
  parts.push(`Current Candle: ${data.currentCandleTime || "N/A"}`);
  parts.push(`Closed Candle: ${data.closedCandleTime || "N/A"}`);
  parts.push(`==============================`);

  // Stage 2
  parts.push(``);
  parts.push(`========== MARKET STRUCTURE ==========`);
  if (data.marketStructure) {
    parts.push(``);
    parts.push(`Trend:\n${data.marketStructure.trend}`);
    parts.push(``);
    parts.push(`BOS:\n${data.marketStructure.bos}`);
    parts.push(``);
    parts.push(`CHOCH:\n${data.marketStructure.choch}`);
    parts.push(``);
    parts.push(`Trendline Breakout:\n${data.marketStructure.trendlineBreakout}`);
    parts.push(``);
    parts.push(`Liquidity Sweep:\n${data.marketStructure.liquiditySweep}`);
    parts.push(``);
    parts.push(`Support:\n${data.marketStructure.support}`);
    parts.push(``);
    parts.push(`Resistance:\n${data.marketStructure.resistance}`);
    parts.push(``);
    parts.push(`Volume Confirmation:\n${data.marketStructure.volumeConfirmation}`);
    parts.push(``);
    parts.push(`Confirmation Candle:\n${data.marketStructure.confirmationCandle}`);
    parts.push(``);
    parts.push(`Session:\n${data.marketStructure.session}`);
    parts.push(``);
    parts.push(`ATR:\n${data.marketStructure.atr}`);
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`SKIPPED`);
    parts.push(``);
  }
  parts.push(`======================================`);

  // Stage 3
  parts.push(``);
  parts.push(`========== STRATEGY COMPILER ==========`);
  if (data.strategyCompiler) {
    parts.push(``);
    parts.push(`Strategy Mode:\n${data.strategyCompiler.strategyMode}`);
    parts.push(``);
    parts.push(`Compiled Rules:`);
    if (data.strategyCompiler.compiledRules.length > 0) {
      data.strategyCompiler.compiledRules.forEach(r => parts.push(`• ${r}`));
    } else {
      parts.push(`None`);
    }
    parts.push(``);
    parts.push(`Overall Confidence:\n${data.strategyCompiler.overallConfidence}`);
    parts.push(``);
    parts.push(`Matched Phrases:`);
    if (data.strategyCompiler.matchedPhrases.length > 0) {
      data.strategyCompiler.matchedPhrases.forEach(p => parts.push(`• ${p}`));
    } else {
      parts.push(`None`);
    }
    parts.push(``);
    parts.push(`Canonical Rules:`);
    if (data.strategyCompiler.canonicalRules.length > 0) {
      data.strategyCompiler.canonicalRules.forEach(r => parts.push(`• ${r}`));
    } else {
      parts.push(`None`);
    }
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`SKIPPED`);
    parts.push(``);
  }
  parts.push(`=======================================`);

  // Stage 4
  parts.push(``);
  parts.push(`========== DECISION ENGINE ==========`);
  if (data.decisionEngine) {
    parts.push(``);
    parts.push(`Decision Score:\n${data.decisionEngine.decisionScore}`);
    parts.push(``);
    parts.push(`Recommendation:\n${data.decisionEngine.recommendation}`);
    parts.push(``);
    parts.push(`Mandatory Rules Passed:\n${data.decisionEngine.mandatoryRulesPassed}`);
    parts.push(``);
    parts.push(`Matched Rules:`);
    if (data.decisionEngine.matchedRules.length > 0) {
      data.decisionEngine.matchedRules.forEach(r => parts.push(`• ${r}`));
    } else {
      parts.push(`None`);
    }
    parts.push(``);
    parts.push(`Failed Rules:`);
    if (data.decisionEngine.failedRules.length > 0) {
      data.decisionEngine.failedRules.forEach(r => parts.push(`• ${r}`));
    } else {
      parts.push(`None`);
    }
    parts.push(``);
    parts.push(`Gemini Required:\n${data.decisionEngine.geminiRequired}`);
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`SKIPPED`);
    parts.push(``);
  }
  parts.push(`=====================================`);

  // Stage 5
  parts.push(``);
  parts.push(`========== GEMINI ==========`);
  if (data.gemini) {
    parts.push(``);
    parts.push(`Called:\n${data.gemini.called}`);
    parts.push(``);
    parts.push(`Duration:\n${data.gemini.duration}`);
    parts.push(``);
    parts.push(`Prompt Sent:\n${data.gemini.promptSent}`);
    parts.push(``);
    parts.push(`Raw Response:\n${data.gemini.rawResponse}`);
    parts.push(``);
    parts.push(`Parsed Satisfaction:\n${data.gemini.parsedSatisfaction}`);
    parts.push(``);
    parts.push(`Parsed Confidence:\n${data.gemini.parsedConfidence}`);
    parts.push(``);
    parts.push(`Parsed Direction:\n${data.gemini.parsedDirection}`);
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`Called:\nNO`);
    parts.push(``);
  }
  parts.push(`============================`);

  // Stage 6
  parts.push(``);
  parts.push(`========== RISK ENGINE ==========`);
  if (data.riskEngine) {
    parts.push(``);
    parts.push(`Account Size:\n${data.riskEngine.accountSize}`);
    parts.push(``);
    parts.push(`Risk Percentage:\n${data.riskEngine.riskPercentage}`);
    parts.push(``);
    parts.push(`Risk Amount:\n${data.riskEngine.riskAmount}`);
    parts.push(``);
    parts.push(`Stop Loss Distance:\n${data.riskEngine.stopLossDistance}`);
    parts.push(``);
    parts.push(`Take Profit Distance:\n${data.riskEngine.takeProfitDistance}`);
    parts.push(``);
    parts.push(`Calculated Lot Size:\n${data.riskEngine.calculatedLotSize}`);
    parts.push(``);
    parts.push(`Lot Type:\n${data.riskEngine.lotType}`);
    parts.push(``);
    parts.push(`Accepted:\n${data.riskEngine.accepted}`);
    parts.push(``);
    parts.push(`Rejection Reason:\n${data.riskEngine.rejectionReason}`);
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`Accepted:\nNO`);
    parts.push(``);
    parts.push(`Rejection Reason:\nNot executed (No trade setup or aborted early)`);
    parts.push(``);
  }
  parts.push(`=================================`);

  // Stage 7
  parts.push(``);
  parts.push(`========== TELEGRAM ==========`);
  if (data.telegram) {
    parts.push(``);
    parts.push(`Sent:\n${data.telegram.sent}`);
    parts.push(``);
    parts.push(`Chat ID:\n${data.telegram.chatId}`);
    parts.push(``);
    parts.push(`Message:\n${data.telegram.message}`);
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`Sent:\nNO`);
    parts.push(``);
  }
  parts.push(`==============================`);

  // Stage 8
  parts.push(``);
  parts.push(`========== COMPLETE ==========`);
  if (data.complete) {
    parts.push(``);
    parts.push(`Status:\n${data.complete.status}`);
    parts.push(``);
    parts.push(`Duration:\n${data.complete.duration}`);
    parts.push(``);
    parts.push(`Timestamp:\n${data.complete.timestamp}`);
    parts.push(``);
  } else {
    parts.push(``);
    parts.push(`Status:\nFAILED`);
    parts.push(``);
    parts.push(`Timestamp:\n${new Date().toISOString()}`);
    parts.push(``);
  }
  parts.push(`==============================`);

  console.log(parts.join("\n"));
}
