const watcherRejectedZonesMap = globalThis.__watcherRejectedZonesMap || new Map();
globalThis.__watcherRejectedZonesMap = watcherRejectedZonesMap;
export function recordRejectedZone(watcherId, zone, reason) {
    if (!watcherId || !zone)
        return;
    const existing = watcherRejectedZonesMap.get(watcherId) || [];
    const now = Date.now();
    const pruned = existing.filter(r => now - r.rejectedAt < 4 * 60 * 60 * 1000);
    pruned.push({
        low: zone.low,
        high: zone.high,
        direction: zone.direction,
        rejectedAt: now,
        reason
    });
    watcherRejectedZonesMap.set(watcherId, pruned);
    console.log(`[ZONE REJECTION REGISTRY] Watcher ${watcherId}: Registered rejected zone [${zone.low} - ${zone.high}] (${zone.direction}). Total active rejected levels: ${pruned.length}. Reason: ${reason}`);
}
export function getRejectedZones(watcherId) {
    if (!watcherId)
        return [];
    const existing = watcherRejectedZonesMap.get(watcherId) || [];
    const now = Date.now();
    const pruned = existing.filter(r => now - r.rejectedAt < 4 * 60 * 60 * 1000);
    if (pruned.length !== existing.length) {
        watcherRejectedZonesMap.set(watcherId, pruned);
    }
    return pruned;
}
export function clearRejectedZones(watcherId) {
    if (watcherId)
        watcherRejectedZonesMap.delete(watcherId);
}
export function generateZoneId(pair, type, direction) {
    const cleanPair = (pair || 'ZONE').replace(/[^a-zA-Z0-9]/g, '');
    const timestamp = Date.now().toString(36);
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    return `zone_${cleanPair}_${direction.toLowerCase()}_${timestamp}_${randomSuffix}`;
}
function calculateBuffer(candles, currentPrice, pair) {
    const sym = (pair || '').toUpperCase();
    const isForex = !sym.includes('XAU') && !sym.includes('GOLD') && !sym.includes('BTC') && !sym.includes('ETH') && currentPrice < 50;
    const isGold = sym.includes('XAU') || sym.includes('GOLD');
    const isJpy = sym.includes('JPY');
    let atr = currentPrice * 0.002;
    if (candles && candles.length >= 2) {
        let totalTr = 0;
        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            totalTr += tr;
        }
        atr = totalTr / (candles.length - 1);
    }
    let buffer;
    if (isGold) {
        buffer = Math.min(Math.max(atr * 0.15, 0.40), 2.50);
    }
    else if (isJpy) {
        buffer = Math.min(Math.max(atr * 0.15, 0.02), 0.06);
    }
    else if (isForex) {
        buffer = Math.min(Math.max(atr * 0.15, 0.00015), 0.00030);
    }
    else {
        buffer = Math.min(Math.max(atr * 0.15, currentPrice * 0.0005), currentPrice * 0.002);
    }
    return { atr, buffer };
}
export function identifyCandidateZones(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones) {
    if (!candles || candles.length < 5)
        return [];
    const sortedCandles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const latestCandle = sortedCandles[sortedCandles.length - 1];
    const activePrice = (currentPrice && currentPrice > 0) ? currentPrice : latestCandle.close;
    const trend = marketStructure?.trend || 'SIDEWAYS';
    const pair = marketStructure?.pair || 'MARKET';
    const { atr, buffer } = calculateBuffer(sortedCandles, activePrice, pair);
    const rules = compiledStrategy?.compiled_rules;
    const hasOrderBlockPreference = !!(rules?.order_block || rules?.supply_demand || rules?.unmitigated_zone);
    const hasFvgPreference = !!rules?.fair_value_gap;
    const hasSrPreference = !!(rules?.support || rules?.resistance || rules?.support_rejection || rules?.resistance_rejection);
    const hasLiquidityPreference = !!rules?.liquidity_sweep;
    const isStrategyFiltered = hasOrderBlockPreference || hasFvgPreference || hasSrPreference || hasLiquidityPreference;
    const allowFvg = isStrategyFiltered ? hasFvgPreference : true;
    const allowOrderBlocks = isStrategyFiltered ? hasOrderBlockPreference : true;
    const allowLiquidity = isStrategyFiltered ? hasLiquidityPreference : true;
    const allowSr = isStrategyFiltered ? hasSrPreference : true;
    const enforceUnmitigated = rules?.unmitigated_zone !== false;
    const candidateZones = [];
    if (allowFvg && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
        for (const fvg of marketStructure.fairValueGaps) {
            if (fvg.isFilled)
                continue;
            if (fvg.candleIndex !== undefined && fvg.candleIndex < sortedCandles.length - 45)
                continue;
            if (fvg.filledPercentage !== undefined && fvg.filledPercentage > 0.20)
                continue;
            if (fvg.type === 'BULLISH_FVG' && fvg.bottom <= activePrice) {
                if (fvg.candleIndex !== undefined) {
                    let gapMitigated = false;
                    for (let k = fvg.candleIndex + 1; k < sortedCandles.length; k++) {
                        if (sortedCandles[k].low <= fvg.top) {
                            gapMitigated = true;
                            break;
                        }
                    }
                    if (gapMitigated)
                        continue;
                }
                const low = Number(fvg.bottom.toFixed(5));
                const high = Number(fvg.top.toFixed(5));
                const invalidation = Number((low - buffer).toFixed(5));
                const distanceRatio = Math.abs(activePrice - high) / activePrice;
                const proximityScore = Math.max(0, 100 - (distanceRatio * 1000));
                const strength = Math.round(proximityScore * (trend === 'BULLISH' ? 1.0 : 0.8));
                candidateZones.push({
                    id: generateZoneId(pair, 'BULLISH_FVG', 'BUY'),
                    type: 'BULLISH_FVG',
                    direction: 'BUY',
                    high,
                    low,
                    invalidationLevel: invalidation,
                    strength,
                    createdAt: new Date().toISOString(),
                    createdCandleTime: String(latestCandle.timestamp),
                    tappedAt: null,
                    tapCount: 0,
                    status: 'WAITING_FOR_TAP',
                    reasoning: `Fresh Unmitigated Bullish Fair Value Gap [${low} - ${high}].`,
                    candleIndex: fvg.candleIndex
                });
            }
            else if (fvg.type === 'BEARISH_FVG' && fvg.top >= activePrice) {
                if (fvg.candleIndex !== undefined) {
                    let gapMitigated = false;
                    for (let k = fvg.candleIndex + 1; k < sortedCandles.length; k++) {
                        if (sortedCandles[k].high >= fvg.bottom) {
                            gapMitigated = true;
                            break;
                        }
                    }
                    if (gapMitigated)
                        continue;
                }
                const low = Number(fvg.bottom.toFixed(5));
                const high = Number(fvg.top.toFixed(5));
                const invalidation = Number((high + buffer).toFixed(5));
                const distanceRatio = Math.abs(low - activePrice) / activePrice;
                const proximityScore = Math.max(0, 100 - (distanceRatio * 1000));
                const strength = Math.round(proximityScore * (trend === 'BEARISH' ? 1.0 : 0.8));
                candidateZones.push({
                    id: generateZoneId(pair, 'BEARISH_FVG', 'SELL'),
                    type: 'BEARISH_FVG',
                    direction: 'SELL',
                    high,
                    low,
                    invalidationLevel: invalidation,
                    strength,
                    createdAt: new Date().toISOString(),
                    createdCandleTime: String(latestCandle.timestamp),
                    tappedAt: null,
                    tapCount: 0,
                    status: 'WAITING_FOR_TAP',
                    reasoning: `Fresh Unmitigated Bearish Fair Value Gap [${low} - ${high}].`,
                    candleIndex: fvg.candleIndex
                });
            }
        }
    }
    if (allowOrderBlocks) {
        for (let i = sortedCandles.length - 2; i >= Math.max(0, sortedCandles.length - 35); i--) {
            const c = sortedCandles[i];
            const body = Math.abs(c.close - c.open);
            const isDownCandle = c.close < c.open || (c.close === c.open && body <= atr * 0.1);
            const zoneHeight = c.high - c.low;
            const minZoneHeight = Math.max(atr * 0.35, buffer * 1.5);
            if (isDownCandle && zoneHeight >= minZoneHeight) {
                const obHigh = Number(Math.max(c.open, c.high).toFixed(5));
                const obLow = Number(c.low.toFixed(5));
                let displacementIdx = -1;
                let hasStructuralBreak = false;
                for (let d = i + 1; d < Math.min(sortedCandles.length, i + 5); d++) {
                    const dispCandle = sortedCandles[d];
                    const dispExpansion = dispCandle.close - obHigh;
                    const dispBody = dispCandle.close - dispCandle.open;
                    const hasDecisiveExpansion = dispExpansion >= Math.max(atr * 0.75, buffer * 2.0) && dispBody >= atr * 0.5;
                    const brokeSwingHigh = (marketStructure?.swingHighs || []).some(sh => sh.index < d && sh.index >= Math.max(0, i - 20) && dispCandle.high > sh.price);
                    const hasBosOrChoch = (marketStructure?.BOS || []).some(b => b.type === 'BULLISH_BOS' && b.candleIndex >= i && b.candleIndex <= d) || (marketStructure?.CHOCH || []).some(ch => ch.type === 'BULLISH_CHOCH' && ch.candleIndex >= i && ch.candleIndex <= d);
                    const createdFvg = (marketStructure?.fairValueGaps || []).some(f => f.type === 'BULLISH_FVG' && f.candleIndex >= i && f.candleIndex <= d);
                    if (hasDecisiveExpansion && (brokeSwingHigh || hasBosOrChoch || createdFvg || dispExpansion >= atr * 1.25)) {
                        displacementIdx = d;
                        hasStructuralBreak = brokeSwingHigh || hasBosOrChoch || createdFvg;
                        break;
                    }
                }
                if (displacementIdx !== -1) {
                    let isMitigated = false;
                    for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
                        if (sortedCandles[k].low <= obHigh) {
                            isMitigated = true;
                            break;
                        }
                    }
                    if (!enforceUnmitigated || !isMitigated) {
                        if (activePrice >= obLow - buffer * 0.2) {
                            const invalidation = Number((obLow - buffer).toFixed(5));
                            const distanceRatio = Math.abs(activePrice - obHigh) / activePrice;
                            const proximityScore = Math.max(0, 95 - (distanceRatio * 1000));
                            const isImmediate = displacementIdx === i + 1;
                            const recencyWeight = (i / sortedCandles.length) * 15;
                            const immediateBonus = isImmediate ? 20 : 0;
                            const structuralBonus = hasStructuralBreak ? 25 : 0;
                            const strength = Math.round(Math.min(100, (proximityScore * 0.5 + recencyWeight + immediateBonus + structuralBonus) * (trend === 'BULLISH' ? 1.0 : 0.85)));
                            candidateZones.push({
                                id: generateZoneId(pair, 'BULLISH_ORDER_BLOCK', 'BUY'),
                                type: 'BULLISH_ORDER_BLOCK',
                                direction: 'BUY',
                                high: obHigh,
                                low: obLow,
                                invalidationLevel: invalidation,
                                strength,
                                createdAt: new Date().toISOString(),
                                createdCandleTime: String(c.timestamp),
                                displacementCandleTime: String(sortedCandles[displacementIdx].timestamp),
                                displacementIndex: displacementIdx,
                                tappedAt: null,
                                tapCount: 0,
                                status: 'WAITING_FOR_TAP',
                                reasoning: `Institutional Demand Zone / Bullish Order Block [${obLow} - ${obHigh}] confirmed with structural displacement.${hasStructuralBreak ? ' (BOS / Swing High Broken)' : ''}`,
                                candleIndex: i
                            });
                        }
                    }
                }
            }
            const isUpCandle = c.close > c.open || (c.close === c.open && body <= atr * 0.1);
            if (isUpCandle && zoneHeight >= minZoneHeight) {
                const obHigh = Number(c.high.toFixed(5));
                const obLow = Number(Math.min(c.open, c.low).toFixed(5));
                let displacementIdx = -1;
                let hasStructuralBreak = false;
                for (let d = i + 1; d < Math.min(sortedCandles.length, i + 5); d++) {
                    const dispCandle = sortedCandles[d];
                    const dispExpansion = obLow - dispCandle.close;
                    const dispBody = dispCandle.open - dispCandle.close;
                    const hasDecisiveExpansion = dispExpansion >= Math.max(atr * 0.75, buffer * 2.0) && dispBody >= atr * 0.5;
                    const brokeSwingLow = (marketStructure?.swingLows || []).some(sl => sl.index < d && sl.index >= Math.max(0, i - 20) && dispCandle.low < sl.price);
                    const hasBosOrChoch = (marketStructure?.BOS || []).some(b => b.type === 'BEARISH_BOS' && b.candleIndex >= i && b.candleIndex <= d) || (marketStructure?.CHOCH || []).some(ch => ch.type === 'BEARISH_CHOCH' && ch.candleIndex >= i && ch.candleIndex <= d);
                    const createdFvg = (marketStructure?.fairValueGaps || []).some(f => f.type === 'BEARISH_FVG' && f.candleIndex >= i && f.candleIndex <= d);
                    if (hasDecisiveExpansion && (brokeSwingLow || hasBosOrChoch || createdFvg || dispExpansion >= atr * 1.25)) {
                        displacementIdx = d;
                        hasStructuralBreak = brokeSwingLow || hasBosOrChoch || createdFvg;
                        break;
                    }
                }
                if (displacementIdx !== -1) {
                    let isMitigated = false;
                    for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
                        if (sortedCandles[k].high >= obLow) {
                            isMitigated = true;
                            break;
                        }
                    }
                    if (!enforceUnmitigated || !isMitigated) {
                        if (activePrice <= obHigh + buffer * 0.2) {
                            const invalidation = Number((obHigh + buffer).toFixed(5));
                            const distanceRatio = Math.abs(obLow - activePrice) / activePrice;
                            const proximityScore = Math.max(0, 95 - (distanceRatio * 1000));
                            const isImmediate = displacementIdx === i + 1;
                            const recencyWeight = (i / sortedCandles.length) * 15;
                            const immediateBonus = isImmediate ? 20 : 0;
                            const structuralBonus = hasStructuralBreak ? 25 : 0;
                            const strength = Math.round(Math.min(100, (proximityScore * 0.5 + recencyWeight + immediateBonus + structuralBonus) * (trend === 'BEARISH' ? 1.0 : 0.85)));
                            candidateZones.push({
                                id: generateZoneId(pair, 'BEARISH_ORDER_BLOCK', 'SELL'),
                                type: 'BEARISH_ORDER_BLOCK',
                                direction: 'SELL',
                                high: obHigh,
                                low: obLow,
                                invalidationLevel: invalidation,
                                strength,
                                createdAt: new Date().toISOString(),
                                createdCandleTime: String(c.timestamp),
                                displacementCandleTime: String(sortedCandles[displacementIdx].timestamp),
                                displacementIndex: displacementIdx,
                                tappedAt: null,
                                tapCount: 0,
                                status: 'WAITING_FOR_TAP',
                                reasoning: `Institutional Supply Zone / Bearish Order Block [${obLow} - ${obHigh}] confirmed with structural displacement.${hasStructuralBreak ? ' (BOS / Swing Low Broken)' : ''}`,
                                candleIndex: i
                            });
                        }
                    }
                }
            }
        }
    }
    if (allowLiquidity && marketStructure?.swingLows && marketStructure.swingLows.length > 0) {
        const validSwingLows = marketStructure.swingLows.filter(s => !s.isBroken && s.price < activePrice);
        if (validSwingLows.length > 0) {
            const nearestLow = validSwingLows[validSwingLows.length - 1];
            const lowPrice = Number(nearestLow.price.toFixed(5));
            const zoneHigh = Number((lowPrice + buffer * 0.8).toFixed(5));
            const invalidation = Number((lowPrice - buffer).toFixed(5));
            const distanceRatio = Math.abs(activePrice - zoneHigh) / activePrice;
            const strength = Math.round(Math.max(0, 85 - (distanceRatio * 1000)));
            candidateZones.push({
                id: generateZoneId(pair, 'SWING_LOW_LIQUIDITY', 'BUY'),
                type: 'SWING_LOW_LIQUIDITY',
                direction: 'BUY',
                high: zoneHigh,
                low: lowPrice,
                invalidationLevel: invalidation,
                strength,
                createdAt: new Date().toISOString(),
                createdCandleTime: String(nearestLow.timestamp),
                tappedAt: null,
                tapCount: 0,
                status: 'WAITING_FOR_TAP',
                reasoning: `Protected Swing Low liquidity zone at price ${lowPrice}.`,
                candleIndex: nearestLow.index
            });
        }
    }
    if (allowLiquidity && marketStructure?.swingHighs && marketStructure.swingHighs.length > 0) {
        const validSwingHighs = marketStructure.swingHighs.filter(s => !s.isBroken && s.price > activePrice);
        if (validSwingHighs.length > 0) {
            const nearestHigh = validSwingHighs[validSwingHighs.length - 1];
            const highPrice = Number(nearestHigh.price.toFixed(5));
            const zoneLow = Number((highPrice - buffer * 0.8).toFixed(5));
            const invalidation = Number((highPrice + buffer).toFixed(5));
            const distanceRatio = Math.abs(zoneLow - activePrice) / activePrice;
            const strength = Math.round(Math.max(0, 85 - (distanceRatio * 1000)));
            candidateZones.push({
                id: generateZoneId(pair, 'SWING_HIGH_LIQUIDITY', 'SELL'),
                type: 'SWING_HIGH_LIQUIDITY',
                direction: 'SELL',
                high: highPrice,
                low: zoneLow,
                invalidationLevel: invalidation,
                strength,
                createdAt: new Date().toISOString(),
                createdCandleTime: String(nearestHigh.timestamp),
                tappedAt: null,
                tapCount: 0,
                status: 'WAITING_FOR_TAP',
                reasoning: `Protected Swing High liquidity zone at price ${highPrice}.`,
                candleIndex: nearestHigh.index
            });
        }
    }
    if (allowSr && marketStructure?.supportZones && marketStructure.supportZones.length > 0) {
        for (const sz of marketStructure.supportZones) {
            if (sz.priceMin < activePrice) {
                const low = Number(sz.priceMin.toFixed(5));
                const high = Number(sz.priceMax.toFixed(5));
                const invalidation = Number((low - buffer).toFixed(5));
                candidateZones.push({
                    id: generateZoneId(pair, 'SUPPORT', 'BUY'),
                    type: 'SUPPORT',
                    direction: 'BUY',
                    high,
                    low,
                    invalidationLevel: invalidation,
                    strength: Math.min(100, (sz.strength || 1) * 20),
                    createdAt: new Date().toISOString(),
                    createdCandleTime: String(latestCandle.timestamp),
                    tappedAt: null,
                    tapCount: 0,
                    status: 'WAITING_FOR_TAP',
                    reasoning: `Structural Support Zone [${low} - ${high}].`
                });
            }
        }
    }
    if (allowSr && marketStructure?.resistanceZones && marketStructure.resistanceZones.length > 0) {
        for (const rz of marketStructure.resistanceZones) {
            if (rz.priceMax > activePrice) {
                const low = Number(rz.priceMin.toFixed(5));
                const high = Number(rz.priceMax.toFixed(5));
                const invalidation = Number((high + buffer).toFixed(5));
                candidateZones.push({
                    id: generateZoneId(pair, 'RESISTANCE', 'SELL'),
                    type: 'RESISTANCE',
                    direction: 'SELL',
                    high,
                    low,
                    invalidationLevel: invalidation,
                    strength: Math.min(100, (rz.strength || 1) * 20),
                    createdAt: new Date().toISOString(),
                    createdCandleTime: String(latestCandle.timestamp),
                    tappedAt: null,
                    tapCount: 0,
                    status: 'WAITING_FOR_TAP',
                    reasoning: `Structural Resistance Zone [${low} - ${high}].`
                });
            }
        }
    }
    if (candidateZones.length === 0) {
        return [];
    }
    const followHtfTrend = compiledStrategy?.compiled_rules?.follow_htf_trend !== false;
    const htfTrend = marketStructure?.htfTrend;
    const htfTimeframe = marketStructure?.htfTimeframe || 'H4';
    const effectiveTrend = (followHtfTrend && htfTrend) ? htfTrend : trend;
    let filteredCandidates = candidateZones;
    if (followHtfTrend && htfTrend) {
        if (htfTrend === 'SIDEWAYS' || marketStructure?.htfAllowedDirection === 'NONE') {
            console.log(`[HTF TREND FILTER] ${pair}: ${htfTimeframe} Trend is SIDEWAYS / unclear (${marketStructure?.htfReason || 'consolidation'}). Defaulting to NO TRADE. No zones marked.`);
            return [];
        }
        if (htfTrend === 'BULLISH') {
            const buyCandidates = candidateZones.filter(z => z.direction === 'BUY');
            if (buyCandidates.length > 0) {
                filteredCandidates = buyCandidates;
            }
            else {
                console.log(`[HTF TREND FILTER] ${pair}: ${htfTimeframe} Trend is BULLISH. Filtered out ${candidateZones.length} counter-trend SELL zones. Waiting for fresh BUY/Demand zone aligned with HTF trend.`);
                return [];
            }
        }
        else if (htfTrend === 'BEARISH') {
            const sellCandidates = candidateZones.filter(z => z.direction === 'SELL');
            if (sellCandidates.length > 0) {
                filteredCandidates = sellCandidates;
            }
            else {
                console.log(`[HTF TREND FILTER] ${pair}: ${htfTimeframe} Trend is BEARISH. Filtered out ${candidateZones.length} counter-trend BUY zones. Waiting for fresh SELL/Supply zone aligned with HTF trend.`);
                return [];
            }
        }
    }
    else {
        if (trend === 'SIDEWAYS') {
            console.log(`[TREND FILTER] ${pair}: Current timeframe trend is SIDEWAYS / unclear. Defaulting to NO TRADE.`);
            return [];
        }
        if (trend === 'BEARISH') {
            const sellCandidates = candidateZones.filter(z => z.direction === 'SELL');
            if (sellCandidates.length > 0)
                filteredCandidates = sellCandidates;
        }
        else if (trend === 'BULLISH') {
            const buyCandidates = candidateZones.filter(z => z.direction === 'BUY');
            if (buyCandidates.length > 0)
                filteredCandidates = buyCandidates;
        }
    }
    if (rejectedZones && rejectedZones.length > 0 && filteredCandidates.length > 0) {
        const originalCount = filteredCandidates.length;
        filteredCandidates = filteredCandidates.filter(candidate => {
            const isRejected = rejectedZones.some(rz => {
                const overlaps = Math.max(candidate.low, rz.low) <= Math.min(candidate.high, rz.high);
                const nearIdentical = Math.abs(candidate.low - rz.low) / (candidate.low || 1) < 0.0015 &&
                    Math.abs(candidate.high - rz.high) / (candidate.high || 1) < 0.0015;
                const sameDirection = !rz.direction || rz.direction === candidate.direction;
                return (overlaps || nearIdentical) && sameDirection;
            });
            return !isRejected;
        });
        if (originalCount > 0 && filteredCandidates.length === 0) {
            console.log(`[ZONE QUALITY DISENGAGEMENT] ${pair}: Filtered out ${originalCount} candidate zone(s) that were previously rejected by quality control. Waiting for another zone to appear.`);
            return [];
        }
    }
    filteredCandidates.sort((a, b) => b.strength - a.strength);
    return filteredCandidates.slice(0, 5).map(z => {
        z.htfTrend = htfTrend || 'SIDEWAYS';
        z.htfTimeframe = htfTimeframe;
        z.htfReason = marketStructure?.htfReason;
        if (htfTrend && htfTrend !== 'SIDEWAYS') {
            z.reasoning = `[${htfTimeframe} ${htfTrend} Trend Aligned] ` + z.reasoning;
        }
        return z;
    });
}
export function identifyMarkedZone(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones) {
    const candidates = identifyCandidateZones(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones);
    return candidates[0] || null;
}
export function isPriceInOrTappingZone(zone, candle, currentPrice) {
    if (!zone || !candle)
        return false;
    const refTime = zone.displacementCandleTime || zone.createdCandleTime;
    if (refTime && candle.timestamp) {
        const candleTime = new Date(candle.timestamp).getTime();
        const zoneOriginTime = new Date(refTime).getTime();
        if (!isNaN(candleTime) && !isNaN(zoneOriginTime) && candleTime <= zoneOriginTime) {
            return false;
        }
    }
    const activePrice = (currentPrice !== undefined && currentPrice !== null && !isNaN(currentPrice))
        ? currentPrice
        : candle.close;
    if (zone.direction === 'SELL') {
        const livePriceInZone = activePrice >= zone.low && activePrice <= zone.invalidationLevel;
        const candleHighInZone = candle.high >= zone.low && candle.close <= zone.invalidationLevel;
        return livePriceInZone || candleHighInZone;
    }
    else if (zone.direction === 'BUY') {
        const livePriceInZone = activePrice <= zone.high && activePrice >= zone.invalidationLevel;
        const candleLowInZone = candle.low <= zone.high && candle.close >= zone.invalidationLevel;
        return livePriceInZone || candleLowInZone;
    }
    const livePriceInZone = activePrice >= zone.low && activePrice <= zone.high;
    const candleOverlaps = candle.low <= zone.high && candle.high >= zone.low;
    return livePriceInZone || candleOverlaps;
}
export function evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle) {
    const candleRange = Math.max(0.00001, latestCandle.high - latestCandle.low);
    if (zone.direction === 'BUY') {
        if (latestCandle.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel) {
            return { isRejected: false, rejectionReason: 'Price broke below BUY invalidation level.' };
        }
        const candleReachedZone = latestCandle.low <= zone.high || (prevCandle && prevCandle.low <= zone.high);
        if (!candleReachedZone && currentPrice > zone.high) {
            return { isRejected: false, rejectionReason: 'Price has not tested the marked BUY zone.' };
        }
        const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
        const lowerWickRatio = lowerWick / candleRange;
        if (lowerWickRatio >= 0.20 && latestCandle.low <= zone.high && latestCandle.close >= zone.low) {
            return {
                isRejected: true,
                rejectionType: 'WICK',
                rejectionReason: `Bullish wick rejection: Lower shadow ${(lowerWickRatio * 100).toFixed(0)}% tested zone [${zone.low} - ${zone.high}] and rejected upward.`
            };
        }
        const isBullishCandle = latestCandle.close > latestCandle.open;
        if (isBullishCandle && candleReachedZone && latestCandle.close >= zone.low) {
            return {
                isRejected: true,
                rejectionType: 'BOUNCE',
                rejectionReason: `Bullish candle rejection: Closed green (${latestCandle.close.toFixed(5)} > ${latestCandle.open.toFixed(5)}) off marked zone.`
            };
        }
        if (candleReachedZone && currentPrice > latestCandle.open && currentPrice >= zone.low) {
            return {
                isRejected: true,
                rejectionType: 'DEPARTURE',
                rejectionReason: `Bullish rejection bounce: Price (${currentPrice.toFixed(5)}) tested zone [${zone.low} - ${zone.high}] and advancing upward holding invalidation (${zone.invalidationLevel.toFixed(5)}).`
            };
        }
    }
    else if (zone.direction === 'SELL') {
        if (latestCandle.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel) {
            return { isRejected: false, rejectionReason: 'Price broke above SELL invalidation level.' };
        }
        const candleReachedZone = latestCandle.high >= zone.low || (prevCandle && prevCandle.high >= zone.low);
        if (!candleReachedZone && currentPrice < zone.low) {
            return { isRejected: false, rejectionReason: 'Price has not tested the marked SELL zone.' };
        }
        const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
        const upperWickRatio = upperWick / candleRange;
        if (upperWickRatio >= 0.20 && latestCandle.high >= zone.low && latestCandle.close <= zone.high) {
            return {
                isRejected: true,
                rejectionType: 'WICK',
                rejectionReason: `Bearish wick rejection: Upper shadow ${(upperWickRatio * 100).toFixed(0)}% tested zone [${zone.low} - ${zone.high}] and rejected downward.`
            };
        }
        const isBearishCandle = latestCandle.close < latestCandle.open;
        if (isBearishCandle && candleReachedZone && latestCandle.close <= zone.high) {
            return {
                isRejected: true,
                rejectionType: 'BOUNCE',
                rejectionReason: `Bearish candle rejection: Closed red (${latestCandle.close.toFixed(5)} < ${latestCandle.open.toFixed(5)}) off marked zone.`
            };
        }
        if (candleReachedZone && currentPrice < latestCandle.open && currentPrice <= zone.high) {
            return {
                isRejected: true,
                rejectionType: 'DEPARTURE',
                rejectionReason: `Bearish rejection bounce: Price (${currentPrice.toFixed(5)}) tested zone [${zone.low} - ${zone.high}] and advancing downward holding invalidation (${zone.invalidationLevel.toFixed(5)}).`
            };
        }
    }
    return { isRejected: false, rejectionReason: 'Awaiting clean price action rejection from marked zone.' };
}
export function detectLargeDisplacementAway(zone, candles, latestCandle, effectiveAtr = 0.0005, currentPrice) {
    const candidateCandles = [];
    if (candles && candles.length > 0) {
        candidateCandles.push(...candles);
    }
    else if (latestCandle) {
        candidateCandles.push(latestCandle);
    }
    if (candidateCandles.length === 0) {
        return { hasDisplaced: false };
    }
    const originTime = zone.displacementCandleTime || zone.createdCandleTime;
    const originTimestamp = originTime ? new Date(originTime).getTime() : 0;
    const postCandles = candidateCandles.filter(c => {
        if (!c.timestamp || isNaN(originTimestamp) || originTimestamp === 0)
            return true;
        const cTime = new Date(c.timestamp).getTime();
        return !isNaN(cTime) && cTime > originTimestamp;
    });
    const checkList = postCandles.length > 0 ? postCandles : (latestCandle ? [latestCandle] : candidateCandles.slice(-3));
    for (let i = checkList.length - 1; i >= 0; i--) {
        const c = checkList[i];
        const range = c.high - c.low;
        const body = Math.abs(c.close - c.open);
        const isLargeCandle = range >= effectiveAtr * 1.6;
        const isStrongBody = range > 0 && (body / range) >= 0.55;
        if (isLargeCandle && isStrongBody) {
            if (zone.direction === 'BUY') {
                const isBullish = c.close > c.open;
                const departedFar = c.close > zone.high + (effectiveAtr * 3.5);
                if (isBullish && departedFar) {
                    return {
                        hasDisplaced: true,
                        reason: `Large Bullish Displacement Candle detected (${range.toFixed(5)} range >= ${(effectiveAtr * 1.6).toFixed(5)}, body ${(body / range * 100).toFixed(0)}%) closing at ${c.close.toFixed(5)} (>3.5 ATR above Demand Zone [${zone.low} - ${zone.high}]). Institutional displacement departed away without retrace.`
                    };
                }
            }
            else if (zone.direction === 'SELL') {
                const isBearish = c.close < c.open;
                const departedFar = c.close < zone.low - (effectiveAtr * 3.5);
                if (isBearish && departedFar) {
                    return {
                        hasDisplaced: true,
                        reason: `Large Bearish Displacement Candle detected (${range.toFixed(5)} range >= ${(effectiveAtr * 1.6).toFixed(5)}, body ${(body / range * 100).toFixed(0)}%) closing at ${c.close.toFixed(5)} (>3.5 ATR below Supply Zone [${zone.low} - ${zone.high}]). Institutional displacement departed away without retrace.`
                    };
                }
            }
        }
    }
    return { hasDisplaced: false };
}
export function evaluateZoneState(zone, latestCandle, currentPrice, atr, candles, marketStructure) {
    const updatedZone = { ...zone };
    const effectiveAtr = atr || 0.0005;
    if (marketStructure?.htfTrend === 'SIDEWAYS' || marketStructure?.htfAllowedDirection === 'NONE') {
        updatedZone.status = 'INVALIDATED';
        return {
            status: 'INVALIDATED',
            isTapped: false,
            isInvalidated: true,
            reason: `Zone invalidated: Higher timeframe (${marketStructure?.htfTimeframe || 'H4'}) trend is SIDEWAYS / unclear. System strictly defaults to NO TRADE in consolidation.`,
            updatedZone
        };
    }
    if (marketStructure?.htfTrend) {
        if (zone.direction === 'BUY' && marketStructure.htfTrend === 'BEARISH') {
            updatedZone.status = 'INVALIDATED';
            return {
                status: 'INVALIDATED',
                isTapped: false,
                isInvalidated: true,
                reason: `Zone invalidated: Higher timeframe (${marketStructure?.htfTimeframe || 'H4'}) trend is BEARISH contrary to BUY marked zone.`,
                updatedZone
            };
        }
        if (zone.direction === 'SELL' && marketStructure.htfTrend === 'BULLISH') {
            updatedZone.status = 'INVALIDATED';
            return {
                status: 'INVALIDATED',
                isTapped: false,
                isInvalidated: true,
                reason: `Zone invalidated: Higher timeframe (${marketStructure?.htfTimeframe || 'H4'}) trend is BULLISH contrary to SELL marked zone.`,
                updatedZone
            };
        }
    }
    const activePrice = (currentPrice !== undefined && currentPrice !== null && !isNaN(currentPrice))
        ? currentPrice
        : latestCandle.close;
    if (zone.status === 'CONFIRMED') {
        const pipSize = (zone.high > 50) ? 0.01 : 0.0001;
        const departure = zone.direction === 'SELL' ? (zone.low - activePrice) : (activePrice - zone.high);
        const departurePips = departure / pipSize;
        if (departurePips > 4.0 || departure > effectiveAtr * 0.5) {
            updatedZone.status = 'EXPIRED';
            return {
                status: 'EXPIRED',
                isTapped: true,
                isInvalidated: true,
                isRejected: false,
                reason: `Zone expired: Confirmed ${zone.direction} zone [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}] has already moved ${departurePips.toFixed(1)} pips in target direction. Retest entry window has passed.`,
                updatedZone
            };
        }
    }
    const invLevel = (zone.invalidationLevel !== undefined && zone.invalidationLevel !== null && !isNaN(zone.invalidationLevel))
        ? zone.invalidationLevel
        : (zone.direction === 'BUY' ? zone.low - (zone.high - zone.low) * 0.5 : zone.high + (zone.high - zone.low) * 0.5);
    if (zone.direction === 'BUY') {
        if (latestCandle.close < invLevel ||
            activePrice < invLevel) {
            updatedZone.status = 'INVALIDATED';
            return {
                status: 'INVALIDATED',
                isTapped: false,
                isInvalidated: true,
                reason: `Zone invalidated: Price (${activePrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke below BUY invalidation level (${invLevel.toFixed(5)}).`,
                updatedZone
            };
        }
    }
    else if (zone.direction === 'SELL') {
        if (latestCandle.close > invLevel ||
            activePrice > invLevel) {
            updatedZone.status = 'INVALIDATED';
            return {
                status: 'INVALIDATED',
                isTapped: false,
                isInvalidated: true,
                reason: `Zone invalidated: Price (${activePrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke above SELL invalidation level (${invLevel.toFixed(5)}).`,
                updatedZone
            };
        }
    }
    const prevCandle = candles && candles.length >= 2 ? candles[candles.length - 2] : undefined;
    const candleList = (candles && candles.length > 0) ? candles : (latestCandle ? [latestCandle] : []);
    let tapCandleIndex = -1;
    let tapCandle = undefined;
    const originTime = zone.displacementCandleTime || zone.createdCandleTime;
    const originTimestamp = originTime ? new Date(originTime).getTime() : 0;
    if (candleList.length > 0) {
        for (let cIdx = 0; cIdx < candleList.length; cIdx++) {
            const c = candleList[cIdx];
            if (originTimestamp > 0 && c.timestamp) {
                const cTime = new Date(c.timestamp).getTime();
                if (!isNaN(cTime) && cTime <= originTimestamp) {
                    continue;
                }
            }
            if (isPriceInOrTappingZone(zone, c, currentPrice)) {
                tapCandleIndex = cIdx;
                tapCandle = c;
                break;
            }
        }
    }
    const liveTapping = isPriceInOrTappingZone(zone, latestCandle, currentPrice);
    if (tapCandleIndex === -1 && liveTapping) {
        tapCandleIndex = candleList.length - 1;
        tapCandle = latestCandle;
    }
    const wasPreviouslyTapped = (zone.status === 'ZONE_TAPPED' || zone.status === 'CONFIRMED' || (zone.tapCount !== undefined && zone.tapCount > 0) || !!zone.tappedAt);
    if (tapCandleIndex !== -1 || wasPreviouslyTapped) {
        const tapTimestamp = tapCandle?.timestamp ? String(tapCandle.timestamp) : new Date().toISOString();
        updatedZone.tappedAt = zone.tappedAt || tapTimestamp;
        updatedZone.tapCount = Math.max(zone.tapCount || 1, 1);
        const isLatestCandleTheTap = tapCandleIndex === (candleList.length - 1);
        if (isLatestCandleTheTap && tapCandleIndex !== -1) {
            const rejection = evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle);
            if (rejection.isRejected) {
                updatedZone.status = 'CONFIRMED';
                return {
                    status: 'CONFIRMED',
                    isTapped: true,
                    isInvalidated: false,
                    isRejected: true,
                    rejectionReason: rejection.rejectionReason,
                    reason: `Zone valid: Price (${currentPrice.toFixed(5)}) confirmed immediate rejection bounce off marked zone [${zone.low} - ${zone.high}]. ${rejection.rejectionReason}`,
                    updatedZone
                };
            }
            updatedZone.status = 'ZONE_TAPPED';
            return {
                status: 'ZONE_TAPPED',
                isTapped: true,
                isInvalidated: false,
                isRejected: false,
                reason: `Zone tapped: Candle at ${tapCandle?.timestamp || 'current time'} entered marked zone [${zone.low} - ${zone.high}]. Awaiting next candle to evaluate retest vs continuation.`,
                updatedZone
            };
        }
        const postTapCandles = candles && tapCandleIndex >= 0
            ? candles.slice(tapCandleIndex + 1)
            : (candles && candles.length >= 2 ? [candles[candles.length - 1]] : []);
        const nextCandle = postTapCandles.length > 0 ? postTapCandles[0] : latestCandle;
        if (zone.direction === 'BUY') {
            const brokeThrough = postTapCandles.some(c => {
                const cRange = Math.max(c.high - c.low, 0.00001);
                const lowerWickRatio = (Math.min(c.open, c.close) - c.low) / cRange;
                return (c.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel) ||
                    (c.close < zone.low && c.close < c.open && lowerWickRatio < 0.20);
            });
            if (brokeThrough) {
                updatedZone.status = 'INVALIDATED';
                return {
                    status: 'INVALIDATED',
                    isTapped: true,
                    isInvalidated: true,
                    isRejected: false,
                    reason: `Zone invalidated: After tapping, price kept going downward through marked zone [${zone.low} - ${zone.high}] (Current: ${currentPrice.toFixed(5)}, Invalidation: ${zone.invalidationLevel.toFixed(5)}) instead of holding retest.`,
                    updatedZone
                };
            }
        }
        else if (zone.direction === 'SELL') {
            const brokeThrough = postTapCandles.some(c => {
                const cRange = Math.max(c.high - c.low, 0.00001);
                const upperWickRatio = (c.high - Math.max(c.open, c.close)) / cRange;
                return (c.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel) ||
                    (c.close > zone.high && c.close > c.open && upperWickRatio < 0.20);
            });
            if (brokeThrough) {
                updatedZone.status = 'INVALIDATED';
                return {
                    status: 'INVALIDATED',
                    isTapped: true,
                    isInvalidated: true,
                    isRejected: false,
                    reason: `Zone invalidated: After tapping, price kept going upward through marked zone [${zone.low} - ${zone.high}] (Current: ${currentPrice.toFixed(5)}, Invalidation: ${zone.invalidationLevel.toFixed(5)}) instead of holding retest.`,
                    updatedZone
                };
            }
        }
        const rejection = evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle);
        let madeRetest = rejection.isRejected;
        if (!madeRetest && postTapCandles.length > 0) {
            for (const c of postTapCandles) {
                const cRange = Math.max(c.high - c.low, 0.00001);
                if (zone.direction === 'BUY') {
                    const lowerWickRatio = (Math.min(c.open, c.close) - c.low) / cRange;
                    if (c.low <= zone.high && c.close >= zone.low && (c.close > c.open || lowerWickRatio >= 0.20)) {
                        madeRetest = true;
                        break;
                    }
                }
                else if (zone.direction === 'SELL') {
                    const upperWickRatio = (c.high - Math.max(c.open, c.close)) / cRange;
                    if (c.high >= zone.low && c.close <= zone.high && (c.close < c.open || upperWickRatio >= 0.20)) {
                        madeRetest = true;
                        break;
                    }
                }
            }
        }
        if (madeRetest) {
            const pipSize = (zone.high > 50) ? 0.01 : 0.0001;
            const departure = zone.direction === 'SELL' ? (zone.low - currentPrice) : (currentPrice - zone.high);
            const departurePips = departure / pipSize;
            if (departurePips > 4.0 || departure > effectiveAtr * 0.5) {
                updatedZone.status = 'EXPIRED';
                return {
                    status: 'EXPIRED',
                    isTapped: true,
                    isInvalidated: true,
                    isRejected: false,
                    reason: `Zone expired: After tapping and rejecting, price has already moved ${departurePips.toFixed(1)} pips past marked ${zone.direction} zone [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}]. Retest entry window has passed.`,
                    updatedZone
                };
            }
            updatedZone.status = 'CONFIRMED';
            return {
                status: 'CONFIRMED',
                isTapped: true,
                isInvalidated: false,
                isRejected: true,
                rejectionReason: rejection.rejectionReason || 'Confirmed valid retest holding marked zone.',
                reason: `Zone valid: After tapping, next candle successfully made a retest respecting marked ${zone.direction} zone [${zone.low} - ${zone.high}] with confirmed rejection.`,
                updatedZone
            };
        }
        updatedZone.status = 'ZONE_TAPPED';
        return {
            status: 'ZONE_TAPPED',
            isTapped: true,
            isInvalidated: false,
            isRejected: false,
            reason: `Zone tapped: Next candle is retesting marked zone [${zone.low} - ${zone.high}]. Awaiting retest close or bounce confirmation.`,
            updatedZone
        };
    }
    const displacementCheck = detectLargeDisplacementAway(zone, candles, latestCandle, effectiveAtr, currentPrice);
    if (displacementCheck.hasDisplaced) {
        updatedZone.status = 'EXPIRED';
        return {
            status: 'EXPIRED',
            isTapped: false,
            isInvalidated: true,
            reason: displacementCheck.reason || `Zone expired: Large candle displacement detected departing without retrace.`,
            updatedZone
        };
    }
    updatedZone.status = 'WAITING_FOR_TAP';
    return {
        status: 'WAITING_FOR_TAP',
        isTapped: false,
        isInvalidated: false,
        reason: `Sticking with entry position: Price (${currentPrice.toFixed(5)}) has not tapped marked zone [${zone.low} - ${zone.high}]. No large candle displacement detected; maintaining entry position.`,
        updatedZone
    };
}
