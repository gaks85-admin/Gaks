import {
  PropFirmSettings,
  syncPropFirmHighWatermarks
} from './prop-firm-service.js';
import {
  evaluatePropFirmRules,
  adaptNewsCheckToPropFirmGate,
  PropFirmDecision,
  PropFirmRuleInput,
  PropFirmNewsGateInput
} from './prop-firm-engine.js';
import { EconomicEventService, EconomicEventResult } from './economic-event-service.js';
import { getInstrumentContractConfig } from './risk-engine.js';
import { defaultMarketDataService } from './market-data-service.js';

export type PersistedAccountType = 'personal' | 'prop' | null;

export interface TwoSidedMarketQuote {
  bid: number;
  ask: number;
}

export interface WatcherPropFirmRuntimeOverride {
  settingsLoader?: (userId: string) => Promise<{ settings: PropFirmSettings | null; error: string | null }>;
  tradeHistoryLoader?: (userId: string) => Promise<{ trades: any[] | null; error: string | null }>;
  openWatchersLoader?: (userId: string) => Promise<{ watchers: any[] | null; error: string | null }>;
  newsChecker?: (symbol: string, bufferBeforeMinutes: number, bufferAfterMinutes: number) => Promise<EconomicEventResult | null>;
  priceQuoteLoader?: (symbol: string) => Promise<number | null>;
  marketPricesBySymbol?: Record<string, number>;
  marketQuotesBySymbol?: Record<string, TwoSidedMarketQuote>;
  liveFloatingPnl?: number | null;
  highWatermarkBalance?: number | null;
  highWatermarkEquity?: number | null;
  now?: Date;
}

export interface WatcherPropFirmGateParams {
  supabase: any;
  userId: string;
  symbol: string;
  rawAccountType?: string | null;
  proposedTradeRisk: number;
  currentMarketPrice?: number | null;
  currentMarketQuote?: TwoSidedMarketQuote | null;
  runtimeOverride?: WatcherPropFirmRuntimeOverride;
}

export interface WatcherPropFirmGateOutcome {
  evaluated: boolean;
  accountType: PersistedAccountType;
  allowed: boolean;
  blockReason: string | null;
  decision: PropFirmDecision | null;
  firmName?: string | null;
  accountPhase?: string | null;
  resetBoundaryUtc?: string;
  highWatermarkBalance?: number | null;
  highWatermarkEquity?: number | null;
  liveFloatingPnl?: number | null;
}

export interface OpenTradeFloatingPnlEvaluation {
  available: boolean;
  totalFloatingPnl: number;
  openTradesCount: number;
  evaluatedTradesCount: number;
  unavailableReasons: string[];
}

function canonicalizeSymbol(sym?: string | null): string {
  if (!sym || typeof sym !== 'string') return '';
  return sym.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isPositiveFinite(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0;
}

/**
 * Calculates live mark-to-market unrealized P/L (in account currency USD) for a single open watcher trade.
 *
 * Pricing semantics:
 * - When a two-sided quote (`{ bid, ask }`) is provided, BUY positions exit at `bid` and SELL positions exit at `ask`.
 * - When only a single scalar quote is available (e.g. Twelve Data `/price` endpoint), that price is used.
 *
 * Position sizing semantics:
 * 1. Explicit executable lot size (`lot_size` / `lotSize` / `last_signal_data.lotSize`) + instrument contract spec takes precedence.
 * 2. Explicit monetary loss at stop (`expected_loss` / `expectedLoss` / `last_signal_data.expectedLoss`) + `stop_loss` distance.
 *    Unrelated account-level risk budgets (`risk_amount`) are NEVER used to infer position size.
 *
 * Fails closed (`{ success: false }`) if symbol/contract config is invalid or any required pricing/sizing field is missing.
 */
export function calculateSingleOpenWatcherFloatingPnl(
  watcher: any,
  currentMarketPriceOrQuote: number | TwoSidedMarketQuote,
  options?: {
    crossQuotePrice?: number | null;
    quoteToUsdRate?: number | null;
    marketPricesBySymbol?: Record<string, number>;
  }
): { success: boolean; pnl: number; reason?: string } {
  const symbol = String(watcher?.selected_pair || watcher?.pair || watcher?.symbol || '').trim();
  if (!symbol) {
    return { success: false, pnl: 0, reason: `Watcher ${watcher?.id || 'unknown'} is missing symbol.` };
  }

  const rawDir = String(watcher?.direction ?? watcher?.side ?? watcher?.last_signal_data?.direction ?? '')
    .trim()
    .toUpperCase();
  const isBuy = rawDir === 'BUY' || rawDir === 'LONG';
  const isSell = rawDir === 'SELL' || rawDir === 'SHORT';
  if (!isBuy && !isSell) {
    return { success: false, pnl: 0, reason: `Open trade on ${symbol} has invalid direction '${rawDir}'.` };
  }

  let exitMarketPrice = NaN;
  if (
    currentMarketPriceOrQuote &&
    typeof currentMarketPriceOrQuote === 'object' &&
    'bid' in currentMarketPriceOrQuote &&
    'ask' in currentMarketPriceOrQuote
  ) {
    exitMarketPrice = isBuy ? Number(currentMarketPriceOrQuote.bid) : Number(currentMarketPriceOrQuote.ask);
  } else {
    exitMarketPrice = Number(currentMarketPriceOrQuote);
  }

  if (!isPositiveFinite(exitMarketPrice)) {
    return { success: false, pnl: 0, reason: `Live market price unavailable for open trade on ${symbol}.` };
  }

  const entryPrice = Number(watcher?.entry_price ?? watcher?.entryPrice ?? watcher?.last_signal_data?.entryPrice);
  if (!isPositiveFinite(entryPrice)) {
    return { success: false, pnl: 0, reason: `Open trade on ${symbol} is missing valid entry_price.` };
  }

  // Validate instrument contract configuration before any calculation
  const baseConfig = getInstrumentContractConfig(symbol, exitMarketPrice);
  if (!baseConfig.isValid || !isPositiveFinite(baseConfig.contractSize)) {
    return {
      success: false,
      pnl: 0,
      reason: `Unsupported or invalid instrument contract configuration for symbol '${symbol}'.`
    };
  }

  const hasExplicitContractSize =
    (watcher?.contract_size !== undefined && watcher?.contract_size !== null) ||
    (watcher?.contractSize !== undefined && watcher?.contractSize !== null) ||
    (watcher?.last_signal_data?.contractSize !== undefined && watcher?.last_signal_data?.contractSize !== null);

  const explicitContractSize = Number(
    watcher?.contract_size ?? watcher?.contractSize ?? watcher?.last_signal_data?.contractSize
  );
  if (hasExplicitContractSize && !isPositiveFinite(explicitContractSize)) {
    return {
      success: false,
      pnl: 0,
      reason: `Invalid explicit contract_size '${explicitContractSize}' on open trade for ${symbol}.`
    };
  }

  const contractSize = hasExplicitContractSize ? explicitContractSize : baseConfig.contractSize;
  const priceDelta = isBuy ? exitMarketPrice - entryPrice : entryPrice - exitMarketPrice;

  // Check whether lot_size is explicitly present on the watcher
  const rawLotCandidate =
    watcher?.lot_size ??
    watcher?.lotSize ??
    watcher?.quantity ??
    watcher?.position_size ??
    watcher?.last_signal_data?.lotSize ??
    watcher?.last_signal_data?.lot_size;

  const hasLotField = rawLotCandidate !== undefined && rawLotCandidate !== null && String(rawLotCandidate).trim() !== '';
  const rawLotSize = Number(rawLotCandidate);

  if (hasLotField && !isPositiveFinite(rawLotSize)) {
    return {
      success: false,
      pnl: 0,
      reason: `Invalid non-positive lot_size '${rawLotCandidate}' on open trade for ${symbol}.`
    };
  }

  // Resolve cross-currency conversion leg if needed
  let crossQuotePrice: number | undefined = isPositiveFinite(options?.crossQuotePrice)
    ? Number(options!.crossQuotePrice)
    : undefined;

  if (!crossQuotePrice && baseConfig.conversionPair && options?.marketPricesBySymbol) {
    for (const [k, v] of Object.entries(options.marketPricesBySymbol)) {
      if (canonicalizeSymbol(k) === baseConfig.conversionPair && isPositiveFinite(Number(v))) {
        crossQuotePrice = Number(v);
        break;
      }
    }
  }

  const config = getInstrumentContractConfig(symbol, exitMarketPrice, crossQuotePrice);
  const explicitQuoteToUsdRate = Number(
    options?.quoteToUsdRate ??
      watcher?.quote_to_usd_rate ??
      watcher?.quoteToUsdRate ??
      watcher?.last_signal_data?.quoteToUsdRate
  );

  // Method 1: Authoritative executable lot size + instrument contract specification
  if (isPositiveFinite(rawLotSize)) {
    const rawQuotePnl = priceDelta * rawLotSize * contractSize;
    let usdPnl = NaN;

    if (config.conversionMode === 'USD_QUOTE') {
      usdPnl = rawQuotePnl;
    } else if (config.conversionMode === 'USD_BASE') {
      usdPnl = rawQuotePnl / exitMarketPrice;
    } else {
      // CROSS conversion: requires verified Leg 2 quoteToUsdRate or explicit rate
      const rate = isPositiveFinite(explicitQuoteToUsdRate) ? explicitQuoteToUsdRate : config.quoteToUsdRate;
      if (isPositiveFinite(rate)) {
        usdPnl = rawQuotePnl * rate;
      }
    }

    if (Number.isFinite(usdPnl)) {
      return { success: true, pnl: Number(usdPnl.toFixed(4)) };
    }

    // If CROSS pair has no Leg 2 conversion rate and no fallback expected_loss, fail closed
    const hasExpectedLossFallback = isPositiveFinite(
      Number(
        watcher?.expected_loss ??
          watcher?.expectedLoss ??
          watcher?.last_signal_data?.expectedLoss ??
          watcher?.last_signal_data?.expected_loss
      )
    );
    if (!hasExpectedLossFallback) {
      return {
        success: false,
        pnl: 0,
        reason: `Open trade on cross instrument ${symbol} is missing authoritative USD conversion quote (${config.conversionPair || 'quote-to-USD'}).`
      };
    }
  }

  // Method 2: Authoritative trade-specific expected_loss at stop_loss (NEVER unrelated account risk_amount)
  const rawExpectedLoss = Number(
    watcher?.expected_loss ??
      watcher?.expectedLoss ??
      watcher?.last_signal_data?.expectedLoss ??
      watcher?.last_signal_data?.expected_loss
  );
  const stopLoss = Number(watcher?.stop_loss ?? watcher?.stopLoss ?? watcher?.last_signal_data?.stopLoss);

  if (isPositiveFinite(rawExpectedLoss) && isPositiveFinite(stopLoss)) {
    const stopDistance = Math.abs(entryPrice - stopLoss);
    if (stopDistance > 0) {
      const rMultiple = priceDelta / stopDistance;
      let usdPnl = rMultiple * rawExpectedLoss;
      if (config.conversionMode === 'USD_BASE') {
        usdPnl = usdPnl * (entryPrice / exitMarketPrice);
      }
      if (Number.isFinite(usdPnl)) {
        return { success: true, pnl: Number(usdPnl.toFixed(4)) };
      }
    }
  }

  return {
    success: false,
    pnl: 0,
    reason: `Open trade on ${symbol} (watcher ${watcher?.id || 'unknown'}) lacks authoritative position size (lot_size or expected_loss/stop_loss).`
  };
}

/**
 * Computes aggregate live floating unrealized P/L across all open ACTIVE watchers for a user.
 * Fails closed (`available: false`) if any open trade lacks a valid live price or position sizing metadata.
 */
export async function computeAggregateOpenTradesFloatingPnl(
  openWatchers: any[],
  options?: {
    currentScanSymbol?: string;
    currentScanPrice?: number | null;
    currentScanQuote?: TwoSidedMarketQuote | null;
    marketPricesBySymbol?: Record<string, number>;
    marketQuotesBySymbol?: Record<string, TwoSidedMarketQuote>;
    priceQuoteLoader?: (symbol: string) => Promise<number | null>;
  }
): Promise<OpenTradeFloatingPnlEvaluation> {
  if (!Array.isArray(openWatchers) || openWatchers.length === 0) {
    return {
      available: true,
      totalFloatingPnl: 0,
      openTradesCount: 0,
      evaluatedTradesCount: 0,
      unavailableReasons: []
    };
  }

  const priceMap = new Map<string, number>();
  if (options?.marketPricesBySymbol) {
    for (const [sym, price] of Object.entries(options.marketPricesBySymbol)) {
      const canon = canonicalizeSymbol(sym);
      if (canon && isPositiveFinite(Number(price))) {
        priceMap.set(canon, Number(price));
      }
    }
  }

  const quoteMap = new Map<string, TwoSidedMarketQuote>();
  if (options?.marketQuotesBySymbol) {
    for (const [sym, q] of Object.entries(options.marketQuotesBySymbol)) {
      const canon = canonicalizeSymbol(sym);
      if (canon && q && isPositiveFinite(Number(q.bid)) && isPositiveFinite(Number(q.ask))) {
        quoteMap.set(canon, { bid: Number(q.bid), ask: Number(q.ask) });
      }
    }
  }

  if (options?.currentScanSymbol) {
    const scanCanon = canonicalizeSymbol(options.currentScanSymbol);
    if (scanCanon) {
      if (
        options.currentScanQuote &&
        isPositiveFinite(options.currentScanQuote.bid) &&
        isPositiveFinite(options.currentScanQuote.ask) &&
        !quoteMap.has(scanCanon)
      ) {
        quoteMap.set(scanCanon, options.currentScanQuote);
      }
      if (isPositiveFinite(options?.currentScanPrice) && !priceMap.has(scanCanon)) {
        priceMap.set(scanCanon, Number(options.currentScanPrice));
      }
    }
  }

  const resolveSymbolPrice = async (rawSym: string): Promise<number | null> => {
    const canon = canonicalizeSymbol(rawSym);
    if (!canon) return null;
    if (priceMap.has(canon)) return priceMap.get(canon)!;
    try {
      const fetched = options?.priceQuoteLoader
        ? await options.priceQuoteLoader(rawSym)
        : await defaultMarketDataService.fetchCurrentPrice(rawSym);
      if (isPositiveFinite(fetched)) {
        priceMap.set(canon, fetched);
        return fetched;
      }
    } catch {
      // Price fetch failed -> return null
    }
    return null;
  };

  let totalFloatingPnl = 0;
  let evaluatedTradesCount = 0;
  const unavailableReasons: string[] = [];

  for (const w of openWatchers) {
    const rawSym = String(w?.selected_pair || w?.pair || w?.symbol || '').trim();
    const canonSym = canonicalizeSymbol(rawSym);

    if (!canonSym) {
      unavailableReasons.push(`Open trade watcher ${w?.id || 'unknown'} is missing symbol.`);
      continue;
    }

    const twoSidedQuote = quoteMap.get(canonSym) || null;
    let livePrice: number | null = null;
    if (!twoSidedQuote) {
      livePrice = await resolveSymbolPrice(rawSym);
      if (!isPositiveFinite(livePrice)) {
        unavailableReasons.push(`Live market price unavailable for open trade on ${rawSym}.`);
        continue;
      }
    }

    // If instrument is a CROSS pair, resolve the Leg 2 USD conversion pair price when needed
    const prelimConfig = getInstrumentContractConfig(rawSym, livePrice ?? twoSidedQuote?.bid ?? 1);
    let crossQuotePrice: number | null = null;
    if (prelimConfig.isValid && prelimConfig.conversionMode === 'CROSS' && prelimConfig.conversionPair) {
      crossQuotePrice = await resolveSymbolPrice(prelimConfig.conversionPair);
    }

    const singleEval = calculateSingleOpenWatcherFloatingPnl(
      w,
      twoSidedQuote ?? livePrice!,
      {
        crossQuotePrice,
        marketPricesBySymbol: Object.fromEntries(priceMap.entries())
      }
    );
    if (!singleEval.success) {
      unavailableReasons.push(singleEval.reason || `Failed to compute floating P/L for ${rawSym}.`);
      continue;
    }

    totalFloatingPnl += singleEval.pnl;
    evaluatedTradesCount++;
  }

  const available = unavailableReasons.length === 0 && evaluatedTradesCount === openWatchers.length;
  return {
    available,
    totalFloatingPnl: available ? Number(totalFloatingPnl.toFixed(4)) : 0,
    openTradesCount: openWatchers.length,
    evaluatedTradesCount,
    unavailableReasons
  };
}

/**
 * Deterministically resolves the user's persisted account type from `trading_preferences.account_type`.
 * Supports encoded `ACCT_TYPE:personal` / `ACCT_TYPE:prop` tags as well as direct string values.
 * Returns null if missing, unconfigured, or invalid.
 */
export function resolvePersistedAccountType(rawAccountType?: string | null): PersistedAccountType {
  if (!rawAccountType || typeof rawAccountType !== 'string') {
    return null;
  }
  const trimmed = rawAccountType.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Explicit ACCT_TYPE key tag (e.g. "EXECUTION:HYBRID|ACCT_TYPE:prop")
  const acctMatch = trimmed.match(/ACCT_TYPE:([^|]+)/i);
  if (acctMatch) {
    const val = acctMatch[1].trim().toLowerCase();
    if (val === 'personal' || val === 'personal account') return 'personal';
    if (val === 'prop' || val === 'prop_firm' || val === 'prop firm' || val === 'prop firm account') return 'prop';
    return null;
  }

  // 2. Pipe-delimited token format (e.g. "prop|MODE:AUTO_RISK|LOT:0.01|MAXLOSS:1|ANALYSIS:HYBRID")
  const firstToken = trimmed.split('|')[0].trim().toLowerCase();
  if (firstToken === 'personal' || firstToken === 'personal account') return 'personal';
  if (firstToken === 'prop' || firstToken === 'prop_firm' || firstToken === 'prop firm' || firstToken === 'prop firm account') return 'prop';

  // 3. Direct string matching
  const lower = trimmed.toLowerCase();
  if (lower === 'personal' || lower === 'personal account') return 'personal';
  if (lower === 'prop' || lower === 'prop_firm' || lower === 'prop firm' || lower === 'prop firm account') return 'prop';

  return null;
}

function getWallClockPartsInTimeZone(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = Number(p.value);
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second
  };
}

function wallClockInTimeZoneToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  // First pass offset estimation
  const firstParts = getWallClockPartsInTimeZone(new Date(targetAsUtcMs), timeZone);
  const firstObservedMs = Date.UTC(
    firstParts.year,
    firstParts.month - 1,
    firstParts.day,
    firstParts.hour,
    firstParts.minute,
    firstParts.second,
    0
  );
  const firstOffsetMs = firstObservedMs - targetAsUtcMs;
  const candidateUtcMs = targetAsUtcMs - firstOffsetMs;

  // Second pass refinement across DST transitions
  const secondParts = getWallClockPartsInTimeZone(new Date(candidateUtcMs), timeZone);
  const secondObservedMs = Date.UTC(
    secondParts.year,
    secondParts.month - 1,
    secondParts.day,
    secondParts.hour,
    secondParts.minute,
    secondParts.second,
    0
  );
  const secondOffsetMs = secondObservedMs - candidateUtcMs;
  return new Date(targetAsUtcMs - secondOffsetMs);
}

/**
 * Computes the most recent prop-firm daily reset timestamp (in UTC) at or before `now`,
 * respecting both `daily_reset_time` and `daily_reset_timezone` (defaults to 00:00 UTC).
 */
export function computePropFirmResetBoundaryUtc(
  resetTime?: string | null,
  now: Date = new Date(),
  resetTimezone?: string | null
): Date {
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (resetTime && typeof resetTime === 'string') {
    const parts = resetTime.trim().split(':');
    if (parts.length >= 2) {
      const parsedH = Number(parts[0]);
      const parsedM = Number(parts[1]);
      const parsedS = parts.length >= 3 ? Number(parts[2]) : 0;
      if (
        Number.isInteger(parsedH) && parsedH >= 0 && parsedH <= 23 &&
        Number.isInteger(parsedM) && parsedM >= 0 && parsedM <= 59 &&
        Number.isInteger(parsedS) && parsedS >= 0 && parsedS <= 59
      ) {
        hours = parsedH;
        minutes = parsedM;
        seconds = parsedS;
      }
    }
  }

  const tz = typeof resetTimezone === 'string' && resetTimezone.trim() ? resetTimezone.trim() : 'UTC';
  if (tz.toUpperCase() !== 'UTC' && tz.toUpperCase() !== 'GMT' && tz.toUpperCase() !== 'ETC/UTC') {
    try {
      const nowParts = getWallClockPartsInTimeZone(now, tz);
      let boundary = wallClockInTimeZoneToUtcDate(
        nowParts.year,
        nowParts.month,
        nowParts.day,
        hours,
        minutes,
        seconds,
        tz
      );
      if (boundary.getTime() > now.getTime()) {
        const prevDayRef = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - 1, 12, 0, 0));
        boundary = wallClockInTimeZoneToUtcDate(
          prevDayRef.getUTCFullYear(),
          prevDayRef.getUTCMonth() + 1,
          prevDayRef.getUTCDate(),
          hours,
          minutes,
          seconds,
          tz
        );
      }
      return boundary;
    } catch {
      // Fallback to UTC if timezone identifier is invalid
    }
  }

  const boundary = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hours,
    minutes,
    seconds,
    0
  ));

  if (boundary.getTime() > now.getTime()) {
    boundary.setUTCDate(boundary.getUTCDate() - 1);
  }

  return boundary;
}

const COMPLETED_TRADE_OUTCOMES = new Set([
  'WIN',
  'LOSS',
  'BREAKEVEN',
  'BROKER_REALIZED_WIN',
  'BROKER_REALIZED_LOSS',
  'BROKER_REALIZED_BREAKEVEN'
]);

/**
 * Extracts realized monetary P/L for a completed trade record from `trade_learning`.
 */
function extractCompletedTradeRealizedPnl(trade: any, fallbackRiskUnit: number): number {
  const directPnl = Number(trade?.net_pnl ?? trade?.gross_pnl ?? trade?.actual_pnl);
  if (Number.isFinite(directPnl)) {
    return directPnl;
  }

  const rVal = Number(trade?.realized_r ?? trade?.rr_achieved ?? trade?.pnl_r);
  if (Number.isFinite(rVal) && fallbackRiskUnit > 0) {
    return rVal * fallbackRiskUnit;
  }

  const outcome = String(trade?.outcome || '').toUpperCase();
  if ((outcome === 'LOSS' || outcome === 'BROKER_REALIZED_LOSS') && fallbackRiskUnit > 0) {
    return -fallbackRiskUnit;
  }
  if (outcome === 'BREAKEVEN' || outcome === 'BROKER_REALIZED_BREAKEVEN') {
    return 0;
  }

  return 0;
}

/**
 * Resolves the authoritative execution (opening) timestamp in ms for a completed trade row.
 */
function resolveCompletedTradeExecutionMs(trade: any, closedTs: number): number {
  if (trade?.opened_at) {
    const parsedOpen = new Date(trade.opened_at).getTime();
    if (Number.isFinite(parsedOpen) && parsedOpen > 0) {
      return parsedOpen;
    }
  }
  const durationMin = Number(trade?.trade_duration_minutes);
  if (Number.isFinite(durationMin) && durationMin >= 0 && closedTs > 0) {
    return closedTs - durationMin * 60_000;
  }
  const fallbackTs = new Date(trade?.created_at || trade?.closed_at || 0).getTime();
  return Number.isFinite(fallbackTs) ? fallbackTs : 0;
}

/**
 * Loads `PropFirmSettings` directly from `public.prop_firm_settings` using the server Supabase client.
 */
async function defaultLoadPropFirmSettings(
  supabase: any,
  userId: string
): Promise<{ settings: PropFirmSettings | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('prop_firm_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return { settings: null, error: error.message || 'Database error loading prop_firm_settings' };
    }
    return { settings: (data as PropFirmSettings) || null, error: null };
  } catch (err: any) {
    return { settings: null, error: err?.message || 'Unexpected exception loading prop_firm_settings' };
  }
}

/**
 * Evaluates the Prop Firm authorization gate for a candidate watcher signal.
 *
 * - Personal accounts (`account_type === 'personal'`) bypass PropFirmRuleEngine completely.
 * - Unconfigured/invalid `account_type` fails closed.
 * - Prop Firm accounts (`account_type === 'prop'`) load `PropFirmSettings`, construct a real
 *   `PropFirmRuleInput` from runtime trade/account state, and run `evaluatePropFirmRules()`.
 */
export async function evaluateWatcherPropFirmGate(
  params: WatcherPropFirmGateParams
): Promise<WatcherPropFirmGateOutcome> {
  const {
    supabase,
    userId,
    symbol,
    rawAccountType,
    proposedTradeRisk,
    currentMarketPrice,
    currentMarketQuote,
    runtimeOverride
  } = params;
  const accountType = resolvePersistedAccountType(rawAccountType);

  // STEP 2: Account Type Detection
  if (accountType === 'personal') {
    return {
      evaluated: false,
      accountType: 'personal',
      allowed: true,
      blockReason: null,
      decision: null
    };
  }

  if (accountType === null) {
    console.log('[PropFirmGate] BLOCKED: Account type is not configured.');
    return {
      evaluated: true,
      accountType: null,
      allowed: false,
      blockReason: 'Account type is not configured.',
      decision: null
    };
  }

  // STEP 3: Load Prop Firm Settings Safely (account_type === 'prop')
  const settingsRes = runtimeOverride?.settingsLoader
    ? await runtimeOverride.settingsLoader(userId)
    : await defaultLoadPropFirmSettings(supabase, userId);

  if (settingsRes.error) {
    console.log('[PropFirmGate] BLOCKED: Failed to load prop firm settings.');
    const dbErrReason = 'Failed to load prop firm settings.';
    return {
      evaluated: true,
      accountType: 'prop',
      allowed: false,
      blockReason: dbErrReason,
      decision: {
        allowed: false,
        reasons: [dbErrReason],
        checks: [
          {
            rule: 'CONFIGURATION',
            status: 'CONFIG_ERROR',
            actualValue: 'DB_ERROR',
            limit: 'Valid PropFirmSettings',
            reason: dbErrReason
          }
        ]
      }
    };
  }

  const settings = settingsRes.settings;
  if (!settings) {
    console.log('[PropFirmGate] BLOCKED: No prop firm settings found for user.');
    const missingDecision = evaluatePropFirmRules({
      settings: null,
      accountBalance: 0,
      accountEquity: 0,
      startingAccountSize: 0,
      currentDailyPnl: 0,
      currentDrawdown: 0,
      proposedTradeRisk,
      tradesTakenToday: 0
    });
    return {
      evaluated: true,
      accountType: 'prop',
      allowed: false,
      blockReason: 'No prop firm settings found for user.',
      decision: missingDecision
    };
  }

  console.log(
    `[PropFirmGate] Evaluating prop firm rules for user ${userId} (${settings.firm_name} / ${settings.account_phase})`
  );

  // STEP 4: Build Real PropFirmRuleInput
  const now = runtimeOverride?.now || new Date();
  const startingAccountSize = Number(settings.account_size);
  const resetTime = settings.daily_reset_time ?? (settings as any).reset_time_utc ?? '00:00';
  const resetTimezone = settings.daily_reset_timezone ?? 'UTC';
  const resetBoundary = computePropFirmResetBoundaryUtc(resetTime, now, resetTimezone);
  const resetBoundaryMs = resetBoundary.getTime();
  const resetBoundaryIso = resetBoundary.toISOString();

  const fallbackRiskUnit =
    settings.risk_per_trade_type === 'PERCENTAGE'
      ? startingAccountSize * (Number(settings.risk_per_trade) / 100)
      : Number(settings.risk_per_trade);

  // 4A. Load realized trade history from `trade_learning` (authoritative completed executed trades)
  let tradeHistoryQueryFailed = false;
  let completedTrades: any[] = [];
  if (runtimeOverride?.tradeHistoryLoader) {
    const res = await runtimeOverride.tradeHistoryLoader(userId);
    if (res.error || !Array.isArray(res.trades)) {
      tradeHistoryQueryFailed = true;
    } else {
      completedTrades = res.trades;
    }
  } else {
    try {
      const { data, error } = await supabase
        .from('trade_learning')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) {
        tradeHistoryQueryFailed = true;
      } else {
        completedTrades = Array.isArray(data) ? data : [];
      }
    } catch {
      tradeHistoryQueryFailed = true;
    }
  }

  let cumulativeRealizedPnl = 0;
  let realizedPnlBeforeReset = 0;
  let currentDailyPnl = 0;
  let completedTradesTodayCount = 0;
  let runningBalance = isPositiveFinite(startingAccountSize) ? startingAccountSize : 0;
  let historicalPeakBalance = runningBalance;
  const completedTradeIds = new Set<string>();

  if (!tradeHistoryQueryFailed) {
    for (const t of completedTrades) {
      const outcome = String(t?.outcome || '').toUpperCase().trim();
      const hasExplicitPnl = Number.isFinite(Number(t?.net_pnl ?? t?.gross_pnl ?? t?.actual_pnl));
      const isCompletedOutcome = COMPLETED_TRADE_OUTCOMES.has(outcome) || hasExplicitPnl;
      if (!isCompletedOutcome || t?.is_active) {
        continue;
      }

      if (t?.trade_id) {
        completedTradeIds.add(String(t.trade_id).trim());
      }

      const pnl = extractCompletedTradeRealizedPnl(t, fallbackRiskUnit);
      cumulativeRealizedPnl += pnl;
      runningBalance += pnl;
      if (runningBalance > historicalPeakBalance) {
        historicalPeakBalance = runningBalance;
      }

      const closedTs = new Date(t?.closed_at || t?.created_at || 0).getTime();
      const executionTs = resolveCompletedTradeExecutionMs(t, closedTs);

      if (closedTs >= resetBoundaryMs) {
        currentDailyPnl += pnl;
      } else {
        realizedPnlBeforeReset += pnl;
      }

      if (executionTs >= resetBoundaryMs) {
        completedTradesTodayCount++;
      }
    }
  }

  const dailyStartBalance = startingAccountSize + realizedPnlBeforeReset;
  const accountBalance = startingAccountSize + cumulativeRealizedPnl;
  const currentTotalProfit = cumulativeRealizedPnl;
  const currentDrawdown = Math.max(0, startingAccountSize - accountBalance);

  // 4B. Load open executed trades from `watchers` (`trade_status = 'ACTIVE'`)
  // Note: `watcher_evaluations.trade_sent` is intentionally NOT used because `trade_sent` tracks
  // Telegram alert delivery rather than broker execution. Only actual executed trades in
  // `trade_learning` (completed) and `watchers` (`trade_status = 'ACTIVE'`) are counted.
  let openTradesQueryFailed = false;
  let activeWatchersList: any[] = [];
  let openTradesCount = 0;
  let activeOpenedTodayCount = 0;

  if (runtimeOverride?.openWatchersLoader) {
    const res = await runtimeOverride.openWatchersLoader(userId);
    if (res.error || !Array.isArray(res.watchers)) {
      openTradesQueryFailed = true;
    } else {
      activeWatchersList = res.watchers.filter(
        w => String(w?.trade_status || '').toUpperCase().trim() === 'ACTIVE'
      );
      openTradesCount = activeWatchersList.length;
      activeOpenedTodayCount = activeWatchersList.filter(w => {
        const activeId = w?.active_trade_id ? String(w.active_trade_id).trim() : '';
        if (activeId && completedTradeIds.has(activeId)) {
          return false;
        }
        const ts = w?.opened_at ? new Date(w.opened_at).getTime() : 0;
        return ts >= resetBoundaryMs;
      }).length;
    }
  } else {
    try {
      const { data, error } = await supabase
        .from('watchers')
        .select('*')
        .eq('user_id', userId);

      if (error) {
        openTradesQueryFailed = true;
      } else {
        const list = Array.isArray(data) ? data : [];
        activeWatchersList = list.filter(
          w => String(w?.trade_status || '').toUpperCase().trim() === 'ACTIVE'
        );
        openTradesCount = activeWatchersList.length;
        activeOpenedTodayCount = activeWatchersList.filter(w => {
          const activeId = w?.active_trade_id ? String(w.active_trade_id).trim() : '';
          if (activeId && completedTradeIds.has(activeId)) {
            return false;
          }
          const ts = w?.opened_at ? new Date(w.opened_at).getTime() : 0;
          return ts >= resetBoundaryMs;
        }).length;
      }
    } catch {
      openTradesQueryFailed = true;
    }
  }

  const tradesTodayQueryFailed = tradeHistoryQueryFailed || openTradesQueryFailed;
  const tradesTakenToday = tradesTodayQueryFailed
    ? 0
    : completedTradesTodayCount + activeOpenedTodayCount;

  // 4C. Resolve live floating unrealized P/L across open trades and determine EQUITY availability
  const hasExplicitOverrideFloatingPnl =
    runtimeOverride !== undefined && 'liveFloatingPnl' in runtimeOverride;

  let resolvedFloatingPnl = 0;
  let floatingPnlAvailable = false;
  let floatingPnlFailureReasons: string[] = [];

  if (hasExplicitOverrideFloatingPnl) {
    if (
      runtimeOverride?.liveFloatingPnl !== null &&
      runtimeOverride?.liveFloatingPnl !== undefined &&
      Number.isFinite(Number(runtimeOverride.liveFloatingPnl))
    ) {
      resolvedFloatingPnl = Number(runtimeOverride.liveFloatingPnl);
      floatingPnlAvailable = true;
    } else if (openTradesCount === 0 && !openTradesQueryFailed) {
      resolvedFloatingPnl = 0;
      floatingPnlAvailable = true;
    } else {
      floatingPnlAvailable = false;
      floatingPnlFailureReasons = ['Live floating unrealized P/L was explicitly provided as null/unavailable while open trade(s) exist.'];
    }
  } else if (!openTradesQueryFailed) {
    if (openTradesCount === 0) {
      resolvedFloatingPnl = 0;
      floatingPnlAvailable = true;
    } else {
      const floatingEval = await computeAggregateOpenTradesFloatingPnl(activeWatchersList, {
        currentScanSymbol: symbol,
        currentScanPrice: currentMarketPrice,
        currentScanQuote: currentMarketQuote,
        marketPricesBySymbol: runtimeOverride?.marketPricesBySymbol,
        marketQuotesBySymbol: runtimeOverride?.marketQuotesBySymbol,
        priceQuoteLoader: runtimeOverride?.priceQuoteLoader
      });
      resolvedFloatingPnl = floatingEval.totalFloatingPnl;
      floatingPnlAvailable = floatingEval.available;
      floatingPnlFailureReasons = floatingEval.unavailableReasons;
    }
  }

  const equityAvailable =
    !tradeHistoryQueryFailed &&
    !openTradesQueryFailed &&
    floatingPnlAvailable;

  const accountEquity = equityAvailable
    ? Number((accountBalance + resolvedFloatingPnl).toFixed(4))
    : accountBalance;

  const dailyStartEquity = dailyStartBalance;

  // 4D. Resolve and Persist Authoritative Monotonic High-Water Marks (Phase 4A)
  const hasExistingPersistedHwmBalance = isPositiveFinite(settings.high_watermark_balance);
  const hasExistingPersistedHwmEquity = isPositiveFinite(settings.high_watermark_equity);

  const hwmSync = await syncPropFirmHighWatermarks(supabase, userId, {
    accountSize: startingAccountSize,
    currentBalance: !tradeHistoryQueryFailed ? accountBalance : startingAccountSize,
    currentEquity: equityAvailable ? accountEquity : null,
    historicalPeakBalance: !tradeHistoryQueryFailed ? historicalPeakBalance : null,
    existingHwmBalance: settings.high_watermark_balance,
    existingHwmEquity: settings.high_watermark_equity
  });

  let resolvedHwmBalance: number | null = null;
  if (runtimeOverride && 'highWatermarkBalance' in runtimeOverride) {
    if (isPositiveFinite(runtimeOverride.highWatermarkBalance)) {
      resolvedHwmBalance = !tradeHistoryQueryFailed
        ? Math.max(runtimeOverride.highWatermarkBalance, hwmSync.highWatermarkBalance)
        : runtimeOverride.highWatermarkBalance;
    } else {
      resolvedHwmBalance = null;
    }
  } else if (!tradeHistoryQueryFailed && (hasExistingPersistedHwmBalance || hwmSync.persisted)) {
    resolvedHwmBalance = hwmSync.highWatermarkBalance;
  }

  let resolvedHwmEquity: number | null = null;
  if (runtimeOverride && 'highWatermarkEquity' in runtimeOverride) {
    if (isPositiveFinite(runtimeOverride.highWatermarkEquity)) {
      resolvedHwmEquity = equityAvailable
        ? Math.max(runtimeOverride.highWatermarkEquity, hwmSync.highWatermarkEquity)
        : null;
    } else {
      resolvedHwmEquity = null;
    }
  } else if (equityAvailable && (hasExistingPersistedHwmEquity || hwmSync.persisted)) {
    resolvedHwmEquity = hwmSync.highWatermarkEquity;
  }

  // 4E. Resolve News Gate Input when news_restriction_enabled is true
  let newsGateResult: PropFirmNewsGateInput | null = null;
  if (settings.news_restriction_enabled) {
    const bufferBefore = Number(settings.news_buffer_before_minutes ?? 15);
    const bufferAfter = Number(settings.news_buffer_after_minutes ?? 15);
    try {
      let rawNewsResult: EconomicEventResult | null = null;
      if (runtimeOverride?.newsChecker) {
        rawNewsResult = await runtimeOverride.newsChecker(symbol, bufferBefore, bufferAfter);
      } else {
        const propNewsService = new EconomicEventService(undefined, supabase);
        propNewsService.setWindows(bufferBefore, bufferAfter);
        rawNewsResult = await propNewsService.checkNewsHardPause(symbol);
      }
      newsGateResult = adaptNewsCheckToPropFirmGate(rawNewsResult, settings);
    } catch {
      newsGateResult = null; // Fail closed -> engine will mark NEWS_RESTRICTION as UNAVAILABLE
    }
  }

  const ruleInput: PropFirmRuleInput = {
    settings,
    accountBalance,
    accountEquity,
    startingAccountSize,
    currentDailyPnl,
    currentDrawdown,
    dailyStartBalance,
    dailyStartEquity,
    highWatermarkBalance: resolvedHwmBalance,
    highWatermarkEquity: resolvedHwmEquity,
    currentTotalProfit,
    proposedTradeRisk,
    tradesTakenToday,
    currentTimeUtc: now.toISOString(),
    newsGateResult
  };

  const decision = evaluatePropFirmRules(ruleInput);

  // Apply fail-closed overrides if runtime state queries failed or if EQUITY basis lacks floating P/L on open trades
  if (tradeHistoryQueryFailed) {
    const histFailReason = 'Failed to query realized trade history from database (fail closed).';
    for (const check of decision.checks) {
      if (check.rule === 'DAILY_LOSS' || check.rule === 'MAX_DRAWDOWN') {
        check.status = 'UNAVAILABLE';
        check.actualValue = null;
        check.reason = histFailReason;
      }
    }
    if (!decision.reasons.includes(histFailReason)) {
      decision.reasons.push(histFailReason);
    }
    decision.allowed = false;
  }

  if (!equityAvailable) {
    const detailSuffix =
      floatingPnlFailureReasons.length > 0 ? ` (${floatingPnlFailureReasons.join('; ')})` : '';

    if (settings.daily_loss_calculation_basis === 'EQUITY') {
      const eqDailyReason = openTradesQueryFailed
        ? 'Failed to verify open trade state for EQUITY daily loss basis (fail closed).'
        : `EQUITY daily loss basis selected while ${openTradesCount} open trade(s) exist, and live floating unrealized P/L is unavailable${detailSuffix} (fail closed).`;
      for (const check of decision.checks) {
        if (check.rule === 'DAILY_LOSS') {
          check.status = 'UNAVAILABLE';
          check.actualValue = null;
          check.reason = eqDailyReason;
        }
      }
      if (!decision.reasons.includes(eqDailyReason)) {
        decision.reasons.push(eqDailyReason);
      }
      decision.allowed = false;
    }

    if (settings.drawdown_calculation_basis === 'EQUITY') {
      const eqDdReason = openTradesQueryFailed
        ? 'Failed to verify open trade state for EQUITY drawdown basis (fail closed).'
        : `EQUITY drawdown basis selected while ${openTradesCount} open trade(s) exist, and live floating unrealized P/L is unavailable${detailSuffix} (fail closed).`;
      for (const check of decision.checks) {
        if (check.rule === 'MAX_DRAWDOWN') {
          check.status = 'UNAVAILABLE';
          check.actualValue = null;
          check.reason = eqDdReason;
        }
      }
      if (!decision.reasons.includes(eqDdReason)) {
        decision.reasons.push(eqDdReason);
      }
      decision.allowed = false;
    }
  }

  if (
    tradesTodayQueryFailed &&
    settings.maximum_trades_per_day !== null &&
    settings.maximum_trades_per_day !== undefined
  ) {
    const tradesFailReason = 'Failed to verify trades taken today while maximum_trades_per_day is configured (fail closed).';
    for (const check of decision.checks) {
      if (check.rule === 'MAX_TRADES_PER_DAY') {
        check.status = 'UNAVAILABLE';
        check.actualValue = null;
        check.reason = tradesFailReason;
      }
    }
    if (!decision.reasons.includes(tradesFailReason)) {
      decision.reasons.push(tradesFailReason);
    }
    decision.allowed = false;
  }

  if (decision.allowed) {
    console.log('[PropFirmGate] PASS: All blocking prop firm rules satisfied.');
    return {
      evaluated: true,
      accountType: 'prop',
      allowed: true,
      blockReason: null,
      decision,
      firmName: settings.firm_name,
      accountPhase: settings.account_phase,
      resetBoundaryUtc: resetBoundaryIso,
      highWatermarkBalance: resolvedHwmBalance,
      highWatermarkEquity: resolvedHwmEquity,
      liveFloatingPnl: equityAvailable ? resolvedFloatingPnl : null
    };
  } else {
    const joinedReasons = decision.reasons.join(' | ') || 'Blocked by Prop Firm Rule Engine.';
    console.log(`[PropFirmGate] BLOCKED: ${joinedReasons}`);
    return {
      evaluated: true,
      accountType: 'prop',
      allowed: false,
      blockReason: joinedReasons,
      decision,
      firmName: settings.firm_name,
      accountPhase: settings.account_phase,
      resetBoundaryUtc: resetBoundaryIso,
      highWatermarkBalance: resolvedHwmBalance,
      highWatermarkEquity: resolvedHwmEquity,
      liveFloatingPnl: equityAvailable ? resolvedFloatingPnl : null
    };
  }
}

/**
 * Non-disruptive helper invoked during State 2 (ACTIVE trade monitoring) to keep
 * `high_watermark_balance` and `high_watermark_equity` monotonically updated as
 * open trades fluctuate in profit or close.
 */
export async function syncPropFirmStateForActiveWatcher(params: {
  supabase: any;
  userId: string;
  rawAccountType?: string | null;
  symbol: string;
  currentMarketPrice: number;
}): Promise<void> {
  try {
    const accountType = resolvePersistedAccountType(params.rawAccountType);
    if (accountType !== 'prop') return;

    await evaluateWatcherPropFirmGate({
      supabase: params.supabase,
      userId: params.userId,
      symbol: params.symbol,
      rawAccountType: params.rawAccountType,
      proposedTradeRisk: 1,
      currentMarketPrice: params.currentMarketPrice
    });
  } catch {
    // Non-fatal HWM synchronization during active trade monitoring
  }
}

