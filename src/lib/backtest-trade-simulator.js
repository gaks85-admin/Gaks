import { resolveInstrumentSpec, calculatePositionSize } from './risk-engine.js';
export function calculateSwapCost(params) {
    const { entryTimestamp, exitTimestamp, direction, lotSize, swapLongPerLotPerNight, swapShortPerLotPerNight, tripleSwapDay = 3, rolloverHour = 22, rolloverTimezone = 'UTC' } = params;
    const entryTime = new Date(entryTimestamp).getTime();
    const exitTime = new Date(exitTimestamp).getTime();
    if (isNaN(entryTime) || isNaN(exitTime) || exitTime <= entryTime) {
        return { swapCost: 0, rolloverNightsCount: 0 };
    }
    const ratePerNight = direction === 'LONG' ? swapLongPerLotPerNight : swapShortPerLotPerNight;
    if (ratePerNight === 0 || isNaN(ratePerNight)) {
        return { swapCost: 0, rolloverNightsCount: 0 };
    }
    let totalSwap = 0;
    let rolloverNightsCount = 0;
    const getRolloverTs = (date) => {
        if (!rolloverTimezone || rolloverTimezone === 'UTC') {
            return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), rolloverHour, 0, 0);
        }
        const localDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), rolloverHour, 0, 0));
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone: rolloverTimezone,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            hour12: false
        });
        const parts = fmt.formatToParts(localDate);
        const getPart = (type) => parseInt(parts.find(p => p.type === type)?.value || '0');
        const resYear = getPart('year');
        const resMonth = getPart('month') - 1;
        const resDay = getPart('day');
        const resHour = getPart('hour') === 24 ? 0 : getPart('hour');
        const resTs = Date.UTC(resYear, resMonth, resDay, resHour, 0, 0);
        const diff = resTs - localDate.getTime();
        return localDate.getTime() - diff;
    };
    const startDate = new Date(entryTime);
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(exitTime);
    endDate.setUTCHours(0, 0, 0, 0);
    const curr = new Date(startDate.getTime());
    curr.setUTCDate(curr.getUTCDate() - 1);
    const maxDays = 1000;
    let daysProcessed = 0;
    while (curr.getTime() <= endDate.getTime() && daysProcessed < maxDays) {
        daysProcessed++;
        const rolloverTs = getRolloverTs(curr);
        const rolloverDate = new Date(rolloverTs);
        const dayOfWeek = rolloverDate.getUTCDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            curr.setUTCDate(curr.getUTCDate() + 1);
            continue;
        }
        if (entryTime < rolloverTs && exitTime >= rolloverTs) {
            rolloverNightsCount++;
            const multiplier = dayOfWeek === tripleSwapDay ? 3 : 1;
            totalSwap += ratePerNight * lotSize * multiplier;
        }
        curr.setUTCDate(curr.getUTCDate() + 1);
    }
    return {
        swapCost: Math.round(totalSwap * 100) / 100,
        rolloverNightsCount
    };
}
function getDeterministicRandom(seed, salt) {
    const input = seed + salt;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    let t = hash + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function simulateTradeLifecycle(params) {
    const { signal, datasetId, signalIndex, candles, startIndex = 0, currentBalance, simConfig = {}, symbol, timeframe } = params;
    if (!signal || !candles || candles.length < 2 || currentBalance <= 0) {
        return { trade: null, rejectionReason: 'Insufficient data or invalid balance' };
    }
    const executionModel = simConfig.executionModel || 'NEXT_CANDLE_OPEN';
    const entryCandleIndex = (executionModel === 'NEXT_CANDLE_OPEN' ? 1 : 0) + startIndex;
    if (entryCandleIndex >= candles.length) {
        return { trade: null, rejectionReason: 'Signal occurred at end of dataset' };
    }
    const entryCandle = candles[entryCandleIndex];
    const direction = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
    const rawEntryPrice = executionModel === 'NEXT_CANDLE_OPEN' ? entryCandle.open : signal.entryPrice;
    const stopLoss = signal.stopLoss;
    const takeProfit = signal.takeProfit;
    if (stopLoss === undefined || takeProfit === undefined || isNaN(stopLoss) || isNaN(takeProfit)) {
        return { trade: null, rejectionReason: 'Missing or invalid SL/TP levels' };
    }
    if (direction === 'LONG') {
        if (stopLoss >= rawEntryPrice || takeProfit <= rawEntryPrice) {
            return { trade: null, rejectionReason: `Invalid trade geometry: Entry=${rawEntryPrice}, SL=${stopLoss}, TP=${takeProfit}` };
        }
    }
    else {
        if (stopLoss <= rawEntryPrice || takeProfit >= rawEntryPrice) {
            return { trade: null, rejectionReason: `Invalid trade geometry: Entry=${rawEntryPrice}, SL=${stopLoss}, TP=${takeProfit}` };
        }
    }
    const spec = resolveInstrumentSpec(symbol);
    const riskPercent = simConfig.riskPercent !== undefined && simConfig.riskPercent > 0 ? simConfig.riskPercent : 1.0;
    const initialBal = params.initialBalance !== undefined && !isNaN(params.initialBalance) ? params.initialBalance : currentBalance;
    const riskCalculationBalance = simConfig.useCompounding ? currentBalance : initialBal;
    let spreadPips = (simConfig.instrumentSpreads && simConfig.instrumentSpreads[symbol] !== undefined)
        ? simConfig.instrumentSpreads[symbol]
        : (simConfig.spreadPips ?? 0);
    let slippagePips = (simConfig.instrumentSlippages && simConfig.instrumentSlippages[symbol] !== undefined)
        ? simConfig.instrumentSlippages[symbol]
        : (simConfig.slippagePips ?? 0);
    const stress = simConfig.stress;
    if (stress) {
        spreadPips *= (stress.spreadMultiplier ?? 1);
        slippagePips *= (stress.slippageMultiplier ?? 1);
        if (stress.shocks) {
            const shockSeed = stress.shocks.seed || 'default_seed';
            const tradeId = signal.id;
            const spreadRand = getDeterministicRandom(shockSeed, `${tradeId}_spread`);
            if (spreadRand < stress.shocks.spreadSpikeProbability) {
                spreadPips *= stress.shocks.spreadSpikeMultiplier;
            }
            const slippageRand = getDeterministicRandom(shockSeed, `${tradeId}_slippage`);
            if (slippageRand < stress.shocks.slippageShockProbability) {
                slippagePips *= stress.shocks.slippageShockMultiplier;
            }
        }
    }
    const pipsToPrice = spec.pipSize;
    const spreadInPrice = spreadPips * pipsToPrice;
    const halfSpread = spreadInPrice / 2;
    const slippageInPrice = slippagePips * pipsToPrice;
    const posSizeResult = calculatePositionSize({
        accountSize: riskCalculationBalance,
        riskPercentage: riskPercent,
        positionMode: simConfig.positionMode,
        preferredLotSize: simConfig.preferredLotSize,
        entryPrice: rawEntryPrice,
        stopLoss,
        takeProfit,
        symbol,
        spreadPips,
        slippagePips,
        commissionPerLot: simConfig.commissionPerLot,
        accountCurrency: simConfig.accountCurrency || 'USD',
        direction: signal.direction,
        conversionRate: params.conversionRate
    });
    if (!posSizeResult.accepted || posSizeResult.lots <= 0) {
        return { trade: null, rejectionReason: posSizeResult.reason || 'Position size calculation rejected' };
    }
    const lotSize = posSizeResult.lots;
    const contractSize = spec.contractSize;
    const requestedEntryPrice = rawEntryPrice;
    const executedEntryPrice = direction === 'LONG'
        ? rawEntryPrice + halfSpread + slippageInPrice
        : rawEntryPrice - halfSpread - slippageInPrice;
    const spreadCost = Math.round((spreadInPrice * lotSize * contractSize) * 100) / 100;
    const entrySlippageCost = Math.round((slippageInPrice * lotSize * contractSize) * 100) / 100;
    const sameCandlePolicy = simConfig.sameCandlePolicy || 'STOP_LOSS_FIRST';
    let exitTimestamp = entryCandle.timestamp;
    let requestedExitPrice = executedEntryPrice;
    let exitPrice = executedEntryPrice;
    let exitReason = 'DATASET_END';
    let tradeExited = false;
    let collisionPolicyApplied = false;
    let collisionPolicy = undefined;
    for (let i = entryCandleIndex; i < candles.length; i++) {
        const c = candles[i];
        if (direction === 'LONG') {
            const bidHigh = c.high - halfSpread;
            const bidLow = c.low - halfSpread;
            const bidOpen = c.open - halfSpread;
            const hitSL = bidLow <= stopLoss;
            const hitTP = bidHigh >= takeProfit;
            if (hitSL && hitTP) {
                collisionPolicyApplied = true;
                if (sameCandlePolicy === 'STOP_LOSS_FIRST') {
                    requestedExitPrice = stopLoss;
                    exitPrice = stopLoss - slippageInPrice;
                    exitReason = 'SAME_CANDLE_STOP_LOSS';
                    collisionPolicy = 'STOP_LOSS_FIRST';
                }
                else {
                    requestedExitPrice = takeProfit;
                    exitPrice = takeProfit - slippageInPrice;
                    exitReason = 'TAKE_PROFIT';
                    collisionPolicy = 'TAKE_PROFIT_FIRST';
                }
                exitTimestamp = c.timestamp;
                tradeExited = true;
                break;
            }
            else if (hitSL) {
                requestedExitPrice = stopLoss;
                exitPrice = Math.min(bidOpen, stopLoss) - slippageInPrice;
                exitReason = 'STOP_LOSS';
                exitTimestamp = c.timestamp;
                tradeExited = true;
                break;
            }
            else if (hitTP) {
                requestedExitPrice = takeProfit;
                exitPrice = takeProfit - slippageInPrice;
                exitReason = 'TAKE_PROFIT';
                exitTimestamp = c.timestamp;
                tradeExited = true;
                break;
            }
        }
        else {
            const askHigh = c.high + halfSpread;
            const askLow = c.low + halfSpread;
            const askOpen = c.open + halfSpread;
            const hitSL = askHigh >= stopLoss;
            const hitTP = askLow <= takeProfit;
            if (hitSL && hitTP) {
                collisionPolicyApplied = true;
                if (sameCandlePolicy === 'STOP_LOSS_FIRST') {
                    requestedExitPrice = stopLoss;
                    exitPrice = stopLoss + slippageInPrice;
                    exitReason = 'SAME_CANDLE_STOP_LOSS';
                    collisionPolicy = 'STOP_LOSS_FIRST';
                }
                else {
                    requestedExitPrice = takeProfit;
                    exitPrice = takeProfit + slippageInPrice;
                    exitReason = 'TAKE_PROFIT';
                    collisionPolicy = 'TAKE_PROFIT_FIRST';
                }
                exitTimestamp = c.timestamp;
                tradeExited = true;
                break;
            }
            else if (hitSL) {
                requestedExitPrice = stopLoss;
                exitPrice = Math.max(askOpen, stopLoss) + slippageInPrice;
                exitReason = 'STOP_LOSS';
                exitTimestamp = c.timestamp;
                tradeExited = true;
                break;
            }
            else if (hitTP) {
                requestedExitPrice = takeProfit;
                exitPrice = takeProfit + slippageInPrice;
                exitReason = 'TAKE_PROFIT';
                exitTimestamp = c.timestamp;
                tradeExited = true;
                break;
            }
        }
    }
    if (!tradeExited) {
        const lastCandle = candles[candles.length - 1];
        exitTimestamp = lastCandle.timestamp;
        requestedExitPrice = lastCandle.close;
        exitPrice = lastCandle.close;
        exitReason = 'DATASET_END';
    }
    const exitSlippageCost = Math.round((slippageInPrice * lotSize * contractSize) * 100) / 100;
    const slippageCost = Math.round((entrySlippageCost + exitSlippageCost) * 100) / 100;
    const commissionType = simConfig.commissionType || (simConfig.commissionPerLot !== undefined ? 'ROUND_TURN_PER_LOT' : 'ZERO');
    let rawCommissionPerLot = (simConfig.instrumentCommissions && simConfig.instrumentCommissions[symbol] !== undefined)
        ? simConfig.instrumentCommissions[symbol]
        : (simConfig.commissionPerLot ?? 0);
    if (stress?.commissionMultiplier) {
        rawCommissionPerLot *= stress.commissionMultiplier;
    }
    let totalCommission = 0;
    if (commissionType === 'ZERO') {
        totalCommission = 0;
    }
    else if (commissionType === 'FIXED_PER_TRADE') {
        totalCommission = (simConfig.fixedCommissionPerTrade ?? 5.0) * (stress?.commissionMultiplier ?? 1);
    }
    else if (commissionType === 'PER_LOT_PER_SIDE') {
        totalCommission = rawCommissionPerLot * lotSize * 2;
    }
    else {
        totalCommission = rawCommissionPerLot * lotSize;
    }
    totalCommission = Math.round(totalCommission * 100) / 100;
    const entryCommission = Math.round((totalCommission / 2) * 100) / 100;
    const exitCommission = Math.round((totalCommission - entryCommission) * 100) / 100;
    const commissionCost = totalCommission;
    const instrSwap = simConfig.instrumentSwaps?.[symbol];
    let swapLong = instrSwap?.long ?? simConfig.swapLongPerLotPerNight ?? 0;
    let swapShort = instrSwap?.short ?? simConfig.swapShortPerLotPerNight ?? 0;
    const tripleSwapDay = instrSwap?.tripleSwapDay ?? simConfig.tripleSwapDay ?? 3;
    const rolloverHour = instrSwap?.rolloverHour ?? simConfig.rolloverHour ?? 22;
    const rolloverTimezone = instrSwap?.rolloverTimezone ?? simConfig.rolloverTimezone ?? 'UTC';
    if (stress?.swapMultiplier) {
        swapLong *= stress.swapMultiplier;
        swapShort *= stress.swapMultiplier;
    }
    const swapRes = calculateSwapCost({
        entryTimestamp: entryCandle.timestamp,
        exitTimestamp,
        direction,
        lotSize,
        swapLongPerLotPerNight: swapLong,
        swapShortPerLotPerNight: swapShort,
        tripleSwapDay,
        rolloverHour,
        rolloverTimezone
    });
    const swapCost = swapRes.swapCost;
    const rolloverNightsCount = swapRes.rolloverNightsCount;
    let realizedPriceDiff = 0;
    if (direction === 'LONG') {
        realizedPriceDiff = exitPrice - executedEntryPrice;
    }
    else {
        realizedPriceDiff = executedEntryPrice - exitPrice;
    }
    const accountCurrency = simConfig.accountCurrency || 'USD';
    const quoteCurrency = spec.quoteCurrency;
    let conversionFactor = 1.0;
    if (params.conversionRate !== undefined && !isNaN(params.conversionRate)) {
        conversionFactor = params.conversionRate;
    }
    else if (quoteCurrency !== accountCurrency) {
        if (symbol.startsWith(accountCurrency) && symbol.endsWith(quoteCurrency)) {
            conversionFactor = 1 / exitPrice;
        }
        else if (symbol.startsWith(quoteCurrency) && symbol.endsWith(accountCurrency)) {
            conversionFactor = 1 / exitPrice;
        }
        else {
            conversionFactor = 1.0;
        }
    }
    const grossPnL = Math.round((realizedPriceDiff * lotSize * contractSize * conversionFactor) * 100) / 100;
    const netPnL = Math.round((grossPnL - commissionCost + swapCost) * 100) / 100;
    const balanceBefore = currentBalance;
    const balanceAfter = Math.round((currentBalance + netPnL) * 100) / 100;
    const slDistance = Math.abs(executedEntryPrice - stopLoss);
    const tpDistance = Math.abs(takeProfit - executedEntryPrice);
    const riskRewardRatio = slDistance > 0 ? Math.round((tpDistance / slDistance) * 100) / 100 : 2.0;
    const cleanTs = entryCandle.timestamp.replace(/[^0-9]/g, '');
    const tradeId = `tr_${datasetId}_${signalIndex}_${cleanTs}`;
    const tradeRecord = {
        id: tradeId,
        signalId: signal.id,
        symbol,
        timeframe,
        direction,
        entryTimestamp: entryCandle.timestamp,
        exitTimestamp,
        requestedEntryPrice: Math.round(requestedEntryPrice * 100000) / 100000,
        entryPrice: Math.round(executedEntryPrice * 100000) / 100000,
        requestedExitPrice: Math.round(requestedExitPrice * 100000) / 100000,
        exitPrice: Math.round(exitPrice * 100000) / 100000,
        stopLoss,
        takeProfit,
        lotSize,
        riskAmount: Math.round(posSizeResult.riskAmount * 100) / 100,
        riskRewardRatio,
        grossPnL,
        spreadCost,
        entrySlippageCost,
        exitSlippageCost,
        slippageCost,
        entryCommission,
        exitCommission,
        commissionCost,
        swapCost,
        rolloverNightsCount,
        netPnL,
        balanceBefore,
        balanceAfter,
        exitReason,
        collisionPolicyApplied,
        collisionPolicy,
        lowerTimeframeRefined: false
    };
    const exitIndex = candles.findIndex(c => c.timestamp === exitTimestamp);
    return {
        ...tradeRecord,
        trade: tradeRecord,
        exitIndex
    };
}
