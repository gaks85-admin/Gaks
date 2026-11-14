import { resolveInstrumentSpec } from "./risk-engine.js";
function resolvePersistedAccountType(rawType) {
  if (!rawType) return "personal";
  const clean = String(rawType).toLowerCase().trim();
  if (clean === "prop" || clean === "prop_firm" || clean === "propfirm" || clean === "acct_type:prop" || clean.endsWith(":prop") || clean.endsWith(":prop_firm")) {
    return "prop";
  }
  return "personal";
}
async function getPropFirmSettings(supabaseClient, userId) {
  if (!supabaseClient || !userId) return null;
  try {
    const { data, error } = await supabaseClient.from("prop_firm_settings").select("*").eq("user_id", userId).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}
async function savePropFirmSettings(supabaseClient, userIdOrSettings, maybeSettings) {
  if (!supabaseClient) return { data: null, error: null };
  try {
    let payload = {};
    if (typeof userIdOrSettings === "string") {
      payload = { user_id: userIdOrSettings, ...maybeSettings || {} };
    } else {
      payload = { ...userIdOrSettings || {} };
    }
    if (!payload.user_id) {
      return { data: null, error: new Error("Missing user_id for prop firm settings") };
    }
    if (payload.high_watermark_balance == null || payload.high_watermark_equity == null) {
      try {
        const existing = await getPropFirmSettings(supabaseClient, payload.user_id);
        if (existing) {
          if (payload.high_watermark_balance == null && existing.high_watermark_balance != null) {
            payload.high_watermark_balance = existing.high_watermark_balance;
          }
          if (payload.high_watermark_equity == null && existing.high_watermark_equity != null) {
            payload.high_watermark_equity = existing.high_watermark_equity;
          }
        }
      } catch {
      }
    }
    const query = supabaseClient.from("prop_firm_settings").upsert(payload, { onConflict: "user_id" });
    if (query && typeof query.select === "function") {
      const { data, error } = await query.select().maybeSingle();
      return { data, error };
    }
    const res = await query;
    return { data: res?.data ?? payload, error: res?.error ?? null };
  } catch (err) {
    return { data: null, error: err };
  }
}
async function syncPropFirmHighWatermarks(supabaseClient, userId, balanceOrParams) {
  let bal;
  let eq;
  if (typeof balanceOrParams === "number") {
    bal = balanceOrParams;
    eq = balanceOrParams;
  } else {
    const existingBal = balanceOrParams.existingHwmBalance ?? balanceOrParams.accountSize ?? 0;
    const existingEq = balanceOrParams.existingHwmEquity ?? balanceOrParams.accountSize ?? 0;
    bal = Math.max(existingBal, balanceOrParams.currentBalance ?? 0);
    eq = Math.max(existingEq, balanceOrParams.currentEquity ?? 0);
  }
  if (supabaseClient && userId) {
    try {
      await supabaseClient.from("prop_firm_settings").update({
        high_watermark_balance: bal,
        high_watermark_equity: eq,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("user_id", userId);
    } catch (err) {
      return { error: err, highWatermarkBalance: bal, highWatermarkEquity: eq };
    }
  }
  return { error: null, highWatermarkBalance: bal, highWatermarkEquity: eq };
}
function computePropFirmResetBoundaryUtc(resetTimeOrNow, nowOrTz, _tz) {
  let now = /* @__PURE__ */ new Date();
  let hours = 0;
  let minutes = 0;
  if (resetTimeOrNow instanceof Date) {
    now = resetTimeOrNow;
  } else if (typeof resetTimeOrNow === "string" && resetTimeOrNow.includes(":")) {
    const [h, m] = resetTimeOrNow.split(":").map((n) => parseInt(n, 10));
    if (Number.isFinite(h)) hours = h;
    if (Number.isFinite(m)) minutes = m;
  }
  if (nowOrTz instanceof Date) {
    now = nowOrTz;
  }
  const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes, 0, 0));
  if (boundary.getTime() > now.getTime()) {
    boundary.setUTCDate(boundary.getUTCDate() - 1);
  }
  return boundary;
}
function calculateSingleOpenWatcherRisk(watchers) {
  return (watchers || []).reduce((sum, w) => sum + (Number(w.risk_amount) || 0), 0);
}
function calculateSingleOpenWatcherFloatingPnl(watcher, quote, marketPricesBySymbol = {}) {
  if (!watcher || !quote) return { success: false, pnl: 0, reason: "Missing watcher or quote" };
  const entryPrice = Number(watcher.entry_price);
  const lotSize = Number(watcher.lot_size);
  if (!Number.isFinite(entryPrice) || !Number.isFinite(lotSize) || lotSize <= 0) {
    return { success: false, pnl: 0, reason: "Invalid entryPrice or lotSize" };
  }
  const symbol = String(watcher.selected_pair || watcher.symbol || "EURUSD").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const spec = resolveInstrumentSpec(symbol, entryPrice);
  const contractSize = Number(watcher.contract_size || spec.contractSize || 1e5);
  const isBuy = String(watcher.direction || "BUY").toUpperCase() === "BUY";
  const exitPrice = isBuy ? Number(quote.bid) : Number(quote.ask);
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
    return { success: false, pnl: 0, reason: "Invalid exitPrice" };
  }
  const quotePnl = (exitPrice - entryPrice) * lotSize * (isBuy ? contractSize : -contractSize);
  const quoteCurrency = spec.quoteCurrency || "USD";
  if (quoteCurrency === "USD" || quoteCurrency === "USDT" || quoteCurrency === "USDC" || quoteCurrency === "BUSD") {
    return { success: true, pnl: quotePnl };
  }
  if (symbol.startsWith("USD")) {
    return { success: true, pnl: quotePnl / exitPrice };
  }
  const usdPair = `USD${quoteCurrency}`;
  const quoteUsdPair = `${quoteCurrency}USD`;
  if (marketPricesBySymbol[usdPair] && marketPricesBySymbol[usdPair] > 0) {
    return { success: true, pnl: quotePnl / marketPricesBySymbol[usdPair] };
  }
  if (marketPricesBySymbol[quoteUsdPair] && marketPricesBySymbol[quoteUsdPair] > 0) {
    return { success: true, pnl: quotePnl * marketPricesBySymbol[quoteUsdPair] };
  }
  return { success: false, pnl: 0, reason: `Missing FX conversion rate for ${quoteCurrency} to USD` };
}
async function computeAggregateOpenTradesFloatingPnl(watchers, marketPrices) {
  let totalPnl = 0;
  const pricesMap = marketPrices?.marketPricesBySymbol || {};
  for (const w of watchers || []) {
    if (w.trade_status && w.trade_status !== "ACTIVE") continue;
    const sym = String(w.selected_pair || w.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let price = pricesMap[sym] ?? pricesMap[w.selected_pair];
    if (!price && marketPrices?.priceQuoteLoader) {
      const loaded = await marketPrices.priceQuoteLoader(sym);
      if (loaded && typeof loaded === "number") price = loaded;
      else if (loaded && typeof loaded.price === "number") price = loaded.price;
    }
    if (!price) return { success: false, pnl: 0, reason: `Missing price for open position ${sym}` };
    const res = calculateSingleOpenWatcherFloatingPnl(w, { bid: price, ask: price }, pricesMap);
    if (!res.success) return { success: false, pnl: 0, reason: res.reason };
    totalPnl += res.pnl;
  }
  return { success: true, pnl: totalPnl };
}
export {
  calculateSingleOpenWatcherFloatingPnl,
  calculateSingleOpenWatcherRisk,
  computeAggregateOpenTradesFloatingPnl,
  computePropFirmResetBoundaryUtc,
  getPropFirmSettings,
  resolvePersistedAccountType,
  savePropFirmSettings,
  syncPropFirmHighWatermarks
};
