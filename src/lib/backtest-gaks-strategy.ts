/**
 * GAKS AI — Actual Gaks Strategy Backtest Adapter
 * Deterministically evaluates compiled Gaks strategy rules (CompilerOutput / CompiledRules)
 * over historical candle contexts using pure decision-engine evaluators without Gemini API calls.
 */

import { BacktestStrategy, BacktestCandleContext, BacktestSignal } from './backtest-types.js';
import { compileStrategy, CompilerOutput } from './strategy-compiler.js';
import { evaluateDecision } from './decision-engine.js';
import {
  calculateDeterministicATR,
  calculateDeterministicEMA,
  calculateDeterministicRSI
} from './backtest-strategy.js';

export class GaksBacktestStrategy implements BacktestStrategy {
  id: string;
  name: string;
  compiledStrategy: CompilerOutput;
  rawStrategyText: string;

  constructor(strategyText?: string, strategyId?: string) {
    this.id = strategyId || 'gaks-actual-strategy';
    this.name = 'Actual Gaks Strategy (Deterministic Rule Engine)';
    
    let textToUse = (strategyText || '').trim();
    if (textToUse.startsWith('{')) {
      try {
        const parsed = JSON.parse(textToUse);
        if (parsed.strategies && Array.isArray(parsed.strategies)) {
          const active = parsed.strategies.find((s: any) => s.id === parsed.activeId) || parsed.strategies[0];
          if (active && active.text) {
            textToUse = active.text.trim();
          }
        }
      } catch {}
    }

    this.rawStrategyText = textToUse || 'Default Gaks Strategy: EMA alignment, Order Block structure, confirmation candle, 1:2 RR';
    this.compiledStrategy = compileStrategy(this.rawStrategyText);
  }

  evaluate(context: BacktestCandleContext, simConfig?: BacktestSimulationConfig): BacktestSignal | null {
    const { current, previous, index, symbol, timeframe } = context;
    if (!previous || previous.length < 14) return null; // Requires at least 14 historical candles

    const allCandles = [...previous, current];
    const closes = allCandles.map(c => c.close);

    // 1. Calculate Deterministic Indicators over available historical candles
    const atr = calculateDeterministicATR(allCandles, 14);
    const rsi = calculateDeterministicRSI(closes, 14);

    const emaPeriods = this.compiledStrategy.compiled_rules?.ema?.periods || [9, 21];
    const fastPeriod = emaPeriods[0] || 9;
    const slowPeriod = emaPeriods[1] || 21;

    const fastEma = calculateDeterministicEMA(closes, fastPeriod);
    const slowEma = calculateDeterministicEMA(closes, slowPeriod);

    const prevCloses = closes.slice(0, -1);
    const prevFastEma = calculateDeterministicEMA(prevCloses, fastPeriod);
    const prevSlowEma = calculateDeterministicEMA(prevCloses, slowPeriod);

    const emaCrossoverBullish = prevFastEma !== null && prevSlowEma !== null && fastEma !== null && slowEma !== null && prevFastEma <= prevSlowEma && fastEma > slowEma;
    const emaCrossoverBearish = prevFastEma !== null && prevSlowEma !== null && fastEma !== null && slowEma !== null && prevFastEma >= prevSlowEma && fastEma < slowEma;

    // Market structure detection over previous 100 candles (better for zone identification)
    const lookback = Math.min(previous.length, 100);
    const recentCandles = previous.slice(-lookback);
    const recentHigh = Math.max(...recentCandles.map(c => c.high));
    const recentLow = Math.min(...recentCandles.map(c => c.low));

    const bosBullish = current.close > recentHigh;
    const bosBearish = current.close < recentLow;

    // Pinbar / Engulfing Confirmation Candle Detection
    const candleBody = Math.abs(current.close - current.open);
    const isBullishEngulfing = current.close > current.open && previous.length > 0 && current.close > previous[previous.length - 1].open;
    const isBearishEngulfing = current.close < current.open && previous.length > 0 && current.close < previous[previous.length - 1].open;
    const isBullishPinbar = current.close > current.open && (current.open - current.low) >= 1.5 * candleBody;
    const isBearishPinbar = current.close < current.open && (current.high - current.open) >= 1.5 * candleBody;

    const confirmationBullish = isBullishEngulfing || isBullishPinbar;
    const confirmationBearish = isBearishEngulfing || isBearishPinbar;

    // Volume Analysis
    const recentVolumes = recentCandles.map(c => c.volume || 0).filter(v => v > 0);
    const averageVolume = recentVolumes.length > 0 ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length : 1000;
    const latestVolume = current.volume || 0;

    // Supply & Demand / Support & Resistance Zones
    const supportZoneRange = { low: recentLow, high: recentLow + atr * 0.5, type: 'SUPPORT' };
    const resistanceZoneRange = { low: recentHigh - atr * 0.5, high: recentHigh, type: 'RESISTANCE' };

    const inSupport = current.low <= supportZoneRange.high;
    const inResistance = current.high >= resistanceZoneRange.low;

    // Build deterministic market structure object
    const marketStructure = {
      watcherId: this.id,
      symbol,
      timeframe,
      trend: fastEma && slowEma ? (fastEma > slowEma ? 'BULLISH' : 'BEARISH') : 'SIDEWAYS',
      ema: fastEma && slowEma ? fastEma > slowEma : false,
      ema_crossover: emaCrossoverBullish || emaCrossoverBearish,
      rsi: rsi !== null ? rsi : 50,
      rsi_oversold: rsi !== null && rsi <= 30,
      rsi_overbought: rsi !== null && rsi >= 70,
      bos: bosBullish || bosBearish,
      choch: bosBullish || bosBearish,
      confirmation_candle: confirmationBullish || confirmationBearish,
      support: inSupport,
      resistance: inResistance,
      supportZones: inSupport ? [supportZoneRange] : [],
      resistanceZones: inResistance ? [resistanceZoneRange] : [],
      orderBlocks: [
        { type: 'BULLISH_ORDER_BLOCK', low: recentLow, high: recentLow + atr * 0.5, status: inSupport ? 'TAPPED' : 'UNMITIGATED' },
        { type: 'BEARISH_ORDER_BLOCK', low: recentHigh - atr * 0.5, high: recentHigh, status: inResistance ? 'TAPPED' : 'UNMITIGATED' }
      ],
      support_rejection: inSupport && current.close > supportZoneRange.high,
      resistance_rejection: inResistance && current.close < resistanceZoneRange.low,
      tap_and_rejection: (inSupport && current.close > supportZoneRange.high) || (inResistance && current.close < resistanceZoneRange.low),
      volume_confirmation: latestVolume >= averageVolume * 1.2,
      latestVolume,
      averageVolume,
      volumeInformation: {
        latestVolume,
        averageVolume,
        volumeSpike: latestVolume >= averageVolume * 1.5
      },
      order_block: inSupport || inResistance,
      markedZone: inSupport 
        ? { type: 'DEMAND', low: recentLow, high: recentLow + atr * 0.5, status: 'ZONE_TAPPED', direction: 'BUY' }
        : inResistance
          ? { type: 'SUPPLY', low: recentHigh - atr * 0.5, high: recentHigh, status: 'ZONE_TAPPED', direction: 'SELL' }
          : null,
      zone_status: (inSupport || inResistance) ? 'ZONE_TAPPED' : 'NO_ZONE',
      isRejected: (inSupport && current.close > supportZoneRange.high) || (inResistance && current.close < resistanceZoneRange.low),
      risk_reward: true,
      timeframes: [timeframe] 
    };

    // 2. Evaluate Decision Engine against Compiled Gaks Strategy
    const decision = evaluateDecision(this.compiledStrategy, marketStructure);

    // Determine matching signal from Strategy keywords or Decision Engine
    const strategyLower = this.rawStrategyText.toLowerCase();
    const isSupplyDemandStrategy = strategyLower.includes('supply') || strategyLower.includes('demand') || strategyLower.includes('order block');
    const isEmaStrategy = strategyLower.includes('ema') || strategyLower.includes('crossover');
    const isBosStrategy = strategyLower.includes('bos') || strategyLower.includes('break of structure') || strategyLower.includes('choch');

    let triggerSignal = false;
    let direction: 'BUY' | 'SELL' = 'BUY';
    let reason = '';

    // A. Supply & Demand / Order Block Tap & Rejections
    if (isSupplyDemandStrategy) {
      if (marketStructure.support_rejection && confirmationBullish) {
        triggerSignal = true;
        direction = 'BUY';
        reason = 'Price tapped and rejected Demand Zone / Order Block with bullish confirmation';
      } else if (marketStructure.resistance_rejection && confirmationBearish) {
        triggerSignal = true;
        direction = 'SELL';
        reason = 'Price tapped and rejected Supply Zone / Order Block with bearish confirmation';
      }
    }

    // B. EMA Alignment & Crossovers
    if (!triggerSignal && isEmaStrategy) {
      if (emaCrossoverBullish) {
        triggerSignal = true;
        direction = 'BUY';
        reason = 'Bullish EMA Crossover detected (Fast crossed above Slow EMA)';
      } else if (emaCrossoverBearish) {
        triggerSignal = true;
        direction = 'SELL';
        reason = 'Bearish EMA Crossover detected (Fast crossed below Slow EMA)';
      }
    }

    // C. Break of Structure (BOS)
    if (!triggerSignal && isBosStrategy) {
      if (bosBullish && confirmationBullish) {
        triggerSignal = true;
        direction = 'BUY';
        reason = 'Bullish Break of Structure (BOS) confirmed with candle momentum';
      } else if (bosBearish && confirmationBearish) {
        triggerSignal = true;
        direction = 'SELL';
        reason = 'Bearish Break of Structure (BOS) confirmed with candle momentum';
      }
    }

    // D. Decision Engine Fallback
    if (!triggerSignal && (decision.recommendation === 'PASS' || decision.recommendation === 'LIKELY_PASS' || decision.mandatory_rules_passed)) {
      triggerSignal = true;
      if (bosBearish || emaCrossoverBearish || isBearishEngulfing || isBearishPinbar) {
        direction = 'SELL';
      } else {
        direction = 'BUY';
      }
      reason = decision.explanation || `Deterministic Gaks Rule Passed (${decision.matched_rules.join(', ')})`;
    }

    if (triggerSignal) {
      const slBuffer = Math.max(atr * 1.5, 0.0010);
      
      // Load RR from simConfig if provided, otherwise fallback to strategy or default
      const rrRatio = simConfig?.riskRewardRatio || this.compiledStrategy.compiled_rules?.risk_reward?.min_ratio || 2.0;

      const entryPrice = current.close;
      let stopLoss = 0;
      let takeProfit = 0;

      if (direction === 'BUY') {
        stopLoss = Math.round((entryPrice - slBuffer) * 100000) / 100000;
        const risk = entryPrice - stopLoss;
        takeProfit = Math.round((entryPrice + risk * rrRatio) * 100000) / 100000;
      } else {
        stopLoss = Math.round((entryPrice + slBuffer) * 100000) / 100000;
        const risk = stopLoss - entryPrice;
        takeProfit = Math.round((entryPrice - risk * rrRatio) * 100000) / 100000;
      }

      return {
        id: `gaks_sig_${index}_${direction.toLowerCase()}`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction,
        entryPrice,
        stopLoss,
        takeProfit,
        reason,
        confidence: Math.round((decision.decision_score || 0.8) * 100)
      };
    }

    return null;
  }
}
