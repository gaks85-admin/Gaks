function calculateSMA(values) {
    if (values.length === 0)
        return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}
function calculateEMA(candles, period) {
    if (candles.length < period)
        return candles[candles.length - 1]?.close || 0;
    let ema = calculateSMA(candles.slice(0, period).map(c => c.close));
    const k = 2 / (period + 1);
    for (let i = period; i < candles.length; i++) {
        ema = candles[i].close * k + ema * (1 - k);
    }
    return ema;
}
function calculateATR(candles, period = 14) {
    if (candles.length < period + 1)
        return 0.0010;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trs.push(tr);
    }
    const recentTRs = trs.slice(-period);
    return calculateSMA(recentTRs);
}
export function classifyRegime(history) {
    if (!history || history.length < 20) {
        return {
            trend: 'RANGING',
            volatility: 'NORMAL_VOLATILITY',
            atrValue: 0.0010,
            ema20: 0,
            ema50: 0
        };
    }
    const ema20 = calculateEMA(history, 20);
    const ema50 = calculateEMA(history, 50);
    const atr = calculateATR(history, 14);
    const longTermATR = calculateATR(history, 50);
    let trend = 'RANGING';
    const diffPercent = Math.abs((ema20 - ema50) / ema50) * 100;
    if (diffPercent > 0.05) {
        if (ema20 > ema50) {
            trend = 'BULLISH_TREND';
        }
        else {
            trend = 'BEARISH_TREND';
        }
    }
    let volatility = 'NORMAL_VOLATILITY';
    if (longTermATR > 0) {
        const ratio = atr / longTermATR;
        if (ratio > 1.25) {
            volatility = 'HIGH_VOLATILITY';
        }
        else if (ratio < 0.75) {
            volatility = 'LOW_VOLATILITY';
        }
    }
    return {
        trend,
        volatility,
        atrValue: atr,
        ema20,
        ema50
    };
}
export function analyzeMarketRegimes(trades, candles) {
    const regimeGroups = {};
    for (const trade of trades) {
        const entryTs = new Date(trade.entryTimestamp).getTime();
        const historyIndex = candles.findIndex(c => new Date(c.timestamp).getTime() >= entryTs);
        const sliceEnd = historyIndex > 0 ? historyIndex : candles.length;
        const history = candles.slice(0, sliceEnd);
        const regime = classifyRegime(history);
        const key = `${regime.trend}__${regime.volatility}`;
        if (!regimeGroups[key]) {
            regimeGroups[key] = [];
        }
        regimeGroups[key].push(trade);
    }
    const breakdown = {};
    let maxTradeCount = 0;
    let dominantRegime = 'NONE';
    for (const [key, group] of Object.entries(regimeGroups)) {
        const [trend, volatility] = key.split('__');
        const totalTrades = group.length;
        if (totalTrades > maxTradeCount) {
            maxTradeCount = totalTrades;
            dominantRegime = key;
        }
        const wins = group.filter(t => t.netPnL > 0);
        const losses = group.filter(t => t.netPnL < 0);
        const grossProfit = wins.reduce((sum, t) => sum + t.netPnL, 0);
        const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnL, 0));
        const netPnL = group.reduce((sum, t) => sum + t.netPnL, 0);
        const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.0 : 0;
        const expectancy = totalTrades > 0 ? netPnL / totalTrades : 0;
        const status = totalTrades >= 5 ? 'VALID' : 'INCONCLUSIVE';
        breakdown[key] = {
            regimeKey: key,
            trend,
            volatility,
            totalTrades,
            winningTrades: wins.length,
            winRate,
            profitFactor,
            netPnL,
            maxDrawdown: 0,
            expectancy,
            status
        };
    }
    const validRegimes = Object.values(breakdown).filter(r => r.status === 'VALID');
    const isPassed = validRegimes.some(r => r.netPnL > 0);
    return {
        regimeBreakdown: breakdown,
        dominantRegime,
        isPassed,
        timestamp: new Date().toISOString()
    };
}
