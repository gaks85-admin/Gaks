import { resolveBacktestStrategy } from './backtest-strategy.js';
import { simulateTradeLifecycle } from './backtest-trade-simulator.js';
import { calculateBacktestAnalytics, compareAnalytics } from './backtest-analytics.js';
import { aggregateCandles } from './backtest-utils.js';
import { timeframeToMinutes } from './timeframe.js';
import { HistoricalRestrictionsGovernor } from './backtest-restrictions-engine.js';
import { resolveInstrumentSpec } from './risk-engine.js';
export async function runStressSuite(config, scenarios) {
    const baselineResult = await runBacktest({
        ...config,
        simulation: {
            ...config.simulation,
            stress: undefined
        }
    });
    if (!baselineResult.success || !baselineResult.analytics) {
        throw new Error(`Baseline backtest failed: ${baselineResult.error}`);
    }
    const baselineAnalytics = baselineResult.analytics;
    const results = [];
    for (const scenario of scenarios) {
        const stressedResult = await runBacktest({
            ...config,
            simulation: {
                ...config.simulation,
                stress: scenario.stress
            }
        });
        if (stressedResult.success && stressedResult.analytics) {
            results.push({
                scenarioName: scenario.name,
                config: scenario.stress,
                analytics: stressedResult.analytics,
                comparison: compareAnalytics(baselineAnalytics, stressedResult.analytics)
            });
        }
    }
    return {
        baselineAnalytics,
        scenarios: results
    };
}
export async function runBacktest(config) {
    if (!config) {
        return createFailedResult(config, 'Configuration object is required');
    }
    if (!config.datasetId || typeof config.datasetId !== 'string' || !config.datasetId.trim()) {
        return createFailedResult(config, 'Valid datasetId is required');
    }
    if (typeof config.initialBalance !== 'number' || isNaN(config.initialBalance) || config.initialBalance <= 0) {
        return createFailedResult(config, 'Initial balance must be a positive number');
    }
    let candles = [];
    let dataset = null;
    let normSymbol = (config.symbol || '').trim().toUpperCase();
    let normTimeframe = (config.timeframe || '').trim().toUpperCase();
    if (config.candles && config.candles.length > 0) {
        candles = config.candles;
        normSymbol = config.symbol.toUpperCase();
        normTimeframe = config.timeframe.toUpperCase();
    }
    else {
        const { getBacktestDatasetDetails, getBacktestDatasetCandles } = await import('./backtest-service.js');
        const datasetDetails = await getBacktestDatasetDetails(config.datasetId, config.userId);
        if (!datasetDetails.success || !datasetDetails.dataset) {
            return createFailedResult(config, datasetDetails.error || `Dataset with ID "${config.datasetId}" not found`);
        }
        dataset = datasetDetails.dataset;
        if (dataset.status !== 'ready') {
            return createFailedResult(config, `Cannot run backtest: Dataset "${dataset.name}" is in status "${dataset.status}". Only "ready" datasets can be backtested.`);
        }
        normSymbol = (config.symbol || dataset.symbol).trim().toUpperCase();
        normTimeframe = (config.timeframe || dataset.timeframe).trim().toUpperCase();
        candles = await getBacktestDatasetCandles(config.datasetId, config.userId);
        if (!candles || candles.length === 0) {
            if (datasetDetails.sampleCandles && datasetDetails.sampleCandles.length > 0) {
                candles = datasetDetails.sampleCandles;
            }
            else {
                return createFailedResult(config, 'Dataset contains zero candles');
            }
        }
    }
    let ltfCandles = [];
    if (config.ltfCandles && config.ltfCandles.length > 0) {
        ltfCandles = config.ltfCandles;
    }
    else if (config.simulation?.useLowerTimeframeRefinement && config.simulation?.lowerTimeframeDatasetId) {
        const { getBacktestDatasetDetails, getBacktestDatasetCandles } = await import('./backtest-service.js');
        const ltfDatasetDetails = await getBacktestDatasetDetails(config.simulation.lowerTimeframeDatasetId, config.userId);
        if (ltfDatasetDetails.success && ltfDatasetDetails.dataset) {
            ltfCandles = await getBacktestDatasetCandles(config.simulation.lowerTimeframeDatasetId, config.userId);
            ltfCandles = [...ltfCandles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        }
    }
    candles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (dataset) {
        const datasetTimeframeMinutes = timeframeToMinutes(dataset.timeframe);
        const targetTimeframeMinutes = timeframeToMinutes(normTimeframe);
        if (targetTimeframeMinutes > datasetTimeframeMinutes) {
            candles = aggregateCandles(candles, targetTimeframeMinutes);
        }
        else if (targetTimeframeMinutes < datasetTimeframeMinutes) {
            console.warn(`[BacktestEngine] Target timeframe ${normTimeframe} is lower than dataset timeframe ${dataset.timeframe}. Running on ${dataset.timeframe} instead.`);
        }
    }
    for (let i = 1; i < candles.length; i++) {
        const prevTs = new Date(candles[i - 1].timestamp).getTime();
        const currTs = new Date(candles[i].timestamp).getTime();
        if (currTs < prevTs) {
            return createFailedResult(config, `Dataset timestamps out of order at index ${i}: ${candles[i].timestamp} < ${candles[i - 1].timestamp}`);
        }
        if (currTs === prevTs) {
            return createFailedResult(config, `Duplicate timestamp detected at index ${i}: ${candles[i].timestamp}`);
        }
    }
    if (config.startTime) {
        const startTs = new Date(config.startTime).getTime();
        candles = candles.filter(c => new Date(c.timestamp).getTime() >= startTs);
    }
    if (config.endTime) {
        const endTs = new Date(config.endTime).getTime();
        candles = candles.filter(c => new Date(c.timestamp).getTime() <= endTs);
    }
    if (candles.length === 0) {
        return createFailedResult(config, 'No candles remaining after applying start/end time filter');
    }
    const state = {
        balance: config.initialBalance,
        equity: config.initialBalance,
        currentTimestamp: candles[0].timestamp,
        candleIndex: 0,
        signalsGenerated: 0,
        tradesCompleted: 0,
        openPositions: []
    };
    const strategy = resolveBacktestStrategy(config.strategyId, config.strategyText);
    if (strategy.reset) {
        strategy.reset();
    }
    const restrictionsGovernor = new HistoricalRestrictionsGovernor({
        initialBalance: config.initialBalance,
        symbol: normSymbol,
        accountType: config.accountType,
        propFirmSettings: config.propFirmSettings,
        historicalNewsEvents: config.historicalNewsEvents,
        toggles: {
            marketHours: config.simulation?.enforceMarketHours ?? true,
            sessionFilter: config.simulation?.enforceSessions ?? true,
            qualityGate: config.simulation?.enforceQualityGate ?? true,
            riskGovernor: config.simulation?.enforceRiskGovernor ?? true,
            cooldown: config.simulation?.enforceCooldown ?? true,
            propFirm: config.simulation?.enforcePropFirm ?? true
        }
    });
    const signals = [];
    const trades = [];
    const rejectedSignals = [];
    let activeTradeUntilIndex = -1;
    const MAX_HISTORY = 300;
    for (let i = 0; i < candles.length; i++) {
        const currentCandle = candles[i];
        state.currentTimestamp = currentCandle.timestamp;
        state.candleIndex = i;
        restrictionsGovernor.onCandle(currentCandle.timestamp, state.balance, state.equity);
        if (i <= activeTradeUntilIndex) {
            continue;
        }
        const historyStart = i > MAX_HISTORY ? i - MAX_HISTORY : 0;
        const previousCandles = candles.slice(historyStart, i);
        const context = {
            current: currentCandle,
            previous: previousCandles,
            index: i,
            symbol: normSymbol,
            timeframe: normTimeframe
        };
        const signal = strategy.evaluate(context, config.simulation);
        if (signal) {
            const restrictionEval = restrictionsGovernor.evaluateCandidate({
                timestamp: currentCandle.timestamp,
                symbol: normSymbol,
                timeframe: normTimeframe,
                direction: signal.direction,
                confidence: signal.confidence,
                strategyRules: strategy.compiledStrategy?.compiled_rules
            });
            if (!restrictionEval.passed) {
                rejectedSignals.push({
                    timestamp: currentCandle.timestamp,
                    reason: `[${restrictionEval.blockedGate}] ${restrictionEval.reason || 'Blocked by restriction gate'}`,
                    direction: signal.direction
                });
                continue;
            }
            signals.push(signal);
            state.signalsGenerated++;
            const simResult = simulateTradeLifecycle({
                signal,
                datasetId: config.datasetId,
                signalIndex: signals.length - 1,
                candles: candles,
                startIndex: i,
                currentBalance: state.balance,
                initialBalance: config.initialBalance,
                simConfig: {
                    ...config.simulation,
                    accountCurrency: config.accountCurrency || config.simulation?.accountCurrency || 'USD'
                },
                symbol: normSymbol,
                timeframe: normTimeframe
            });
            if (simResult.trade) {
                let simTrade = simResult.trade;
                if (simTrade.collisionPolicyApplied && ltfCandles.length > 0) {
                    simTrade = refineTradeWithLTF(simTrade, ltfCandles, normTimeframe, config.simulation);
                }
                trades.push(simTrade);
                state.tradesCompleted++;
                state.balance = simTrade.balanceAfter;
                state.equity = simTrade.balanceAfter;
                restrictionsGovernor.onTradeClosed(simTrade);
                if (simResult.exitIndex !== undefined && simResult.exitIndex > i) {
                    activeTradeUntilIndex = simResult.exitIndex;
                }
            }
            else {
                rejectedSignals.push({
                    timestamp: currentCandle.timestamp,
                    reason: simResult.rejectionReason || 'Unknown rejection',
                    direction: signal.direction
                });
            }
        }
    }
    const startTime = candles[0].timestamp;
    const endTime = candles[candles.length - 1].timestamp;
    const totalNetPnL = Math.round((state.balance - config.initialBalance) * 100) / 100;
    const analytics = calculateBacktestAnalytics({
        trades,
        startingBalance: config.initialBalance,
        datasetId: config.datasetId,
        symbol: normSymbol,
        timeframe: normTimeframe,
        startTime,
        endTime,
        strategyId: strategy.id,
        strategyName: strategy.name
    });
    return {
        success: true,
        datasetId: config.datasetId,
        symbol: normSymbol,
        timeframe: normTimeframe,
        startTime,
        endTime,
        initialBalance: config.initialBalance,
        finalBalance: state.balance,
        totalNetPnL,
        candlesProcessed: candles.length,
        signalsGenerated: signals.length,
        tradesCompleted: trades.length,
        signals,
        trades,
        rejectedSignals,
        restrictionsSummary: restrictionsGovernor.getSummary(),
        analytics,
        datasetMetadata: dataset?.metadata,
        validationReport: dataset?.validation_report
    };
}
function createFailedResult(config, error) {
    return {
        success: false,
        datasetId: config?.datasetId || '',
        symbol: (config?.symbol || '').toUpperCase(),
        timeframe: (config?.timeframe || '').toUpperCase(),
        startTime: '',
        endTime: '',
        initialBalance: config?.initialBalance || 0,
        finalBalance: config?.initialBalance || 0,
        totalNetPnL: 0,
        candlesProcessed: 0,
        signalsGenerated: 0,
        tradesCompleted: 0,
        signals: [],
        trades: [],
        error
    };
}
function refineTradeWithLTF(trade, ltfCandles, timeframe, simConfig) {
    const parentTs = new Date(trade.exitTimestamp).getTime();
    const parentMins = timeframeToMinutes(timeframe);
    const parentEnd = parentTs + parentMins * 60 * 1000;
    const relevantLtf = ltfCandles.filter(c => {
        const ts = new Date(c.timestamp).getTime();
        return ts >= parentTs && ts < parentEnd;
    });
    if (relevantLtf.length === 0)
        return trade;
    const direction = trade.direction;
    const stopLoss = trade.stopLoss;
    const takeProfit = trade.takeProfit;
    const spec = resolveInstrumentSpec(trade.symbol);
    const spreadPips = (simConfig?.instrumentSpreads && simConfig?.instrumentSpreads[trade.symbol] !== undefined)
        ? simConfig?.instrumentSpreads[trade.symbol]
        : (simConfig?.spreadPips ?? 0);
    const slippagePips = (simConfig?.instrumentSlippages && simConfig?.instrumentSlippages[trade.symbol] !== undefined)
        ? simConfig?.instrumentSlippages[trade.symbol]
        : (simConfig?.slippagePips ?? 0);
    const pipsToPrice = spec.tickSize;
    const halfSpread = (spreadPips * pipsToPrice) / 2;
    const slippageInPrice = slippagePips * pipsToPrice;
    let refinedExitTimestamp = trade.exitTimestamp;
    let refinedExitPrice = trade.exitPrice;
    let refinedExitReason = trade.exitReason;
    let refinedRequestedExitPrice = trade.requestedExitPrice;
    for (const c of relevantLtf) {
        if (direction === 'LONG') {
            const bidHigh = c.high - halfSpread;
            const bidLow = c.low - halfSpread;
            const bidOpen = c.open - halfSpread;
            if (bidLow <= stopLoss) {
                refinedRequestedExitPrice = stopLoss;
                refinedExitPrice = Math.min(bidOpen, stopLoss) - slippageInPrice;
                refinedExitReason = 'STOP_LOSS';
                refinedExitTimestamp = c.timestamp;
                break;
            }
            else if (bidHigh >= takeProfit) {
                refinedRequestedExitPrice = takeProfit;
                refinedExitPrice = takeProfit - slippageInPrice;
                refinedExitReason = 'TAKE_PROFIT';
                refinedExitTimestamp = c.timestamp;
                break;
            }
        }
        else {
            const askHigh = c.high + halfSpread;
            const askLow = c.low + halfSpread;
            const askOpen = c.open + halfSpread;
            if (askHigh >= stopLoss) {
                refinedRequestedExitPrice = stopLoss;
                refinedExitPrice = Math.max(askOpen, stopLoss) + slippageInPrice;
                refinedExitReason = 'STOP_LOSS';
                refinedExitTimestamp = c.timestamp;
                break;
            }
            else if (askLow <= takeProfit) {
                refinedRequestedExitPrice = takeProfit;
                refinedExitPrice = takeProfit + slippageInPrice;
                refinedExitReason = 'TAKE_PROFIT';
                refinedExitTimestamp = c.timestamp;
                break;
            }
        }
    }
    const realizedPriceDiff = direction === 'LONG'
        ? refinedExitPrice - trade.entryPrice
        : trade.entryPrice - refinedExitPrice;
    const originalPriceDiff = direction === 'LONG'
        ? trade.exitPrice - trade.entryPrice
        : trade.entryPrice - trade.exitPrice;
    let conversionFactor = 1.0;
    if (originalPriceDiff !== 0) {
        conversionFactor = trade.grossPnL / (originalPriceDiff * trade.lotSize * spec.contractSize);
    }
    const grossPnL = Math.round((realizedPriceDiff * trade.lotSize * spec.contractSize * conversionFactor) * 100) / 100;
    const netPnL = Math.round((grossPnL - trade.commissionCost + trade.swapCost) * 100) / 100;
    const balanceAfter = Math.round((trade.balanceBefore + netPnL) * 100) / 100;
    return {
        ...trade,
        exitTimestamp: refinedExitTimestamp,
        requestedExitPrice: Math.round(refinedRequestedExitPrice * 100000) / 100000,
        exitPrice: Math.round(refinedExitPrice * 100000) / 100000,
        exitReason: refinedExitReason,
        grossPnL,
        netPnL,
        balanceAfter,
        collisionPolicy: 'REFINED',
        lowerTimeframeRefined: true
    };
}
