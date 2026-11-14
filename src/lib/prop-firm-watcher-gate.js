import { EconomicEventService } from "./economic-event-service.js";
import {
  getPropFirmSettings,
  resolvePersistedAccountType,
  computePropFirmResetBoundaryUtc,
  computeAggregateOpenTradesFloatingPnl
} from "./prop-firm-service.js";
import { evaluatePropFirmRules } from "./prop-firm-engine.js";
async function evaluateWatcherPropFirmGate(params) {
  const accountType = resolvePersistedAccountType(params.rawAccountType);
  if (accountType === "personal") {
    return { passed: true, allowed: true, evaluated: false, accountType: "personal" };
  }
  const now = params.runtimeOverride?.now ?? /* @__PURE__ */ new Date();
  let settings = params.propFirmSettings;
  let settingsError = null;
  if (params.runtimeOverride?.settingsLoader) {
    try {
      const loaded = await params.runtimeOverride.settingsLoader();
      settings = loaded?.settings;
      settingsError = loaded?.error || null;
    } catch (e) {
      settingsError = e?.message || "Failed to load prop firm settings";
    }
  } else if (!settings && params.supabase && params.userId) {
    settings = await getPropFirmSettings(params.supabase, params.userId);
  }
  if (settingsError || !settings) {
    const desc = settingsError || "Prop firm account type configured but no prop_firm_settings record found.";
    return {
      passed: false,
      allowed: false,
      evaluated: true,
      accountType: "prop",
      blockReason: "PROP_FIRM_SETTINGS_UNAVAILABLE",
      details: desc,
      decision: {
        allowed: false,
        reasons: [desc],
        checks: [{ rule: "CONFIGURATION", status: "CONFIG_ERROR", actualValue: null, limit: "Valid PropFirmSettings", reason: desc }]
      }
    };
  }
  let trades = [];
  let tradeHistoryError = null;
  if (params.runtimeOverride?.tradeHistoryLoader) {
    try {
      const historyRes = await params.runtimeOverride.tradeHistoryLoader();
      trades = historyRes?.trades || [];
      tradeHistoryError = historyRes?.error || (historyRes?.trades == null ? "Missing trades data" : null);
    } catch (e) {
      tradeHistoryError = e?.message || "Trade history load failed";
    }
  } else if (params.supabase && params.userId) {
    try {
      const { data, error } = await params.supabase.from("trade_learning").select("trade_id, outcome, net_pnl, opened_at, closed_at").eq("user_id", params.userId);
      if (error) tradeHistoryError = error.message;
      else trades = data || [];
    } catch (e) {
      tradeHistoryError = e?.message || "Trade history query failed";
    }
  }
  if (tradeHistoryError) {
    return {
      passed: false,
      allowed: false,
      evaluated: true,
      accountType: "prop",
      firmName: settings.firm_name,
      accountPhase: settings.account_phase,
      blockReason: "PROP_FIRM_TRADE_HISTORY_UNAVAILABLE",
      details: tradeHistoryError,
      decision: {
        allowed: false,
        reasons: [tradeHistoryError],
        checks: [{ rule: "DAILY_LOSS", status: "UNAVAILABLE", actualValue: null, limit: settings.daily_loss_limit, reason: tradeHistoryError }]
      }
    };
  }
  let openWatchers = [];
  let openWatchersError = null;
  if (params.runtimeOverride?.openWatchersLoader) {
    try {
      const owRes = await params.runtimeOverride.openWatchersLoader();
      openWatchers = (owRes?.watchers || []).filter((w) => !w.trade_status || w.trade_status === "ACTIVE");
      openWatchersError = owRes?.error || null;
    } catch (e) {
      openWatchersError = e?.message || "Open watchers load failed";
    }
  } else if (params.supabase && params.userId) {
    try {
      const { data, error } = await params.supabase.from("watchers").select("*").eq("user_id", params.userId).eq("trade_status", "ACTIVE");
      if (error) openWatchersError = error.message;
      else openWatchers = data || [];
    } catch (e) {
      openWatchersError = e?.message || "Open watchers query failed";
    }
  }
  if (openWatchersError) {
    return {
      passed: false,
      allowed: false,
      evaluated: true,
      accountType: "prop",
      blockReason: "PROP_FIRM_OPEN_WATCHERS_UNAVAILABLE",
      details: openWatchersError,
      decision: {
        allowed: false,
        reasons: [openWatchersError],
        checks: [{ rule: "DAILY_LOSS", status: "UNAVAILABLE", actualValue: null, limit: settings.daily_loss_limit, reason: openWatchersError }]
      }
    };
  }
  const resetBoundaryUtc = computePropFirmResetBoundaryUtc(
    settings.daily_reset_time || "00:00",
    now,
    settings.daily_reset_timezone || "UTC"
  );
  const resetMs = resetBoundaryUtc.getTime();
  let totalRealizedPnl = 0;
  let dailyRealizedPnl = 0;
  let dailyClosedTradesOpenedToday = 0;
  for (const t of trades) {
    const netPnl = Number(t.net_pnl);
    if (Number.isFinite(netPnl)) {
      totalRealizedPnl += netPnl;
    }
    const closedTime = t.closed_at ? new Date(t.closed_at).getTime() : NaN;
    if (Number.isFinite(closedTime) && closedTime >= resetMs) {
      if (Number.isFinite(netPnl)) {
        dailyRealizedPnl += netPnl;
      }
    }
    const openedOrClosed = t.opened_at ? new Date(t.opened_at).getTime() : closedTime;
    if (Number.isFinite(openedOrClosed) && openedOrClosed >= resetMs) {
      dailyClosedTradesOpenedToday++;
    }
  }
  let activeTradesOpenedToday = 0;
  for (const w of openWatchers) {
    const openedTime = w.opened_at ? new Date(w.opened_at).getTime() : NaN;
    if (Number.isFinite(openedTime) && openedTime >= resetMs) {
      activeTradesOpenedToday++;
    }
  }
  const tradesTakenToday = dailyClosedTradesOpenedToday + activeTradesOpenedToday;
  const needsEquity = settings.daily_loss_calculation_basis === "EQUITY" || settings.drawdown_calculation_basis === "EQUITY";
  let liveFloatingPnl = 0;
  if (openWatchers.length > 0 && needsEquity) {
    const pricesMap = { ...params.runtimeOverride?.marketPricesBySymbol || {} };
    if (params.currentMarketPrice && !pricesMap[params.symbol]) {
      pricesMap[params.symbol] = params.currentMarketPrice;
    }
    const fpRes = await computeAggregateOpenTradesFloatingPnl(openWatchers, {
      marketPricesBySymbol: pricesMap,
      priceQuoteLoader: params.runtimeOverride?.priceQuoteLoader
    });
    if (!fpRes.success) {
      const reason = fpRes.reason || "Live floating PnL unavailable for EQUITY basis evaluation.";
      return {
        passed: false,
        allowed: false,
        evaluated: true,
        accountType: "prop",
        firmName: settings.firm_name,
        accountPhase: settings.account_phase,
        resetBoundaryUtc,
        blockReason: "PROP_FIRM_FLOATING_PNL_UNAVAILABLE",
        details: reason,
        decision: {
          allowed: false,
          reasons: [reason],
          checks: [{ rule: "DAILY_LOSS", status: "UNAVAILABLE", actualValue: null, limit: settings.daily_loss_limit, reason }]
        }
      };
    }
    liveFloatingPnl = fpRes.pnl;
  }
  const accountSize = Number(settings.account_size);
  const accountBalance = accountSize + totalRealizedPnl;
  const accountEquity = accountBalance + liveFloatingPnl;
  const hwmBalance = settings.high_watermark_balance != null ? Math.max(Number(settings.high_watermark_balance), accountBalance) : accountBalance;
  const hwmEquity = settings.high_watermark_equity != null ? Math.max(Number(settings.high_watermark_equity), accountEquity) : accountEquity;
  let newsGateResult = null;
  if (settings.news_restriction_enabled) {
    const bufferBefore = settings.news_buffer_before_minutes ?? 30;
    const bufferAfter = settings.news_buffer_after_minutes ?? 30;
    try {
      let newsRes;
      if (params.runtimeOverride?.newsChecker) {
        newsRes = await params.runtimeOverride.newsChecker(params.symbol);
      } else {
        const newsService = new EconomicEventService(params.supabase);
        newsRes = await newsService.checkNewsHardPause(
          params.symbol,
          bufferBefore,
          bufferAfter,
          now
        );
      }
      if (newsRes) {
        const isBlocked = typeof newsRes.tradeBlocked === "boolean" ? newsRes.tradeBlocked : newsRes.status === "BLOCKED";
        newsGateResult = {
          blocked: isBlocked,
          reason: newsRes.blockReason || newsRes.reason,
          bufferBeforeMinutes: bufferBefore,
          bufferAfterMinutes: bufferAfter
        };
      }
    } catch {
      newsGateResult = null;
    }
  }
  const decision = evaluatePropFirmRules({
    settings,
    accountBalance,
    accountEquity,
    startingAccountSize: accountSize,
    currentDailyPnl: dailyRealizedPnl,
    currentDrawdown: Math.max(0, accountSize - (settings.drawdown_calculation_basis === "EQUITY" ? accountEquity : accountBalance)),
    highWatermarkBalance: hwmBalance,
    highWatermarkEquity: hwmEquity,
    currentTotalProfit: totalRealizedPnl,
    proposedTradeRisk: params.proposedTradeRisk,
    tradesTakenToday,
    currentTimeUtc: now.toISOString(),
    newsGateResult
  });
  const blockReason = decision.allowed ? void 0 : decision.reasons[0] || "Blocked by Prop Firm Rule Engine.";
  return {
    passed: decision.allowed,
    allowed: decision.allowed,
    evaluated: true,
    accountType: "prop",
    firmName: settings.firm_name,
    accountPhase: settings.account_phase,
    resetBoundaryUtc,
    highWatermarkBalance: hwmBalance,
    highWatermarkEquity: hwmEquity,
    liveFloatingPnl,
    decision,
    blockReason,
    details: decision.reasons.join(" | ")
  };
}
async function syncPropFirmStateForActiveWatcher(params) {
  return { success: true };
}
import {
  resolvePersistedAccountType as resolvePersistedAccountType2,
  computePropFirmResetBoundaryUtc as computePropFirmResetBoundaryUtc2,
  calculateSingleOpenWatcherRisk as calculateSingleOpenWatcherRisk2,
  calculateSingleOpenWatcherFloatingPnl as calculateSingleOpenWatcherFloatingPnl2,
  computeAggregateOpenTradesFloatingPnl as computeAggregateOpenTradesFloatingPnl2
} from "./prop-firm-service.js";
export {
  calculateSingleOpenWatcherFloatingPnl2 as calculateSingleOpenWatcherFloatingPnl,
  calculateSingleOpenWatcherRisk2 as calculateSingleOpenWatcherRisk,
  computeAggregateOpenTradesFloatingPnl2 as computeAggregateOpenTradesFloatingPnl,
  computePropFirmResetBoundaryUtc2 as computePropFirmResetBoundaryUtc,
  evaluateWatcherPropFirmGate,
  resolvePersistedAccountType2 as resolvePersistedAccountType,
  syncPropFirmStateForActiveWatcher
};
