import { compileStrategy } from './strategy-compiler.js';
import { evaluateDecision } from './decision-engine.js';
import { extractMarketStructure } from './market-structure-engine.js';
import { identifyMarkedZone, evaluateZoneState, evaluateZoneRejection } from './zone-engine.js';
import { calculateStructuralStopLoss } from './structural-stop-loss.js';
import { calculateDeterministicATR, calculateDeterministicEMA, calculateDeterministicRSI } from './backtest-strategy.js';
export class GaksBacktestStrategy {
    id;
    name;
    compiledStrategy;
    rawStrategyText;
    activeZone = null;
    rejectedZones = [];
    lastEvaluatedIndex = -1;
    constructor(strategyText, strategyId) {
        this.id = strategyId || 'gaks-actual-strategy';
        this.name = 'Actual Gaks Strategy (Deterministic Rule Engine)';
        let textToUse = (strategyText || '').trim();
        if (textToUse.startsWith('{')) {
            try {
                const parsed = JSON.parse(textToUse);
                if (parsed.strategies && Array.isArray(parsed.strategies)) {
                    const active = parsed.strategies.find((s) => s.id === parsed.activeId) || parsed.strategies[0];
                    if (active && active.text) {
                        textToUse = active.text.trim();
                    }
                }
            }
            catch { }
        }
        this.rawStrategyText = textToUse || 'Default Gaks Strategy: EMA alignment, Order Block structure, confirmation candle, 1:2 RR';
        this.compiledStrategy = compileStrategy(this.rawStrategyText);
    }
    reset() {
        this.activeZone = null;
        this.rejectedZones = [];
        this.lastEvaluatedIndex = -1;
    }
    evaluate(context, simConfig) {
        const { current, previous, index, symbol, timeframe } = context;
        if (!previous || previous.length < 5)
            return null;
        if (this.lastEvaluatedIndex >= 0 && index <= this.lastEvaluatedIndex) {
            this.reset();
        }
        this.lastEvaluatedIndex = index;
        const allCandles = [...previous, current].map(c => ({
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0
        }));
        const closes = allCandles.map(c => c.close);
        const prevCandle = previous.length > 0 ? previous[previous.length - 1] : undefined;
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
        const marketStructure = extractMarketStructure(allCandles);
        marketStructure.watcherId = this.id;
        marketStructure.pair = symbol;
        marketStructure.timeframe = timeframe;
        marketStructure.latestCandles = allCandles.slice(-10);
        const calculatedTrend = marketStructure.trend !== 'SIDEWAYS'
            ? marketStructure.trend
            : (fastEma && slowEma ? (fastEma > slowEma ? 'BULLISH' : 'BEARISH') : 'SIDEWAYS');
        marketStructure.trend = calculatedTrend;
        if (!marketStructure.htfTrend && calculatedTrend !== 'SIDEWAYS') {
            marketStructure.htfTrend = calculatedTrend;
        }
        const hasBullishBos = marketStructure.BOS?.some(b => b.type === 'BULLISH_BOS') ?? false;
        const hasBearishBos = marketStructure.BOS?.some(b => b.type === 'BEARISH_BOS') ?? false;
        const hasBullishChoch = marketStructure.CHOCH?.some(c => c.type === 'BULLISH_CHOCH') ?? false;
        const hasBearishChoch = marketStructure.CHOCH?.some(c => c.type === 'BEARISH_CHOCH') ?? false;
        const candleBody = Math.abs(current.close - current.open);
        const isBullishEngulfing = current.close > current.open && !!prevCandle && current.close > prevCandle.open && current.open <= prevCandle.close;
        const isBearishEngulfing = current.close < current.open && !!prevCandle && current.close < prevCandle.open && current.open >= prevCandle.close;
        const isBullishPinbar = current.close > current.open && (current.open - current.low) >= 1.2 * candleBody;
        const isBearishPinbar = current.close < current.open && (current.high - current.open) >= 1.2 * candleBody;
        const confirmationBullish = isBullishEngulfing || isBullishPinbar || (marketStructure.candlePatterns?.some(p => p.direction === 'BULLISH') ?? false);
        const confirmationBearish = isBearishEngulfing || isBearishPinbar || (marketStructure.candlePatterns?.some(p => p.direction === 'BEARISH') ?? false);
        const rules = this.compiledStrategy.compiled_rules;
        const hasZoneOrObRule = !!(rules?.order_block || rules?.supply_demand || rules?.unmitigated_zone || rules?.fair_value_gap);
        if (this.activeZone) {
            const zoneEval = evaluateZoneState(this.activeZone, current, current.close, atr, allCandles, marketStructure);
            this.activeZone = zoneEval.updatedZone;
            if (zoneEval.isInvalidated || this.activeZone.status === 'INVALIDATED' || this.activeZone.status === 'EXPIRED') {
                this.rejectedZones.push({
                    low: this.activeZone.low,
                    high: this.activeZone.high,
                    direction: this.activeZone.direction,
                    rejectedAt: Date.now(),
                    reason: zoneEval.reason || 'Zone invalidated'
                });
                this.activeZone = null;
            }
            else if (zoneEval.isTapped || this.activeZone.status === 'ZONE_TAPPED') {
                const rejection = evaluateZoneRejection(this.activeZone, current, current.close, prevCandle);
                if (rejection.isRejected || zoneEval.isRejected) {
                    this.activeZone.status = 'CONFIRMED';
                }
            }
        }
        if (!this.activeZone) {
            const discoveredZone = identifyMarkedZone(allCandles, marketStructure, this.compiledStrategy, current.close, this.rejectedZones);
            if (discoveredZone) {
                this.activeZone = discoveredZone;
            }
        }
        const enrichedMarketStructure = {
            ...marketStructure,
            watcherId: this.id,
            symbol,
            pair: symbol,
            timeframe,
            trend: marketStructure.trend || (fastEma && slowEma ? (fastEma > slowEma ? 'BULLISH' : 'BEARISH') : 'SIDEWAYS'),
            ema: fastEma && slowEma ? fastEma > slowEma : false,
            ema_crossover: emaCrossoverBullish || emaCrossoverBearish,
            emaCrossoverBullish,
            emaCrossoverBearish,
            fastEma,
            slowEma,
            rsi: rsi !== null ? rsi : 50,
            rsi_oversold: rsi !== null && rsi <= (rules?.rsi?.oversold || 35),
            rsi_overbought: rsi !== null && rsi >= (rules?.rsi?.overbought || 65),
            bos: hasBullishBos || hasBearishBos,
            choch: hasBullishChoch || hasBearishChoch,
            confirmation_candle: confirmationBullish || confirmationBearish,
            markedZone: this.activeZone,
            zone_status: this.activeZone ? this.activeZone.status : 'NO_ZONE',
            isRejected: this.activeZone ? this.activeZone.status === 'CONFIRMED' : false,
            order_block: Boolean(this.activeZone),
            support_rejection: this.activeZone?.direction === 'BUY' && this.activeZone.status === 'CONFIRMED',
            resistance_rejection: this.activeZone?.direction === 'SELL' && this.activeZone.status === 'CONFIRMED',
            tap_and_rejection: this.activeZone?.status === 'CONFIRMED',
            risk_reward: true
        };
        const decision = evaluateDecision(this.compiledStrategy, enrichedMarketStructure);
        let triggerSignal = false;
        let direction = 'BUY';
        let reason = '';
        if (this.activeZone && this.activeZone.status === 'CONFIRMED') {
            if (this.activeZone.direction === 'BUY' && (confirmationBullish || !rules?.confirmation_candle)) {
                triggerSignal = true;
                direction = 'BUY';
                reason = `Price tapped and rejected ${this.activeZone.type} [${this.activeZone.low} - ${this.activeZone.high}] with confirmation`;
            }
            else if (this.activeZone.direction === 'SELL' && (confirmationBearish || !rules?.confirmation_candle)) {
                triggerSignal = true;
                direction = 'SELL';
                reason = `Price tapped and rejected ${this.activeZone.type} [${this.activeZone.low} - ${this.activeZone.high}] with confirmation`;
            }
        }
        if (!triggerSignal && !hasZoneOrObRule) {
            if (emaCrossoverBullish && (confirmationBullish || !rules?.confirmation_candle)) {
                triggerSignal = true;
                direction = 'BUY';
                reason = 'Bullish EMA Crossover detected with candle confirmation';
            }
            else if (emaCrossoverBearish && (confirmationBearish || !rules?.confirmation_candle)) {
                triggerSignal = true;
                direction = 'SELL';
                reason = 'Bearish EMA Crossover detected with candle confirmation';
            }
            else if (hasBullishBos && (confirmationBullish || !rules?.confirmation_candle)) {
                triggerSignal = true;
                direction = 'BUY';
                reason = 'Bullish Break of Structure (BOS) confirmed with candle momentum';
            }
            else if (hasBearishBos && (confirmationBearish || !rules?.confirmation_candle)) {
                triggerSignal = true;
                direction = 'SELL';
                reason = 'Bearish Break of Structure (BOS) confirmed with candle momentum';
            }
        }
        if (!triggerSignal && (decision.recommendation === 'PASS' || decision.recommendation === 'LIKELY_PASS' || decision.mandatory_rules_passed)) {
            if (this.activeZone && this.activeZone.status === 'CONFIRMED') {
                triggerSignal = true;
                direction = this.activeZone.direction;
                reason = decision.explanation || `Deterministic Gaks Rule Passed (${decision.matched_rules.join(', ')})`;
            }
            else if (!hasZoneOrObRule) {
                triggerSignal = true;
                direction = (emaCrossoverBearish || hasBearishBos || isBearishEngulfing || isBearishPinbar) ? 'SELL' : 'BUY';
                reason = decision.explanation || `Deterministic Gaks Rule Passed (${decision.matched_rules.join(', ')})`;
            }
        }
        if (triggerSignal) {
            const entryPrice = current.close;
            const slResult = calculateStructuralStopLoss(direction, entryPrice, enrichedMarketStructure);
            if (direction === 'BUY' && slResult.stopLoss >= entryPrice) {
                return null;
            }
            if (direction === 'SELL' && slResult.stopLoss <= entryPrice) {
                return null;
            }
            const stopLoss = slResult.stopLoss;
            const rrRatio = simConfig?.riskRewardRatio || rules?.risk_reward?.min_ratio || 2.0;
            let takeProfit = 0;
            if (direction === 'BUY') {
                const risk = entryPrice - stopLoss;
                takeProfit = Number((entryPrice + (risk * rrRatio)).toFixed(5));
            }
            else {
                const risk = stopLoss - entryPrice;
                takeProfit = Number((entryPrice - (risk * rrRatio)).toFixed(5));
            }
            this.activeZone = null;
            const rawScore = decision.decision_score !== undefined ? decision.decision_score : 85;
            const confidence = Math.round(rawScore <= 1 ? rawScore * 100 : rawScore);
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
                confidence
            };
        }
        return null;
    }
}
