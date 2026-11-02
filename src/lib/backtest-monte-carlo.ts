/**
 * GAKS AI — Stage E7: Reproducible Monte Carlo Simulation Engine
 * Executes deterministic Monte Carlo simulations using trade sequence reshuffling
 * and bootstrap sampling with replacement driven by a seeded PRNG.
 */

import { BacktestTradeRecord } from './backtest-types.js';

export interface MonteCarloConfig {
  iterations: number; // e.g. 1000
  initialBalance: number; // e.g. 100000
  samplingMethod: 'RESHUFFLE' | 'BOOTSTRAP';
  ruinThresholdPercent: number; // e.g. 25 (25% max drawdown = ruin)
  seed: number; // e.g. 42
}

export interface MonteCarloPercentiles {
  p5: number; // 5th percentile (pessimistic / VaR)
  p50: number; // 50th percentile (median)
  p95: number; // 95th percentile (optimistic)
}

export interface MonteCarloSimulationResult {
  iterationsExecuted: number;
  samplingMethod: 'RESHUFFLE' | 'BOOTSTRAP';
  seedUsed: number;
  finalEquity: MonteCarloPercentiles;
  maxDrawdownPercent: MonteCarloPercentiles;
  maxLosingStreak: MonteCarloPercentiles;
  riskOfRuinPercent: number | null; // null if insufficient trades
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_TRADES';
  sampleSimulatedCurves: { iteration: number; equityCurve: number[] }[];
  isPassed: boolean;
  timestamp: string;
}

/**
 * Seeded Pseudo-Random Number Generator (Mulberry32 PRNG)
 * Guarantees 100% deterministic, reproducible Monte Carlo simulations.
 */
export function createMulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Calculates percentile from an array of numbers.
 */
function getPercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor((percentile / 100) * (sortedValues.length - 1));
  return sortedValues[index];
}

/**
 * Runs Monte Carlo Simulation over a completed backtest trade record set.
 */
export function runMonteCarloSimulation(
  trades: BacktestTradeRecord[],
  config: MonteCarloConfig
): MonteCarloSimulationResult {
  const { iterations, initialBalance, samplingMethod, ruinThresholdPercent, seed } = config;

  if (!trades || trades.length < 5) { // Minimum 5 trades for Monte Carlo
    return {
      iterationsExecuted: 0,
      samplingMethod,
      seedUsed: seed,
      finalEquity: { p5: initialBalance, p50: initialBalance, p95: initialBalance },
      maxDrawdownPercent: { p5: 0, p50: 0, p95: 0 },
      maxLosingStreak: { p5: 0, p50: 0, p95: 0 },
      riskOfRuinPercent: null,
      status: 'INSUFFICIENT_TRADES',
      sampleSimulatedCurves: [],
      isPassed: false,
      timestamp: new Date().toISOString()
    };
  }

  const random = createMulberry32(seed);
  const tradePnLs = trades.map(t => t.netPnL);
  const N = tradePnLs.length;

  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];
  const maxLosingStreaks: number[] = [];

  let ruinCount = 0;
  const sampleSimulatedCurves: { iteration: number; equityCurve: number[] }[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    let sampledPnLs: number[] = [];

    if (samplingMethod === 'RESHUFFLE') {
      // Fisher-Yates shuffle using seeded PRNG
      sampledPnLs = [...tradePnLs];
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [sampledPnLs[i], sampledPnLs[j]] = [sampledPnLs[j], sampledPnLs[i]];
      }
    } else {
      // Bootstrap sampling with replacement
      for (let i = 0; i < N; i++) {
        const idx = Math.floor(random() * N);
        sampledPnLs.push(tradePnLs[idx]);
      }
    }

    // Simulate equity curve
    let currentBalance = initialBalance;
    let peakBalance = initialBalance;
    let maxDd = 0;

    let currentStreak = 0;
    let maxStreak = 0;

    const equityCurve: number[] = [initialBalance];

    for (const pnl of sampledPnLs) {
      currentBalance += pnl;
      equityCurve.push(currentBalance);

      if (currentBalance > peakBalance) {
        peakBalance = currentBalance;
      }

      const dd = peakBalance > 0 ? ((peakBalance - currentBalance) / peakBalance) * 100 : 0;
      if (dd > maxDd) {
        maxDd = dd;
      }

      if (pnl < 0) {
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        currentStreak = 0;
      }
    }

    finalEquities.push(currentBalance);
    maxDrawdowns.push(maxDd);
    maxLosingStreaks.push(maxStreak);

    if (maxDd >= ruinThresholdPercent) {
      ruinCount++;
    }

    // Capture first 5 iterations as visual sample curves
    if (iter < 5) {
      sampleSimulatedCurves.push({ iteration: iter + 1, equityCurve });
    }
  }

  // Sort results for percentiles
  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);
  maxLosingStreaks.sort((a, b) => a - b);

  const riskOfRuinPercent = (ruinCount / iterations) * 100;

  // Criteria for PASS: Risk of ruin < 5.0% and median final equity > initial balance
  const isPassed = riskOfRuinPercent < 5.0 && getPercentile(finalEquities, 50) >= initialBalance;

  return {
    iterationsExecuted: iterations,
    samplingMethod,
    seedUsed: seed,
    finalEquity: {
      p5: getPercentile(finalEquities, 5),
      p50: getPercentile(finalEquities, 50),
      p95: getPercentile(finalEquities, 95)
    },
    maxDrawdownPercent: {
      p5: getPercentile(maxDrawdowns, 5),
      p50: getPercentile(maxDrawdowns, 50),
      p95: getPercentile(maxDrawdowns, 95)
    },
    maxLosingStreak: {
      p5: getPercentile(maxLosingStreaks, 5),
      p50: getPercentile(maxLosingStreaks, 50),
      p95: getPercentile(maxLosingStreaks, 95)
    },
    riskOfRuinPercent,
    status: isPassed ? 'PASS' : 'FAIL',
    sampleSimulatedCurves,
    isPassed,
    timestamp: new Date().toISOString()
  };
}
