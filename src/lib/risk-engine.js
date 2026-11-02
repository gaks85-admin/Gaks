export function resolveInstrumentSpec(symbol) {
    const cleanSym = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    let assetClass = 'Forex';
    let contractSize = 100000;
    let minLot = 0.01;
    let maxLot = 100;
    let lotStep = 0.01;
    let tickSize = 0.00001;
    let pipSize = 0.0001;
    let quoteCurrency = 'USD';
    let source = 'Forex Specification Resolver';
    if (cleanSym.includes('BTC') ||
        cleanSym.includes('ETH') ||
        cleanSym.includes('SOL') ||
        cleanSym.includes('XRP') ||
        cleanSym.includes('LTC') ||
        cleanSym.includes('CRYPTO') ||
        cleanSym.endsWith('USDT') ||
        cleanSym.endsWith('USDC') ||
        cleanSym.endsWith('BUSD')) {
        assetClass = 'Crypto';
        contractSize = 1;
        minLot = 0.01;
        maxLot = 100;
        lotStep = 0.01;
        tickSize = 0.01;
        pipSize = 1.0;
        quoteCurrency = cleanSym.endsWith('USDT') ? 'USDT' : (cleanSym.endsWith('USDC') ? 'USDC' : 'USD');
        source = 'Crypto Specification Resolver';
    }
    else if (cleanSym.includes('XAU') ||
        cleanSym.includes('GOLD') ||
        cleanSym.includes('XAG') ||
        cleanSym.includes('SILVER')) {
        assetClass = 'Gold';
        contractSize = 100;
        minLot = 0.01;
        maxLot = 100;
        lotStep = 0.01;
        tickSize = 0.01;
        pipSize = 0.01;
        quoteCurrency = 'USD';
        source = 'Metals Specification Resolver';
    }
    else if (cleanSym.includes('NAS') ||
        cleanSym.includes('US30') ||
        cleanSym.includes('SPX') ||
        cleanSym.includes('US500') ||
        cleanSym.includes('GER') ||
        cleanSym.includes('UK100') ||
        cleanSym.includes('INDEX') ||
        cleanSym.includes('DOW') ||
        cleanSym.includes('US100')) {
        assetClass = 'Indices';
        contractSize = 1;
        minLot = 0.1;
        maxLot = 1000;
        lotStep = 0.1;
        tickSize = 0.1;
        pipSize = 1.0;
        quoteCurrency = (cleanSym.includes('GER') || cleanSym.includes('DE30') || cleanSym.includes('DE40')) ? 'EUR' : (cleanSym.includes('UK100') ? 'GBP' : 'USD');
        source = 'Indices Specification Resolver';
    }
    else {
        assetClass = 'Forex';
        contractSize = 100000;
        minLot = 0.01;
        maxLot = 100;
        lotStep = 0.01;
        tickSize = cleanSym.includes('JPY') ? 0.001 : 0.00001;
        pipSize = cleanSym.includes('JPY') ? 0.001 : 0.0001;
        quoteCurrency = cleanSym.length >= 6 ? cleanSym.substring(cleanSym.length - 3) : 'USD';
        source = 'Forex Specification Resolver';
    }
    return {
        symbol: cleanSym,
        assetClass,
        contractSize,
        minLot,
        maxLot,
        lotStep,
        tickSize,
        pipSize,
        quoteCurrency,
        source
    };
}
export function getInstrumentContractConfig(symbol) {
    return resolveInstrumentSpec(symbol);
}
export function parseRiskRewardRatio(ratioStr) {
    if (!ratioStr)
        return 2;
    const clean = String(ratioStr).trim();
    const parts = clean.split(':');
    if (parts.length === 2) {
        const num = parseFloat(parts[1]);
        if (!isNaN(num) && num > 0)
            return num;
    }
    const parsed = parseFloat(clean.replace(/[^0-9.]/g, ''));
    return !isNaN(parsed) && parsed > 0 ? parsed : 2;
}
export function extractRiskPreferences(prefsRecord, userId) {
    let accountSize = 10000;
    if (prefsRecord?.custom_capital) {
        const parsed = parseFloat(String(prefsRecord.custom_capital).replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            accountSize = parsed;
        }
    }
    let riskPercentage = 1;
    if (prefsRecord?.preferred_risk) {
        const parsed = parseFloat(String(prefsRecord.preferred_risk).replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            riskPercentage = parsed;
        }
    }
    let maxDailyLossAmount = 100;
    const maxLossStr = prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss;
    if (maxLossStr) {
        const parsed = parseFloat(String(maxLossStr).replace(/[^0-9.]/g, ''));
        if (!isNaN(parsed) && parsed > 0) {
            maxDailyLossAmount = parsed;
        }
    }
    const positionMode = prefsRecord?.position_sizing_mode || prefsRecord?.position_mode || 'AUTO_RISK';
    const preferredLotSize = prefsRecord?.preferred_lot_size || (prefsRecord?.fixed_lot_size ? parseFloat(prefsRecord.fixed_lot_size) : undefined);
    return {
        accountSize,
        riskPercentage,
        maxDailyLossAmount,
        positionMode,
        preferredLotSize,
        riskRewardStr: prefsRecord?.risk_reward_ratio || prefsRecord?.risk_reward || '1:2',
        maxDailyRiskStr: prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss || '3%'
    };
}
export function calculatePositionSize(params) {
    const spec = resolveInstrumentSpec(params.symbol || params.instrument || 'EURUSD');
    const { accountSize, riskPercentage, entryPrice, stopLoss, minLot = spec.minLot, maxLot = spec.maxLot, lotStep = spec.lotStep, contractSize = params.contractSize ?? spec.contractSize, positionMode = 'AUTO_RISK', preferredLotSize, spreadPips = 0, slippagePips = 0, commissionPerLot = 0, direction = 'BUY' } = params;
    if (accountSize <= 0) {
        return {
            accepted: false,
            lots: 0,
            calculatedLotSize: 0,
            riskAmount: 0,
            expectedLoss: 0,
            reason: 'Invalid account size'
        };
    }
    const pipsToPrice = spec.pipSize;
    const spreadInPrice = spreadPips * pipsToPrice;
    const slippageInPrice = slippagePips * pipsToPrice;
    const theoreticalSlDistance = Math.abs(entryPrice - stopLoss);
    const realizedSlDistance = theoreticalSlDistance + (2 * slippageInPrice) + (spreadInPrice / 2);
    if (theoreticalSlDistance <= 0) {
        return {
            accepted: false,
            lots: 0,
            calculatedLotSize: 0,
            riskAmount: 0,
            expectedLoss: 0,
            reason: 'Stop loss is equal to entry price'
        };
    }
    if (positionMode === 'FIXED_LOT' && typeof preferredLotSize === 'number' && preferredLotSize > 0) {
        const finalLots = Math.min(Math.max(preferredLotSize, minLot), maxLot);
        const lossPerLot = realizedSlDistance * contractSize;
        const commissionCost = Math.round((commissionPerLot * finalLots) * 100) / 100;
        const expectedLoss = Math.round((finalLots * lossPerLot + commissionCost) * 100) / 100;
        if (expectedLoss >= accountSize) {
            return {
                accepted: false,
                lots: 0,
                calculatedLotSize: finalLots,
                riskAmount: expectedLoss,
                expectedLoss,
                reason: `Fixed lot order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`
            };
        }
        if (riskPercentage > 0) {
            const riskAmount = (accountSize * riskPercentage) / 100;
            if (expectedLoss > Math.round(riskAmount * 100) / 100) {
                return {
                    accepted: false,
                    lots: 0,
                    calculatedLotSize: finalLots,
                    riskAmount: Math.round(riskAmount * 100) / 100,
                    expectedLoss,
                    reason: `Fixed lot order rejected: A ${finalLots} lot position risks $${expectedLoss.toFixed(2)} (including spreads, slippage, and commission), which exceeds your ${riskPercentage}% risk budget ($${riskAmount.toFixed(2)}).`
                };
            }
        }
        return {
            accepted: true,
            lots: finalLots,
            calculatedLotSize: finalLots,
            entryPrice,
            stopLoss,
            takeProfit: params.takeProfit,
            riskAmount: expectedLoss,
            expectedLoss
        };
    }
    if (riskPercentage <= 0) {
        return {
            accepted: false,
            lots: 0,
            calculatedLotSize: 0,
            riskAmount: 0,
            expectedLoss: 0,
            reason: 'Invalid risk percentage'
        };
    }
    const riskAmount = (accountSize * riskPercentage) / 100;
    const quoteCurrency = spec.quoteCurrency;
    const accountCurrency = params.accountCurrency || 'USD';
    let conversionFactor = 1.0;
    if (params.conversionRate !== undefined && !isNaN(params.conversionRate)) {
        conversionFactor = params.conversionRate;
    }
    else if (quoteCurrency !== accountCurrency) {
        if (spec.symbol.startsWith(accountCurrency) && spec.symbol.endsWith(quoteCurrency)) {
            conversionFactor = 1 / entryPrice;
        }
        else if (spec.symbol.startsWith(quoteCurrency) && spec.symbol.endsWith(accountCurrency)) {
            conversionFactor = 1 / entryPrice;
        }
        else {
            return {
                accepted: false,
                lots: 0,
                calculatedLotSize: 0,
                riskAmount: 0,
                expectedLoss: 0,
                reason: `Unsupported currency conversion: Quote currency "${quoteCurrency}" differs from Account currency "${accountCurrency}". Please provide an explicit conversionRate or use a direct pair.`
            };
        }
    }
    const lossPerLot = realizedSlDistance * contractSize * conversionFactor;
    const rawLots = riskAmount / (lossPerLot + commissionPerLot);
    const steppedLots = Math.floor((rawLots + 1e-9) / lotStep) * lotStep;
    const roundedLots = Math.round(steppedLots * 100) / 100;
    let finalLots = roundedLots;
    if (finalLots < minLot) {
        const commissionCostAtMin = Math.round((minLot * commissionPerLot) * 100) / 100;
        const lossAtMinLot = minLot * lossPerLot + commissionCostAtMin;
        const minLotExpectedLoss = Math.round(lossAtMinLot * 100) / 100;
        const roundedRiskBudget = Math.floor(riskAmount * 100) / 100;
        if (minLotExpectedLoss > roundedRiskBudget + 0.00001) {
            return {
                accepted: false,
                lots: 0,
                calculatedLotSize: minLot,
                riskAmount: roundedRiskBudget,
                expectedLoss: minLotExpectedLoss,
                reason: `Order rejected: On a $${accountSize.toFixed(2)} account, the smallest trade (0.01 lot) risks $${minLotExpectedLoss.toFixed(2)} (including commissions/costs), which exceeds your ${riskPercentage}% budget ($${roundedRiskBudget.toFixed(2)}).`
            };
        }
        if (lossAtMinLot < accountSize) {
            finalLots = minLot;
        }
        else {
            return {
                accepted: false,
                lots: 0,
                calculatedLotSize: minLot,
                riskAmount: Math.round(riskAmount * 100) / 100,
                expectedLoss: minLotExpectedLoss,
                reason: `Insufficient balance: Broker minimum lot (${minLot}) risks $${minLotExpectedLoss.toFixed(2)} but you only have $${accountSize.toFixed(2)} available.`
            };
        }
    }
    finalLots = Math.min(finalLots, maxLot);
    const finalCommissionCost = Math.round((finalLots * commissionPerLot) * 100) / 100;
    const expectedLoss = Math.round((finalLots * lossPerLot + finalCommissionCost) * 100) / 100;
    if (expectedLoss >= accountSize) {
        return {
            accepted: false,
            lots: 0,
            calculatedLotSize: finalLots,
            riskAmount: Math.round(riskAmount * 100) / 100,
            expectedLoss,
            reason: `Order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`
        };
    }
    const roundedRiskBudget = Math.floor(riskAmount * 100) / 100;
    if (expectedLoss > roundedRiskBudget + 0.00001) {
        return {
            accepted: false,
            lots: 0,
            calculatedLotSize: finalLots,
            riskAmount: roundedRiskBudget,
            expectedLoss,
            reason: `Order rejected: Calculated risk ($${expectedLoss.toFixed(2)}) exceeds your strict ${riskPercentage}% budget ($${roundedRiskBudget.toFixed(2)}). Try increasing balance or reducing stop loss distance.`
        };
    }
    let actualRr;
    if (params.takeProfit && theoreticalSlDistance > 0) {
        const tpDistance = Math.abs(params.takeProfit - entryPrice);
        actualRr = Math.round((tpDistance / theoreticalSlDistance) * 100) / 100;
    }
    else if (params.riskRewardStr) {
        actualRr = parseRiskRewardRatio(params.riskRewardStr);
    }
    return {
        accepted: true,
        lots: finalLots,
        calculatedLotSize: finalLots,
        actualRr,
        entryPrice,
        stopLoss,
        takeProfit: params.takeProfit,
        riskAmount: Math.round(riskAmount * 100) / 100,
        expectedLoss
    };
}
