import { getUserPerformanceSnapshot, PerformanceSnapshotOptions, PerformanceSnapshot, EvidenceTier } from './performance-snapshot.js';

export interface LearningStatus {
  userId: string;
  generatedAt: string;
  summary: string;
  sampleEvidenceLevel: EvidenceTier;
  keyInsights: string[];
  pairInsights: string[];
  setupInsights: string[];
  directionInsights: string[];
  regimeInsights: string[];
  executionInsights: string[];
  governorInsight: string;
  adaptiveHierarchyInsight: string;
}

/**
 * Derives explanatory, read-only learning status insights for a user based on completed trades.
 * Does NOT alter trading behavior or mutate strategy settings.
 */
export async function getLearningStatus(
  userId: string,
  options?: PerformanceSnapshotOptions
): Promise<LearningStatus> {
  const generatedAt = new Date().toISOString();
  const snapshot: PerformanceSnapshot = await getUserPerformanceSnapshot(userId, options);

  console.log(`[LEARNING STATUS] Generating learning status for user: ${userId}`);

  const tradeCount = snapshot.totalCompletedTrades;
  const sampleEvidenceLevel = snapshot.evidenceTier;

  // 1. Overall Summary
  let summary = '';
  if (tradeCount === 0) {
    summary = 'Insufficient completed trades to adapt. The system requires at least 10 completed trades before adaptive learning influences decision parameters.';
  } else if (sampleEvidenceLevel === 'INSUFFICIENT') {
    summary = `Insufficient completed trades (${tradeCount} trades) to adapt safely. Baseline strategy rules remain active.`;
  } else if (sampleEvidenceLevel === 'WEAK') {
    summary = `Early evidence available (${tradeCount} trades); adaptation remains conservative and highly guarded.`;
  } else if (sampleEvidenceLevel === 'MODERATE') {
    summary = `Moderate evidence level achieved (${tradeCount} trades); adaptive selectivity is actively governing trade candidates.`;
  } else {
    summary = `Strong statistical sample (${tradeCount} trades); full adaptive strategy calibration and execution optimization active.`;
  }

  // 2. Key Insights
  const keyInsights: string[] = [];
  if (tradeCount > 0) {
    keyInsights.push(`Total completed trades: ${tradeCount} (Win Rate: ${snapshot.winRate}%, Realized R: ${snapshot.totalRealizedR}R, Expectancy: ${snapshot.expectancyR}R).`);
    keyInsights.push(`Average winning trade: +${snapshot.averageWinR}R; Average losing trade: -${snapshot.averageLossR}R.`);
    
    if (snapshot.consecutiveLosses > 0) {
      keyInsights.push(`Current consecutive loss count: ${snapshot.consecutiveLosses} losses.`);
    }
    if (snapshot.estimatedDrawdownPercent > 0) {
      keyInsights.push(`Estimated drawdown: ${snapshot.estimatedDrawdownPercent}% from peak equity.`);
    }
  } else {
    keyInsights.push('No completed trades recorded yet for this user profile.');
  }

  // 3. Pair Insights
  const pairInsights: string[] = [];
  for (const [pair, stats] of Object.entries(snapshot.breakdownByPair)) {
    if (stats.evidenceTier === 'INSUFFICIENT') {
      pairInsights.push(`${pair} has insufficient evidence (${stats.sampleSize} trades) to form a statistical conclusion.`);
    } else if (stats.expectancyR > 0) {
      pairInsights.push(`${pair} is showing positive historical expectancy (+${stats.expectancyR}R across ${stats.sampleSize} trades, Win Rate ${stats.winRate}%).`);
    } else {
      pairInsights.push(`${pair} performance is deteriorating (${stats.expectancyR}R across ${stats.sampleSize} trades, Win Rate ${stats.winRate}%).`);
    }
  }

  // 4. Setup Insights
  const setupInsights: string[] = [];
  for (const [setup, stats] of Object.entries(snapshot.breakdownBySetup)) {
    if (stats.evidenceTier === 'INSUFFICIENT') {
      setupInsights.push(`Setup "${setup}" has insufficient sample (${stats.sampleSize} trades) for adaptation.`);
    } else if (stats.expectancyR >= 0.20) {
      setupInsights.push(`Setup "${setup}" demonstrates strong profitability (+${stats.expectancyR}R across ${stats.sampleSize} trades).`);
    } else if (stats.expectancyR < 0) {
      setupInsights.push(`Setup "${setup}" is underperforming (${stats.expectancyR}R across ${stats.sampleSize} trades). Increased selectivity applied.`);
    } else {
      setupInsights.push(`Setup "${setup}" maintains neutral performance (+${stats.expectancyR}R across ${stats.sampleSize} trades).`);
    }
  }

  // 5. Direction Insights
  const directionInsights: string[] = [];
  for (const [dir, stats] of Object.entries(snapshot.breakdownByDirection)) {
    if (stats.sampleSize >= 5) {
      directionInsights.push(`${dir} direction trades exhibit ${stats.expectancyR}R expectancy across ${stats.sampleSize} trades (Win Rate: ${stats.winRate}%).`);
    }
  }

  // 6. Regime Insights
  const regimeInsights: string[] = [];
  for (const [regime, stats] of Object.entries(snapshot.breakdownByRegime)) {
    if (stats.sampleSize >= 5) {
      regimeInsights.push(`Market regime "${regime}" yields ${stats.expectancyR}R expectancy across ${stats.sampleSize} trades.`);
    }
  }

  // 7. Execution Insights
  const executionInsights: string[] = [];
  const execM = snapshot.executionMetrics;
  if (execM.goodTiming.count > 0) {
    executionInsights.push(`GOOD execution timing trades yield ${execM.goodTiming.expectancyR}R expectancy across ${execM.goodTiming.count} trades (Win Rate: ${execM.goodTiming.winRate}%).`);
  }
  if (execM.poorTiming.count > 0) {
    executionInsights.push(`POOR execution timing trades yield ${execM.poorTiming.expectancyR}R expectancy across ${execM.poorTiming.count} trades (Win Rate: ${execM.poorTiming.winRate}%).`);
  }
  if (execM.waitCount > 0) {
    executionInsights.push(`Execution timing gate issued WAIT status ${execM.waitCount} times, protecting capital when entry timing was unfavorable.`);
  }

  // 8. Governor Insight
  let governorInsight = '';
  const govVis = snapshot.riskGovernorVisibility;
  if (govVis.status === 'NO_TRADE') {
    governorInsight = `Risk Governor is in NO_TRADE mode: Candidate signals halted due to triggering condition (${govVis.triggeringConditions.join(', ') || 'Severe negative expectancy or drawdown'}).`;
  } else if (govVis.status === 'RESTRICTED_SELECTIVITY') {
    governorInsight = `Risk Governor is in RESTRICTED_SELECTIVITY mode: Raised confidence/quality threshold required due to triggering condition (${govVis.triggeringConditions.join(', ') || 'Elevated losses or drawdown'}).`;
  } else {
    governorInsight = `Risk Governor is operating in NORMAL mode across all candidate evaluations (${tradeCount} total completed trades evaluated).`;
  }

  // 9. Adaptive Hierarchy Insight
  let adaptiveHierarchyInsight = '';
  if (tradeCount >= 20) {
    adaptiveHierarchyInsight = 'Adaptive learning hierarchy level in use: PAIR+TF+SETUP+DIRECTION+REGIME (Full specific scope matched).';
  } else if (tradeCount >= 10) {
    adaptiveHierarchyInsight = 'Adaptive learning hierarchy level in use: PAIR+TF+SETUP (Broader category fallback matched).';
  } else {
    adaptiveHierarchyInsight = 'Adaptive learning hierarchy level in use: USER GLOBAL / INSUFFICIENT (Insufficient local sample; conservative default thresholds active).';
  }

  console.log(`[ADAPTIVE LEARNING STATUS] User: ${userId}, Summary: ${summary}`);

  return {
    userId,
    generatedAt,
    summary,
    sampleEvidenceLevel,
    keyInsights,
    pairInsights,
    setupInsights,
    directionInsights,
    regimeInsights,
    executionInsights,
    governorInsight,
    adaptiveHierarchyInsight
  };
}
