import { defaultEconomicEventService, EconomicEventService } from './economic-event-service.js';
import {
  getPropFirmSettings,
  resolvePersistedAccountType,
  computePropFirmResetBoundaryUtc,
  calculateSingleOpenWatcherRisk,
  calculateSingleOpenWatcherFloatingPnl,
  computeAggregateOpenTradesFloatingPnl
} from './prop-firm-service.js';
import { evaluatePropFirmRules, PropFirmNewsGateInput } from './prop-firm-engine.js';

export interface WatcherPropFirmGateParams {
  supabase: any;
  userId: string;
  symbol: string;
  rawAccountType: string;
  proposedTradeRisk: number;
  currentMarketPrice?: number;
  propFirmSettings?: any;
  runtimeOverride?: {
    now?: Date;
    settingsLoader?: () => Promise<{ settings: any; error: any }>;
    tradeHistoryLoader?: () => Promise<{ trades: any[]; error: any }>;
    openWatchersLoader?: () => Promise<{ watchers: any[]; error: any }>;
    newsChecker?: (symbol: string) => Promise<any>;
    marketPricesBySymbol?: Record<string, number>;
    priceQuoteLoader?: (symbol: string) => Promise<any>;
  };
}

export interface WatcherPropFirmGateResult {
  passed: boolean;
  allowed?: boolean;
  decision?: any;
  success?: boolean;
  blockReason?: string;
  details?: string;
  evaluated?: boolean;
  accountType?: string;
  firmName?: string;
  accountPhase?: string;
  resetBoundaryUtc?: Date;
  highWatermarkBalance?: number;
  highWatermarkEquity?: number;
  liveFloatingPnl?: number;
}

export type WatcherPropFirmGateOutcome = WatcherPropFirmGateResult;

export async function evaluateWatcherPropFirmGate(
  params: WatcherPropFirmGateParams
): Promise<WatcherPropFirmGateResult> {
  const accountType = resolvePersistedAccountType(params.rawAccountType);

  if (accountType === 'personal') {
    return { passed: true, allowed: true, evaluated: false, accountType: 'personal' };
  }

  const now = params.runtimeOverride?.now ?? new Date();
  let settings = params.propFirmSettings;
  let settingsError: string | null = null;

  if (params.runtimeOverride?.settingsLoader) {
    try {
      const loaded = await params.runtimeOverride.settingsLoader();
      settings = loaded?.settings;
      settingsError = loaded?.error || null;
    } catch (e: any) {
      settingsError = e?.message || 'Failed to load prop firm settings';
    }
  } else if (!settings && params.supabase && params.userId) {
    settings = await getPropFirmSettings(params.supabase, params.userId);
  }

  if (settingsError || !settings) {
    const desc = settingsError || 'Prop firm account type configured but no prop_firm_settings record found.';
    return {
      passed: false,
      allowed: false,
      evaluated: true,
      accountType: 'prop',
      blockReason: 'PROP_FIRM_SETTINGS_UNAVAILABLE',
      details: desc,
      decision: {
        allowed: false,
        reasons: [desc],
        checks: [{ rule: 'CONFIGURATION', status: 'CONFIG_ERROR', actualValue: null, limit: 'Valid PropFirmSettings', reason: desc }]
      }
    };
  }

  // Load realized trade history
  let trades: any[] = [];
  let tradeHistoryError: string | null = null;
  if (params.runtimeOverride?.tradeHistoryLoader) {
    try {
      const historyRes = await params.runtimeOverride.tradeHistoryLoader();
      trades = historyRes?.trades || [];
      tradeHistoryError = historyRes?.error || (historyRes?.trades == null ? 'Missing trades data' : null);
    } catch (e: any) {
      tradeHistoryError = e?.message || 'Trade history load failed';
    }
  } else if (params.supabase && params.userId) {
    try {
      const { data, error } = await params.supabase
        .from('trade_learning')
        .select('trade_id, outcome, net_pnl, opened_at, closed_at')
        .eq('user_id', params.userId);
      if (error) tradeHistoryError = error.message;
      else trades = data || [];
    } catch (e: any) {
      tradeHistoryError = e?.message || 'Trade history query failed';
    }
  }

  if (tradeHistoryError) {
    return {
      passed: false,
      allowed: false,
      evaluated: true,
      accountType: 'prop',
      firmName: settings.firm_name,
      accountPhase: settings.account_phase,
      blockReason: 'PROP_FIRM_TRADE_HISTORY_UNAVAILABLE',
      details: tradeHistoryError,
      decision: {
        allowed: false,
        reasons: [tradeHistoryError],
        checks: [{ rule: 'DAILY_LOSS', status: 'UNAVAILABLE', actualValue: null, limit: settings.daily_loss_limit, reason: tradeHistoryError }]
      }
    };
  }

  // Load open active watchers
  let openWatchers: any[] = [];
  let openWatchersError: string | null = null;
  if (params.runtimeOverride?.openWatchersLoader) {
    try {
      const owRes = await params.runtimeOverride.openWatchersLoader();
      openWatchers = (owRes?.watchers || []).filter((w: any) => !w.trade_status || w.trade_status === 'ACTIVE');
      openWatchersError = owRes?.error || null;
    } catch (e: any) {
      openWatchersError = e?.message || 'Open watchers load failed';
    }
  } else if (params.supabase && params.userId) {
    try {
      const { data, error } = await params.supabase
        .from('watchers')
        .select('*')
        .eq('user_id', params.userId)
        .eq('trade_status', 'ACTIVE');
      if (error) openWatchersError = error.message;
      else openWatchers = data || [];
    } catch (e: any) {
      openWatchersError = e?.message || 'Open watchers query failed';
    }
  }

  if (openWatchersError) {
    return {
      passed: false,
      allowed: false,
      evaluated: true,
      accountType: 'prop',
      blockReason: 'PROP_FIRM_OPEN_WATCHERS_UNAVAILABLE',
      details: openWatchersError,
      decision: {
        allowed: false,
        reasons: [openWatchersError],
        checks: [{ rule: 'DAILY_LOSS', status: 'UNAVAILABLE', actualValue: null, limit: settings.daily_loss_limit, reason: openWatchersError }]
      }
    };
  }

  const resetBoundaryUtc = computePropFirmResetBoundaryUtc(
    settings.daily_reset_time || '00:00',
    now,
    settings.daily_reset_timezone || 'UTC'
  );
  const resetMs = resetBoundaryUtc.getTime();

  // Compute cumulative realized PnL and daily realized PnL since resetBoundaryUtc
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

  // Compute live floating PnL if equity basis is active or open watchers exist
  const needsEquity =
    settings.daily_loss_calculation_basis === 'EQUITY' ||
    settings.drawdown_calculation_basis === 'EQUITY';

  let liveFloatingPnl = 0;
  if (openWatchers.length > 0 && needsEquity) {
    const pricesMap = { ...(params.runtimeOverride?.marketPricesBySymbol || {}) };
    if (params.currentMarketPrice && !pricesMap[params.symbol]) {
      pricesMap[params.symbol] = params.currentMarketPrice;
    }
    const fpRes = await computeAggregateOpenTradesFloatingPnl(openWatchers, {
      marketPricesBySymbol: pricesMap,
      priceQuoteLoader: params.runtimeOverride?.priceQuoteLoader
    });
    if (!fpRes.success) {
      const reason = fpRes.reason || 'Live floating PnL unavailable for EQUITY basis evaluation.';
      return {
        passed: false,
        allowed: false,
        evaluated: true,
        accountType: 'prop',
        firmName: settings.firm_name,
        accountPhase: settings.account_phase,
        resetBoundaryUtc,
        blockReason: 'PROP_FIRM_FLOATING_PNL_UNAVAILABLE',
        details: reason,
        decision: {
          allowed: false,
          reasons: [reason],
          checks: [{ rule: 'DAILY_LOSS', status: 'UNAVAILABLE', actualValue: null, limit: settings.daily_loss_limit, reason }]
        }
      };
    }
    liveFloatingPnl = fpRes.pnl;
  }

  const accountSize = Number(settings.account_size);
  const accountBalance = accountSize + totalRealizedPnl;
  const accountEquity = accountBalance + liveFloatingPnl;
  const hwmBalance =
    settings.high_watermark_balance != null
      ? Math.max(Number(settings.high_watermark_balance), accountBalance)
      : accountBalance;
  const hwmEquity =
    settings.high_watermark_equity != null
      ? Math.max(Number(settings.high_watermark_equity), accountEquity)
      : accountEquity;

  // Check News Restriction for Prop Firm
  let newsGateResult: PropFirmNewsGateInput | null = null;
  if (settings.news_restriction_enabled) {
    const bufferBefore = settings.news_buffer_before_minutes ?? 30;
    const bufferAfter = settings.news_buffer_after_minutes ?? 30;
    try {
      let newsRes: any;
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
        const isBlocked =
          typeof newsRes.tradeBlocked === 'boolean'
            ? newsRes.tradeBlocked
            : newsRes.status === 'BLOCKED';
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
    currentDrawdown: Math.max(0, accountSize - (settings.drawdown_calculation_basis === 'EQUITY' ? accountEquity : accountBalance)),
    highWatermarkBalance: hwmBalance,
    highWatermarkEquity: hwmEquity,
    currentTotalProfit: totalRealizedPnl,
    proposedTradeRisk: params.proposedTradeRisk,
    tradesTakenToday,
    currentTimeUtc: now.toISOString(),
    newsGateResult
  });

  const blockReason = decision.allowed ? undefined : (decision.reasons[0] || 'Blocked by Prop Firm Rule Engine.');

  return {
    passed: decision.allowed,
    allowed: decision.allowed,
    evaluated: true,
    accountType: 'prop',
    firmName: settings.firm_name,
    accountPhase: settings.account_phase,
    resetBoundaryUtc,
    highWatermarkBalance: hwmBalance,
    highWatermarkEquity: hwmEquity,
    liveFloatingPnl,
    decision,
    blockReason,
    details: decision.reasons.join(' | ')
  };
}

export async function syncPropFirmStateForActiveWatcher(params: {
  supabase: any;
  userId: string;
  rawAccountType?: string | null;
  symbol: string;
  currentMarketPrice: number;
}) {
  return { success: true };
}

export {
  resolvePersistedAccountType,
  computePropFirmResetBoundaryUtc,
  calculateSingleOpenWatcherRisk,
  calculateSingleOpenWatcherFloatingPnl,
  computeAggregateOpenTradesFloatingPnl
} from './prop-firm-service.js';

