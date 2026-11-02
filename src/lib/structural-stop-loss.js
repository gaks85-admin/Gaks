export function getTimeframeMaxSlPips(timeframe, symbol) {
    const tf = (timeframe || 'M5').toUpperCase();
    const sym = (symbol || '').toUpperCase();
    const isGold = sym.includes('XAU') || sym.includes('GOLD');
    const isJpy = sym.includes('JPY');
    if (isGold) {
        if (tf === 'M1' || tf === 'M5')
            return 15;
        if (tf === 'M15')
            return 25;
        if (tf === 'M30')
            return 40;
        if (tf === 'H1')
            return 60;
        return 100;
    }
    if (isJpy) {
        if (tf === 'M1' || tf === 'M5')
            return 5.0;
        if (tf === 'M15')
            return 8.0;
        if (tf === 'M30')
            return 12.0;
        if (tf === 'H1')
            return 20.0;
        return 40.0;
    }
    if (tf === 'M1')
        return 4.0;
    if (tf === 'M5')
        return 6.5;
    if (tf === 'M15')
        return 10.0;
    if (tf === 'M30')
        return 15.0;
    if (tf === 'H1')
        return 22.0;
    if (tf === 'H4')
        return 40.0;
    return 10.0;
}
export function getMaxDeparturePips(timeframe, symbol, atr) {
    const tf = (timeframe || 'M5').toUpperCase();
    const sym = (symbol || '').toUpperCase();
    const isGold = sym.includes('XAU') || sym.includes('GOLD');
    if (isGold) {
        if (tf === 'M1' || tf === 'M5')
            return 15;
        if (tf === 'M15')
            return 25;
        return 50;
    }
    if (tf === 'M1' || tf === 'M5')
        return 3.5;
    if (tf === 'M15')
        return 5.0;
    if (tf === 'M30')
        return 7.5;
    if (tf === 'H1')
        return 12.0;
    return 25.0;
}
export function validateZoneProximityAndStopLoss(direction, currentPrice, zone, timeframe, symbol, atr) {
    const sym = (symbol || '').toUpperCase();
    const tf = (timeframe || 'M5').toUpperCase();
    const pipSize = (sym.includes('JPY') || sym.includes('XAU') || sym.includes('GOLD') || currentPrice > 50) ? 0.01 : 0.0001;
    const effectiveAtr = atr && atr > 0 ? atr : currentPrice * 0.0005;
    const maxDeparturePips = getMaxDeparturePips(tf, sym, effectiveAtr);
    const maxSlPips = getTimeframeMaxSlPips(tf, sym);
    let departurePips = 0;
    if (direction === 'SELL') {
        if (currentPrice < zone.low) {
            departurePips = (zone.low - currentPrice) / pipSize;
        }
    }
    else {
        if (currentPrice > zone.high) {
            departurePips = (currentPrice - zone.high) / pipSize;
        }
    }
    if (departurePips > maxDeparturePips) {
        return {
            isLateEntry: true,
            lateReason: `Late entry rejected: Price (${currentPrice.toFixed(5)}) has moved ${departurePips.toFixed(1)} pips past marked ${zone.type || 'POI'} [${zone.low?.toFixed(5) || '0.00000'} - ${zone.high?.toFixed(5) || '0.00000'}] in ${direction} direction (Max allowable departure: ${maxDeparturePips.toFixed(1)} pips). Entry window closed; trade would chase the move and inflate Stop Loss.`,
            entryPrice: currentPrice,
            stopLoss: zone.invalidationLevel,
            stopLossBasis: direction === 'SELL' ? 'SUPPLY_ZONE' : 'DEMAND_ZONE',
            structuralLevel: direction === 'SELL' ? zone.high : zone.low,
            slDistancePips: Math.abs(currentPrice - zone.invalidationLevel) / pipSize,
            isSlTooWide: true
        };
    }
    const buffer = sym.includes('XAU') || sym.includes('GOLD')
        ? Math.min(Math.max(effectiveAtr * 0.15, 0.40), 2.50)
        : Math.min(Math.max(effectiveAtr * 0.15, pipSize * 1.5), pipSize * 2.5);
    const basis = zone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : (direction === 'SELL' ? 'SUPPLY_ZONE' : 'DEMAND_ZONE');
    let resolvedSl = direction === 'SELL' ? (zone.high + buffer) : (zone.low - buffer);
    if (zone.invalidationLevel) {
        if (direction === 'SELL' && zone.invalidationLevel > currentPrice) {
            const invDistPips = (zone.invalidationLevel - currentPrice) / pipSize;
            if (invDistPips <= maxSlPips) {
                resolvedSl = Math.min(zone.invalidationLevel, zone.high + buffer * 1.5);
            }
        }
        else if (direction === 'BUY' && zone.invalidationLevel < currentPrice) {
            const invDistPips = (currentPrice - zone.invalidationLevel) / pipSize;
            if (invDistPips <= maxSlPips) {
                resolvedSl = Math.max(zone.invalidationLevel, zone.low - buffer * 1.5);
            }
        }
    }
    if (direction === 'SELL') {
        resolvedSl = Math.min(resolvedSl, currentPrice + (maxSlPips * pipSize));
    }
    else {
        resolvedSl = Math.max(resolvedSl, currentPrice - (maxSlPips * pipSize));
    }
    const slDistancePips = Math.abs(currentPrice - resolvedSl) / pipSize;
    const isSlTooWide = slDistancePips > (maxSlPips * 1.25);
    return {
        isLateEntry: false,
        entryPrice: currentPrice,
        stopLoss: Number(resolvedSl.toFixed(5)),
        stopLossBasis: basis,
        structuralLevel: direction === 'SELL' ? zone.high : zone.low,
        slDistancePips,
        isSlTooWide
    };
}
export function calculateStructuralStopLoss(direction, entryPrice, marketStructure) {
    const atr = marketStructure?.volatilityInformation?.atr && marketStructure.volatilityInformation.atr > 0
        ? marketStructure.volatilityInformation.atr
        : entryPrice * 0.005;
    const tf = marketStructure?.timeframe || 'M5';
    const sym = marketStructure?.pair || '';
    const isGold = sym.includes('XAU') || sym.includes('GOLD');
    const pipSize = (sym.includes('JPY') || isGold || entryPrice > 50) ? 0.01 : 0.0001;
    const maxSlPips = getTimeframeMaxSlPips(tf, sym);
    const maxSlDistance = maxSlPips * pipSize;
    const buffer = isGold
        ? Math.min(Math.max(atr * 0.15, 0.40), 2.50)
        : Math.min(Math.max(atr * 0.15, pipSize * 1.5), pipSize * 2.5);
    const minSlDistance = Math.min(Math.max(atr * 0.8, pipSize * 2.5), maxSlDistance * 0.6);
    if (direction === 'BUY') {
        const markedZone = marketStructure?.markedZone;
        let finalSl = null;
        let finalBasis = null;
        let finalStructural = null;
        if (markedZone && markedZone.direction === 'BUY') {
            const zoneFloor = typeof markedZone.low === 'number' ? markedZone.low : (markedZone.invalidationLevel || entryPrice - buffer);
            const tightSl = zoneFloor - buffer;
            if (markedZone.invalidationLevel && markedZone.invalidationLevel < entryPrice && (entryPrice - markedZone.invalidationLevel) <= maxSlDistance) {
                finalSl = Math.max(markedZone.invalidationLevel, tightSl - buffer);
            }
            else {
                finalSl = tightSl;
            }
            if (finalSl >= entryPrice || (entryPrice - finalSl) > maxSlDistance) {
                finalSl = entryPrice - maxSlDistance;
            }
            finalBasis = markedZone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : 'DEMAND_ZONE';
            finalStructural = zoneFloor;
        }
        if (!finalSl && marketStructure?.supportZones && marketStructure.supportZones.length > 0) {
            const validSupports = marketStructure.supportZones.filter(z => z.priceMin < entryPrice);
            if (validSupports.length > 0) {
                const nearestSupport = validSupports.reduce((prev, curr) => curr.priceMin > prev.priceMin ? curr : prev);
                const sl = Math.max(nearestSupport.priceMin - buffer, entryPrice - maxSlDistance);
                if (sl < entryPrice && sl > 0) {
                    finalSl = sl;
                    finalBasis = 'SUPPORT_ZONE';
                    finalStructural = nearestSupport.priceMin;
                }
            }
        }
        if (!finalSl && marketStructure?.swingLows && marketStructure.swingLows.length > 0) {
            const validLows = marketStructure.swingLows.filter(s => s.price < entryPrice);
            if (validLows.length > 0) {
                const recentLow = validLows[validLows.length - 1].price;
                const sl = Math.max(recentLow - buffer, entryPrice - maxSlDistance);
                if (sl < entryPrice && sl > 0) {
                    finalSl = sl;
                    finalBasis = 'SWING_LOW';
                    finalStructural = recentLow;
                }
            }
        }
        if (!finalSl && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
            const validFvgs = marketStructure.fairValueGaps.filter(f => f.type === 'BULLISH_FVG' && f.bottom < entryPrice);
            if (validFvgs.length > 0) {
                const fvg = validFvgs[validFvgs.length - 1];
                const sl = Math.max(fvg.bottom - buffer, entryPrice - maxSlDistance);
                if (sl < entryPrice && sl > 0) {
                    finalSl = sl;
                    finalBasis = 'DEMAND_ZONE';
                    finalStructural = fvg.bottom;
                }
            }
        }
        if (!finalSl && marketStructure?.latestCandles && marketStructure.latestCandles.length > 0) {
            const recentLows = marketStructure.latestCandles.map(c => c.low).filter(l => l < entryPrice);
            if (recentLows.length > 0) {
                const lowestCandleLow = Math.min(...recentLows);
                const sl = Math.max(lowestCandleLow - buffer, entryPrice - maxSlDistance);
                if (sl < entryPrice && sl > 0) {
                    finalSl = sl;
                    finalBasis = 'STRUCTURAL_CANDLE';
                    finalStructural = lowestCandleLow;
                }
            }
        }
        let stopLoss = finalSl ?? (entryPrice - Math.min(atr * 0.75, maxSlDistance));
        let basis = finalBasis ?? 'ATR_FALLBACK';
        if ((entryPrice - stopLoss) < minSlDistance) {
            const adjustedSl = entryPrice - minSlDistance;
            stopLoss = adjustedSl;
        }
        if ((entryPrice - stopLoss) > maxSlDistance * 1.15) {
            stopLoss = entryPrice - maxSlDistance;
        }
        return {
            stopLoss: Number(stopLoss.toFixed(5)),
            stopLossBasis: basis,
            structuralLevel: finalStructural ? Number(finalStructural.toFixed(5)) : null
        };
    }
    else {
        const markedZone = marketStructure?.markedZone;
        let finalSl = null;
        let finalBasis = null;
        let finalStructural = null;
        if (markedZone && markedZone.direction === 'SELL') {
            const zoneCeiling = typeof markedZone.high === 'number' ? markedZone.high : (markedZone.invalidationLevel || entryPrice + buffer);
            const tightSl = zoneCeiling + buffer;
            if (markedZone.invalidationLevel && markedZone.invalidationLevel > entryPrice && (markedZone.invalidationLevel - entryPrice) <= maxSlDistance) {
                finalSl = Math.min(markedZone.invalidationLevel, tightSl + buffer);
            }
            else {
                finalSl = tightSl;
            }
            if (finalSl !== null && (finalSl <= entryPrice || (finalSl - entryPrice) > maxSlDistance)) {
                finalSl = entryPrice + maxSlDistance;
            }
            finalBasis = markedZone.type?.includes('ORDER_BLOCK') ? 'ORDER_BLOCK' : 'SUPPLY_ZONE';
            finalStructural = zoneCeiling;
        }
        if (!finalSl && marketStructure?.resistanceZones && marketStructure.resistanceZones.length > 0) {
            const validResistances = marketStructure.resistanceZones.filter(z => z.priceMax > entryPrice);
            if (validResistances.length > 0) {
                const nearestResistance = validResistances.reduce((prev, curr) => curr.priceMax < prev.priceMax ? curr : prev);
                const sl = Math.min(nearestResistance.priceMax + buffer, entryPrice + maxSlDistance);
                if (sl > entryPrice) {
                    finalSl = sl;
                    finalBasis = 'RESISTANCE_ZONE';
                    finalStructural = nearestResistance.priceMax;
                }
            }
        }
        if (!finalSl && marketStructure?.swingHighs && marketStructure.swingHighs.length > 0) {
            const validHighs = marketStructure.swingHighs.filter(s => s.price > entryPrice);
            if (validHighs.length > 0) {
                const recentHigh = validHighs[validHighs.length - 1].price;
                const sl = Math.min(recentHigh + buffer, entryPrice + maxSlDistance);
                if (sl > entryPrice) {
                    finalSl = sl;
                    finalBasis = 'SWING_HIGH';
                    finalStructural = recentHigh;
                }
            }
        }
        if (!finalSl && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
            const validFvgs = marketStructure.fairValueGaps.filter(f => f.type === 'BEARISH_FVG' && f.top > entryPrice);
            if (validFvgs.length > 0) {
                const fvg = validFvgs[validFvgs.length - 1];
                const sl = Math.min(fvg.top + buffer, entryPrice + maxSlDistance);
                if (sl > entryPrice) {
                    finalSl = sl;
                    finalBasis = 'SUPPLY_ZONE';
                    finalStructural = fvg.top;
                }
            }
        }
        if (!finalSl && marketStructure?.latestCandles && marketStructure.latestCandles.length > 0) {
            const recentHighs = marketStructure.latestCandles.map(c => c.high).filter(h => h > entryPrice);
            if (recentHighs.length > 0) {
                const highestCandleHigh = Math.max(...recentHighs);
                const sl = Math.min(highestCandleHigh + buffer, entryPrice + maxSlDistance);
                if (sl > entryPrice) {
                    finalSl = sl;
                    finalBasis = 'STRUCTURAL_CANDLE';
                    finalStructural = highestCandleHigh;
                }
            }
        }
        let stopLoss = finalSl ?? (entryPrice + Math.min(atr * 0.75, maxSlDistance));
        let basis = finalBasis ?? 'ATR_FALLBACK';
        if ((stopLoss - entryPrice) < minSlDistance) {
            const adjustedSl = entryPrice + minSlDistance;
            stopLoss = adjustedSl;
        }
        if ((stopLoss - entryPrice) > maxSlDistance * 1.15) {
            stopLoss = entryPrice + maxSlDistance;
        }
        return {
            stopLoss: Number(stopLoss.toFixed(5)),
            stopLossBasis: basis,
            structuralLevel: finalStructural ? Number(finalStructural.toFixed(5)) : null
        };
    }
}
export function validateAndResolveStopLoss(direction, entryPrice, modelSL, modelSLBasis, marketStructure) {
    const deterministicResult = calculateStructuralStopLoss(direction, entryPrice, marketStructure);
    const tf = marketStructure?.timeframe || 'M5';
    const sym = marketStructure?.pair || '';
    const pipSize = (sym.includes('JPY') || sym.includes('XAU') || sym.includes('GOLD') || entryPrice > 50) ? 0.01 : 0.0001;
    const maxSlPips = getTimeframeMaxSlPips(tf, sym);
    const maxReasonableDistance = maxSlPips * pipSize * 1.25;
    if (typeof modelSL === 'number' && !isNaN(modelSL) && isFinite(modelSL) && modelSL > 0 && modelSL !== entryPrice) {
        const isBuyValid = direction === 'BUY' && modelSL < entryPrice;
        const isSellValid = direction === 'SELL' && modelSL > entryPrice;
        const distance = Math.abs(entryPrice - modelSL);
        if ((isBuyValid || isSellValid) && distance <= maxReasonableDistance) {
            const allowedBases = [
                'SUPPORT_ZONE', 'RESISTANCE_ZONE', 'SWING_LOW', 'SWING_HIGH',
                'DEMAND_ZONE', 'SUPPLY_ZONE', 'ORDER_BLOCK', 'STRUCTURAL_CANDLE', 'ATR_FALLBACK'
            ];
            const basis = modelSLBasis && allowedBases.includes(modelSLBasis)
                ? modelSLBasis
                : deterministicResult.stopLossBasis;
            return {
                stopLoss: Number(modelSL.toFixed(5)),
                stopLossBasis: basis,
                structuralLevel: deterministicResult.structuralLevel,
                validated: true
            };
        }
    }
    return {
        stopLoss: deterministicResult.stopLoss,
        stopLossBasis: deterministicResult.stopLossBasis,
        structuralLevel: deterministicResult.structuralLevel,
        validated: false
    };
}
