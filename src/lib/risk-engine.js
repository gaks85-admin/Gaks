const CRYPTO_BASES = /* @__PURE__ */ new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "LTC",
  "ADA",
  "DOGE",
  "BNB",
  "AVAX",
  "DOT",
  "LINK",
  "MATIC",
  "POL",
  "UNI",
  "NEAR",
  "TRX",
  "ATOM",
  "BCH",
  "SHIB",
  "TON",
  "SUI",
  "PEPE",
  "ARB",
  "OP",
  "APT",
  "AAVE",
  "ALGO",
  "FIL",
  "ICP",
  "VET",
  "HBAR",
  "XLM",
  "FTM",
  "SAND",
  "MANA",
  "AXS",
  "CRV",
  "MKR",
  "SNX",
  "COMP",
  "INJ",
  "RUNE",
  "SEI",
  "TIA",
  "WIF",
  "BONK",
  "FLOKI",
  "ETC",
  "XMR",
  "ZEC",
  "DASH",
  "EOS",
  "XTZ",
  "THETA",
  "KAVA",
  "ZIL",
  "ENS",
  "LDO",
  "CRYPTO"
]);
const APPROX_USD_RATES = {
  USD: 1,
  USDT: 1,
  USDC: 1,
  BUSD: 1,
  EUR: 1.08,
  GBP: 1.27,
  AUD: 0.65,
  NZD: 0.6,
  CHF: 1 / 0.88,
  CAD: 1 / 1.38,
  JPY: 1 / 150,
  HKD: 1 / 7.8,
  SGD: 1 / 1.34,
  CNH: 1 / 7.2,
  CNY: 1 / 7.2,
  SEK: 1 / 10.5,
  NOK: 1 / 10.8,
  DKK: 1 / 6.9,
  MXN: 1 / 18,
  ZAR: 1 / 18,
  TRY: 1 / 34,
  PLN: 1 / 4
};
function resolveInstrumentSpec(symbol, priceHint) {
  const cleanSym = (symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cryptoBase = cleanSym.replace(/(USDT|USDC|BUSD|USD|EUR|GBP|JPY|AUD|CAD|CHF)$/, "");
  let assetClass = "Forex";
  let contractSize = 1e5;
  let minLot = 0.01;
  let maxLot = 100;
  let lotStep = 0.01;
  let tickSize = 1e-5;
  let pipSize = 1e-4;
  let quoteCurrency = "USD";
  let source = "Forex Specification Resolver";
  if (CRYPTO_BASES.has(cleanSym) || CRYPTO_BASES.has(cryptoBase) || cleanSym.includes("CRYPTO") || cleanSym.endsWith("USDT") || cleanSym.endsWith("USDC") || cleanSym.endsWith("BUSD")) {
    assetClass = "Crypto";
    contractSize = 1;
    minLot = 0.01;
    maxLot = cryptoBase === "BTC" || cleanSym.startsWith("BTC") ? 100 : 1e4;
    lotStep = 0.01;
    tickSize = priceHint !== void 0 && priceHint > 0 && priceHint < 10 ? 1e-4 : 0.01;
    pipSize = priceHint !== void 0 && priceHint > 0 ? priceHint >= 1e3 ? 1 : priceHint >= 50 ? 0.01 : priceHint >= 1 ? 1e-3 : 1e-4 : 1;
    quoteCurrency = cleanSym.endsWith("USDT") ? "USDT" : cleanSym.endsWith("USDC") ? "USDC" : cleanSym.endsWith("BUSD") ? "BUSD" : cleanSym.length >= 6 && !cleanSym.endsWith("USD") ? cleanSym.substring(cleanSym.length - 3) : "USD";
    source = "Crypto Specification Resolver";
  } else if (cleanSym.includes("XAU") || cleanSym.includes("GOLD") || cleanSym.includes("XAG") || cleanSym.includes("SILVER")) {
    assetClass = "Gold";
    contractSize = 100;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    tickSize = 0.01;
    pipSize = 0.01;
    quoteCurrency = "USD";
    source = "Metals Specification Resolver";
  } else if (cleanSym.includes("NAS") || cleanSym.includes("NDX") || cleanSym.includes("US100") || cleanSym.includes("USTEC") || cleanSym.includes("US30") || cleanSym.includes("DJ30") || cleanSym.includes("WS30") || cleanSym.includes("DOW") || cleanSym.includes("SPX") || cleanSym.includes("SP500") || cleanSym.includes("US500") || cleanSym.includes("US2000") || cleanSym.includes("RUT") || cleanSym.includes("GER") || cleanSym.includes("DE30") || cleanSym.includes("DE40") || cleanSym.includes("DAX") || cleanSym.includes("UK100") || cleanSym.includes("FTSE") || cleanSym.includes("FRA40") || cleanSym.includes("CAC40") || cleanSym.includes("EU50") || cleanSym.includes("STOXX") || cleanSym.includes("JP225") || cleanSym.includes("NIKKEI") || cleanSym.includes("HK50") || cleanSym.includes("HSI") || cleanSym.includes("AUS200") || cleanSym.includes("ASX200") || cleanSym.includes("INDEX")) {
    assetClass = "Indices";
    contractSize = 1;
    minLot = 0.1;
    maxLot = 1e3;
    lotStep = 0.1;
    tickSize = 0.1;
    pipSize = 1;
    if (cleanSym.includes("GER") || cleanSym.includes("DE30") || cleanSym.includes("DE40") || cleanSym.includes("DAX") || cleanSym.includes("FRA40") || cleanSym.includes("CAC40") || cleanSym.includes("EU50") || cleanSym.includes("STOXX")) {
      quoteCurrency = "EUR";
    } else if (cleanSym.includes("UK100") || cleanSym.includes("FTSE")) {
      quoteCurrency = "GBP";
    } else if (cleanSym.includes("JP225") || cleanSym.includes("NIKKEI")) {
      quoteCurrency = "JPY";
    } else if (cleanSym.includes("HK50") || cleanSym.includes("HSI")) {
      quoteCurrency = "HKD";
    } else if (cleanSym.includes("AUS200") || cleanSym.includes("ASX200")) {
      quoteCurrency = "AUD";
    } else {
      quoteCurrency = "USD";
    }
    source = "Indices Specification Resolver";
  } else {
    assetClass = "Forex";
    contractSize = 1e5;
    minLot = 0.01;
    maxLot = 100;
    lotStep = 0.01;
    tickSize = cleanSym.includes("JPY") ? 1e-3 : 1e-5;
    pipSize = cleanSym.includes("JPY") ? 0.01 : 1e-4;
    quoteCurrency = cleanSym.length >= 6 ? cleanSym.substring(cleanSym.length - 3) : "USD";
    source = "Forex Specification Resolver";
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
function getInstrumentContractConfig(symbol) {
  return resolveInstrumentSpec(symbol);
}
function parseRiskRewardRatio(ratioStr) {
  if (!ratioStr) return 2;
  const clean = String(ratioStr).trim();
  const parts = clean.split(":");
  if (parts.length === 2) {
    const num = parseFloat(parts[1]);
    if (!isNaN(num) && num > 0) return num;
  }
  const parsed = parseFloat(clean.replace(/[^0-9.]/g, ""));
  return !isNaN(parsed) && parsed > 0 ? parsed : 2;
}
function getLotTypeLabel(lot) {
  if (lot >= 1) return "Standard Lot";
  if (lot >= 0.1) return "Mini Lot";
  return "Micro Lot";
}
function normalizeCurrency(curr) {
  const c = (curr || "USD").toUpperCase().trim();
  if (c === "USDT" || c === "USDC" || c === "BUSD") return "USD";
  return c;
}
function resolveQuoteToAccountConversionFactor(spec, accountCurrency, entryPrice, explicitConversionRate) {
  if (explicitConversionRate !== void 0 && !isNaN(explicitConversionRate) && explicitConversionRate > 0) {
    return explicitConversionRate;
  }
  const normQuote = normalizeCurrency(spec.quoteCurrency);
  const normAccount = normalizeCurrency(accountCurrency);
  if (normQuote === normAccount) {
    return 1;
  }
  if (spec.symbol.startsWith(normAccount) && spec.symbol.endsWith(normQuote) && entryPrice > 0) {
    return 1 / entryPrice;
  }
  if (spec.symbol.startsWith(normQuote) && spec.symbol.endsWith(normAccount) && entryPrice > 0) {
    return 1 / entryPrice;
  }
  const quoteUsd = APPROX_USD_RATES[normQuote];
  const accountUsd = APPROX_USD_RATES[normAccount];
  if (quoteUsd && accountUsd && accountUsd > 0) {
    return quoteUsd / accountUsd;
  }
  return 1;
}
function getPricePrecision(spec, price) {
  if (spec.assetClass === "Forex") {
    return spec.symbol.includes("JPY") ? 3 : 5;
  }
  if (price >= 1e3) return 2;
  if (price >= 10) return 3;
  return 5;
}
function extractRiskPreferences(prefsRecord, _userId) {
  let accountSize = 1e4;
  if (prefsRecord?.custom_capital) {
    const parsed = parseFloat(String(prefsRecord.custom_capital).replace(/[^0-9.]/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      accountSize = parsed;
    }
  }
  let riskPercentage = 1;
  if (prefsRecord?.preferred_risk) {
    const parsed = parseFloat(String(prefsRecord.preferred_risk).replace(/[^0-9.]/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      riskPercentage = parsed;
    }
  }
  let maxDailyLossAmount = 100;
  const maxLossStr = prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss;
  if (maxLossStr) {
    const parsed = parseFloat(String(maxLossStr).replace(/[^0-9.]/g, ""));
    if (!isNaN(parsed) && parsed > 0) {
      maxDailyLossAmount = parsed;
    }
  }
  const positionMode = prefsRecord?.position_sizing_mode || prefsRecord?.position_mode || "AUTO_RISK";
  const preferredLotSize = prefsRecord?.preferred_lot_size || (prefsRecord?.fixed_lot_size ? parseFloat(prefsRecord.fixed_lot_size) : void 0);
  return {
    accountSize,
    riskPercentage,
    maxDailyLossAmount,
    positionMode,
    preferredLotSize,
    riskRewardStr: prefsRecord?.risk_reward_ratio || prefsRecord?.risk_reward || "1:2",
    maxDailyRiskStr: prefsRecord?.max_daily_risk || prefsRecord?.max_daily_loss || "3%"
  };
}
function calculatePositionSize(params) {
  const spec = resolveInstrumentSpec(params.symbol || params.instrument || "EURUSD");
  const {
    accountSize,
    riskPercentage,
    entryPrice,
    stopLoss,
    minLot = spec.minLot,
    maxLot = spec.maxLot,
    lotStep = spec.lotStep,
    contractSize = params.contractSize ?? spec.contractSize,
    positionMode = "AUTO_RISK",
    preferredLotSize,
    spreadPips = 0,
    slippagePips = 0,
    commissionPerLot = 0,
    direction = "BUY"
  } = params;
  const dir = params.direction ? String(params.direction).toUpperCase() === "SELL" ? "SELL" : "BUY" : stopLoss > entryPrice ? "SELL" : "BUY";
  if (!Number.isFinite(accountSize) || accountSize <= 0) {
    const reason = "Invalid account size";
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      riskAmount: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode,
      exactLotSize: 0,
      stopDistance: 0,
      minLot,
      lotType: getLotTypeLabel(minLot),
      contractSize,
      expectedLossAtRequiredLot: 0,
      expectedLossAtMinLot: 0,
      rrValidationPassed: false,
      reason,
      skipReason: reason
    };
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(stopLoss) || stopLoss <= 0) {
    const reason = "Invalid entry price or stop loss";
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      entryPrice,
      stopLoss,
      riskAmount: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode,
      exactLotSize: 0,
      stopDistance: 0,
      minLot,
      lotType: getLotTypeLabel(minLot),
      contractSize,
      expectedLossAtRequiredLot: 0,
      expectedLossAtMinLot: 0,
      rrValidationPassed: false,
      reason,
      skipReason: reason
    };
  }
  const pipsToPrice = spec.pipSize;
  const spreadInPrice = spreadPips * pipsToPrice;
  const slippageInPrice = slippagePips * pipsToPrice;
  const theoreticalSlDistance = Math.abs(entryPrice - stopLoss);
  const realizedSlDistance = theoreticalSlDistance + 2 * slippageInPrice + spreadInPrice / 2;
  if (theoreticalSlDistance <= 0) {
    const reason = "Stop loss is equal to entry price";
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      entryPrice,
      stopLoss,
      riskAmount: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode,
      exactLotSize: 0,
      stopDistance: 0,
      minLot,
      lotType: getLotTypeLabel(minLot),
      contractSize,
      expectedLossAtRequiredLot: 0,
      expectedLossAtMinLot: 0,
      rrValidationPassed: false,
      reason,
      skipReason: reason
    };
  }
  const explicitTpRaw = params.takeProfit !== void 0 && params.takeProfit !== null && Number.isFinite(Number(params.takeProfit)) && Number(params.takeProfit) > 0 ? Number(params.takeProfit) : params.geminiTp !== void 0 && params.geminiTp !== null && Number.isFinite(Number(params.geminiTp)) && Number(params.geminiTp) > 0 ? Number(params.geminiTp) : void 0;
  const targetRr = parseRiskRewardRatio(params.riskRewardStr);
  const priceDecimals = getPricePrecision(spec, entryPrice);
  const resolvedTp = explicitTpRaw !== void 0 ? explicitTpRaw : Number(
    (dir === "BUY" ? entryPrice + theoreticalSlDistance * targetRr : entryPrice - theoreticalSlDistance * targetRr).toFixed(priceDecimals)
  );
  const geometryValid = dir === "BUY" ? stopLoss < entryPrice && resolvedTp > entryPrice : stopLoss > entryPrice && resolvedTp < entryPrice;
  if (!geometryValid) {
    const reason = dir === "BUY" ? `Invalid BUY geometry: requires SL (${stopLoss}) < Entry (${entryPrice}) < TP (${resolvedTp}).` : `Invalid SELL geometry: requires TP (${resolvedTp}) < Entry (${entryPrice}) < SL (${stopLoss}).`;
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      actualRr: 0,
      rrValidationPassed: false,
      entryPrice,
      stopLoss,
      takeProfit: resolvedTp,
      riskAmount: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode,
      exactLotSize: 0,
      stopDistance: theoreticalSlDistance,
      minLot,
      lotType: getLotTypeLabel(minLot),
      contractSize,
      expectedLossAtRequiredLot: 0,
      expectedLossAtMinLot: 0,
      reason,
      skipReason: reason
    };
  }
  const tpDistance = Math.abs(resolvedTp - entryPrice);
  const actualRr = theoreticalSlDistance > 0 ? Math.round(tpDistance / theoreticalSlDistance * 100) / 100 : 0;
  if (explicitTpRaw !== void 0 && actualRr < targetRr - 0.05) {
    const reason = `R:R validation failed: Take Profit yields ${actualRr}:1, below required minimum 1:${targetRr}.`;
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      actualRr,
      rrValidationPassed: false,
      entryPrice,
      stopLoss,
      takeProfit: resolvedTp,
      riskAmount: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode,
      exactLotSize: 0,
      stopDistance: theoreticalSlDistance,
      minLot,
      lotType: getLotTypeLabel(minLot),
      contractSize,
      expectedLossAtRequiredLot: 0,
      expectedLossAtMinLot: 0,
      reason,
      skipReason: reason
    };
  }
  const accountCurrency = params.accountCurrency || "USD";
  const conversionFactor = resolveQuoteToAccountConversionFactor(spec, accountCurrency, entryPrice, params.conversionRate);
  const lossPerLot = realizedSlDistance * contractSize * conversionFactor;
  const expectedLossAtMinLot = Math.round((minLot * lossPerLot + minLot * commissionPerLot) * 100) / 100;
  if (positionMode === "FIXED_LOT") {
    if (typeof preferredLotSize !== "number" || !Number.isFinite(preferredLotSize) || preferredLotSize <= 0) {
      const reason = "Fixed lot mode enabled but no valid preferred lot size provided.";
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: 0,
        actualRr,
        rrValidationPassed: true,
        entryPrice,
        stopLoss,
        takeProfit: resolvedTp,
        riskAmount: 0,
        expectedLoss: 0,
        expectedProfit: 0,
        executableLotDisplay: "NONE",
        positionMode: "FIXED_LOT",
        exactLotSize: 0,
        stopDistance: theoreticalSlDistance,
        minLot,
        lotType: getLotTypeLabel(minLot),
        contractSize,
        expectedLossAtRequiredLot: 0,
        expectedLossAtMinLot,
        reason,
        skipReason: reason
      };
    }
    if (preferredLotSize < minLot - 1e-9) {
      const reason = `Fixed lot (${preferredLotSize}) is below broker minimum lot (${minLot}).`;
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: 0,
        actualRr,
        rrValidationPassed: true,
        entryPrice,
        stopLoss,
        takeProfit: resolvedTp,
        riskAmount: 0,
        expectedLoss: 0,
        expectedProfit: 0,
        executableLotDisplay: "NONE",
        positionMode: "FIXED_LOT",
        exactLotSize: preferredLotSize,
        stopDistance: theoreticalSlDistance,
        minLot,
        lotType: getLotTypeLabel(minLot),
        contractSize,
        expectedLossAtRequiredLot: Math.round((preferredLotSize * lossPerLot + preferredLotSize * commissionPerLot) * 100) / 100,
        expectedLossAtMinLot,
        reason,
        skipReason: reason
      };
    }
    const finalLots2 = Math.min(preferredLotSize, maxLot);
    const commissionCost = Math.round(commissionPerLot * finalLots2 * 100) / 100;
    const expectedLoss2 = Math.round((finalLots2 * lossPerLot + commissionCost) * 100) / 100;
    const expectedProfit2 = Math.round(finalLots2 * tpDistance * contractSize * conversionFactor * 100) / 100;
    if (expectedLoss2 >= accountSize) {
      const reason = `Fixed lot order rejected: Expected loss ($${expectedLoss2.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`;
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: 0,
        actualRr,
        rrValidationPassed: true,
        entryPrice,
        stopLoss,
        takeProfit: resolvedTp,
        riskAmount: expectedLoss2,
        expectedLoss: expectedLoss2,
        expectedProfit: 0,
        executableLotDisplay: "NONE",
        positionMode: "FIXED_LOT",
        exactLotSize: preferredLotSize,
        stopDistance: theoreticalSlDistance,
        minLot,
        lotType: getLotTypeLabel(minLot),
        contractSize,
        expectedLossAtRequiredLot: expectedLoss2,
        expectedLossAtMinLot,
        reason,
        skipReason: reason
      };
    }
    if (riskPercentage > 0) {
      const riskBudget = accountSize * riskPercentage / 100;
      if (expectedLoss2 > Math.round(riskBudget * 100) / 100) {
        const reason = `Fixed lot order rejected: A ${finalLots2} lot position risks $${expectedLoss2.toFixed(2)} (including spreads, slippage, and commission), which exceeds your ${riskPercentage}% risk budget ($${riskBudget.toFixed(2)}).`;
        return {
          accepted: false,
          lots: 0,
          calculatedLotSize: 0,
          actualRr,
          rrValidationPassed: true,
          entryPrice,
          stopLoss,
          takeProfit: resolvedTp,
          riskAmount: Math.round(riskBudget * 100) / 100,
          expectedLoss: expectedLoss2,
          expectedProfit: 0,
          executableLotDisplay: "NONE",
          positionMode: "FIXED_LOT",
          exactLotSize: preferredLotSize,
          stopDistance: theoreticalSlDistance,
          minLot,
          lotType: getLotTypeLabel(minLot),
          contractSize,
          expectedLossAtRequiredLot: expectedLoss2,
          expectedLossAtMinLot,
          reason,
          skipReason: reason
        };
      }
    }
    return {
      accepted: true,
      lots: finalLots2,
      calculatedLotSize: finalLots2,
      actualRr,
      rrValidationPassed: true,
      entryPrice,
      stopLoss,
      takeProfit: resolvedTp,
      riskAmount: expectedLoss2,
      expectedLoss: expectedLoss2,
      expectedProfit: expectedProfit2,
      executableLotDisplay: finalLots2.toFixed(2),
      positionMode: "FIXED_LOT",
      exactLotSize: finalLots2,
      stopDistance: theoreticalSlDistance,
      minLot,
      lotType: getLotTypeLabel(finalLots2),
      contractSize,
      expectedLossAtRequiredLot: expectedLoss2,
      expectedLossAtMinLot
    };
  }
  if (!Number.isFinite(riskPercentage) || riskPercentage <= 0) {
    const reason = "Invalid risk percentage";
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      entryPrice,
      stopLoss,
      takeProfit: resolvedTp,
      riskAmount: 0,
      expectedLoss: 0,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode: "AUTO_RISK",
      exactLotSize: 0,
      stopDistance: theoreticalSlDistance,
      minLot,
      lotType: getLotTypeLabel(minLot),
      contractSize,
      expectedLossAtRequiredLot: 0,
      expectedLossAtMinLot,
      rrValidationPassed: true,
      reason,
      skipReason: reason
    };
  }
  const riskAmount = accountSize * riskPercentage / 100;
  const rawLots = riskAmount / (lossPerLot + commissionPerLot);
  const exactLotSize = Math.round(rawLots * 1e4) / 1e4;
  const expectedLossAtRequiredLot = Math.round((rawLots * lossPerLot + rawLots * commissionPerLot) * 100) / 100;
  const steppedLots = Math.floor((rawLots + 1e-9) / lotStep) * lotStep;
  const roundedLots = Math.round(steppedLots * 100) / 100;
  let finalLots = roundedLots;
  if (finalLots < minLot) {
    const roundedRiskBudget2 = Math.floor(riskAmount * 100) / 100;
    if (expectedLossAtMinLot > roundedRiskBudget2 + 1e-5) {
      const reason = `Order rejected: On a $${accountSize.toFixed(2)} account, the smallest trade (${minLot} lot) risks $${expectedLossAtMinLot.toFixed(2)} (including commissions/costs), which exceeds your ${riskPercentage}% budget ($${roundedRiskBudget2.toFixed(2)}).`;
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: 0,
        actualRr,
        rrValidationPassed: true,
        entryPrice,
        stopLoss,
        takeProfit: resolvedTp,
        riskAmount: roundedRiskBudget2,
        expectedLoss: expectedLossAtMinLot,
        expectedProfit: 0,
        executableLotDisplay: "NONE",
        positionMode: "AUTO_RISK",
        exactLotSize,
        stopDistance: theoreticalSlDistance,
        minLot,
        lotType: getLotTypeLabel(minLot),
        contractSize,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        reason,
        skipReason: reason
      };
    }
    if (expectedLossAtMinLot < accountSize) {
      finalLots = minLot;
    } else {
      const reason = `Insufficient balance: Broker minimum lot (${minLot}) risks $${expectedLossAtMinLot.toFixed(2)} but you only have $${accountSize.toFixed(2)} available.`;
      return {
        accepted: false,
        lots: 0,
        calculatedLotSize: 0,
        actualRr,
        rrValidationPassed: true,
        entryPrice,
        stopLoss,
        takeProfit: resolvedTp,
        riskAmount: Math.round(riskAmount * 100) / 100,
        expectedLoss: expectedLossAtMinLot,
        expectedProfit: 0,
        executableLotDisplay: "NONE",
        positionMode: "AUTO_RISK",
        exactLotSize,
        stopDistance: theoreticalSlDistance,
        minLot,
        lotType: getLotTypeLabel(minLot),
        contractSize,
        expectedLossAtRequiredLot,
        expectedLossAtMinLot,
        reason,
        skipReason: reason
      };
    }
  }
  finalLots = Math.min(finalLots, maxLot);
  const finalCommissionCost = Math.round(finalLots * commissionPerLot * 100) / 100;
  const expectedLoss = Math.round((finalLots * lossPerLot + finalCommissionCost) * 100) / 100;
  const expectedProfit = Math.round(finalLots * tpDistance * contractSize * conversionFactor * 100) / 100;
  if (expectedLoss >= accountSize) {
    const reason = `Order rejected: Expected loss ($${expectedLoss.toFixed(2)}) exceeds available account balance ($${accountSize.toFixed(2)}).`;
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      actualRr,
      rrValidationPassed: true,
      entryPrice,
      stopLoss,
      takeProfit: resolvedTp,
      riskAmount: Math.round(riskAmount * 100) / 100,
      expectedLoss,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode: "AUTO_RISK",
      exactLotSize,
      stopDistance: theoreticalSlDistance,
      minLot,
      lotType: getLotTypeLabel(finalLots),
      contractSize,
      expectedLossAtRequiredLot,
      expectedLossAtMinLot,
      reason,
      skipReason: reason
    };
  }
  const roundedRiskBudget = Math.floor(riskAmount * 100) / 100;
  if (expectedLoss > roundedRiskBudget + 1e-5) {
    const reason = `Order rejected: Calculated risk ($${expectedLoss.toFixed(2)}) exceeds your strict ${riskPercentage}% budget ($${roundedRiskBudget.toFixed(2)}). Try increasing balance or reducing stop loss distance.`;
    return {
      accepted: false,
      lots: 0,
      calculatedLotSize: 0,
      actualRr,
      rrValidationPassed: true,
      entryPrice,
      stopLoss,
      takeProfit: resolvedTp,
      riskAmount: roundedRiskBudget,
      expectedLoss,
      expectedProfit: 0,
      executableLotDisplay: "NONE",
      positionMode: "AUTO_RISK",
      exactLotSize,
      stopDistance: theoreticalSlDistance,
      minLot,
      lotType: getLotTypeLabel(finalLots),
      contractSize,
      expectedLossAtRequiredLot,
      expectedLossAtMinLot,
      reason,
      skipReason: reason
    };
  }
  return {
    accepted: true,
    lots: finalLots,
    calculatedLotSize: finalLots,
    actualRr,
    rrValidationPassed: true,
    entryPrice,
    stopLoss,
    takeProfit: resolvedTp,
    riskAmount: Math.round(riskAmount * 100) / 100,
    expectedLoss,
    expectedProfit,
    executableLotDisplay: finalLots.toFixed(2),
    positionMode: "AUTO_RISK",
    exactLotSize,
    stopDistance: theoreticalSlDistance,
    minLot,
    lotType: getLotTypeLabel(finalLots),
    contractSize,
    expectedLossAtRequiredLot,
    expectedLossAtMinLot
  };
}
export {
  calculatePositionSize,
  extractRiskPreferences,
  getInstrumentContractConfig,
  parseRiskRewardRatio,
  resolveInstrumentSpec
};
