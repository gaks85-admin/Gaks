import { PropFirmSettings } from './prop-firm-service.js';
import type { EconomicEventResult } from './economic-event-service.js';
import type { EconomicEvent } from './providers/economic-calendar-provider.js';

export type PropFirmCheckStatus =
  | 'PASS'
  | 'BLOCK'
  | 'UNAVAILABLE'
  | 'CONFIG_ERROR'
  | 'TARGET_REACHED'
  | 'TARGET_NOT_REACHED';

export type PropFirmRuleName =
  | 'CONFIGURATION'
  | 'DAILY_LOSS'
  | 'MAX_DRAWDOWN'
  | 'RISK_PER_TRADE'
  | 'MAX_TRADES_PER_DAY'
  | 'NEWS_RESTRICTION'
  | 'PROFIT_TARGET';

export interface PropFirmCheckResult {
  rule: PropFirmRuleName;
  status: PropFirmCheckStatus;
  actualValue: number | string | boolean | null;
  limit: number | string | null;
  reason: string;
}

export interface PropFirmDecision {
  allowed: boolean;
  reasons: string[];
  checks: PropFirmCheckResult[];
}

export interface PropFirmNewsGateInput {
  blocked: boolean;
  reason?: string;
  event?: EconomicEvent | null;
  eventName?: string;
  currency?: string;
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
  scheduledAt?: string;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
}

/**
 * Deterministic input contract for evaluatePropFirmRules().
 *
 * Monetary & P/L Semantics:
 * - `accountBalance`: Current closed/realized account balance.
 * - `accountEquity`: Current live account equity (includes open floating unrealized P/L).
 *   Floating unrealized P/L is deterministically derived as `accountEquity - accountBalance`.
 * - `startingAccountSize`: Initial challenge/account starting size.
 * - `dailyStartBalance`: Start-of-day balance at the firm's daily reset boundary.
 *   Used as the percentage reference when `daily_loss_calculation_basis === 'BALANCE'`.
 *   Falls back to `settings.account_size` if omitted, never to live intraday `accountBalance`.
 * - `dailyStartEquity`: Start-of-day equity at the firm's daily reset boundary.
 *   Used as the percentage reference when `daily_loss_calculation_basis === 'EQUITY'`.
 *   Falls back to `dailyStartBalance ?? settings.account_size` if omitted, never to live intraday `accountEquity`.
 * - `currentDailyPnl`: Realized P/L for the current prop-firm trading day (positive = profit, negative = loss).
 *   In `BALANCE` mode, only realized daily loss (`currentDailyPnl < 0`) counts toward daily loss.
 *   In `EQUITY` mode, both realized daily P/L (`currentDailyPnl`) and open floating P/L (`accountEquity - accountBalance`)
 *   (or drawdown from `dailyStartEquity`) are evaluated.
 * - `highWatermarkBalance`: Highest recorded balance for `TRAILING` drawdown when `drawdown_calculation_basis === 'BALANCE'`.
 * - `highWatermarkEquity`: Highest recorded equity for `TRAILING` drawdown when `drawdown_calculation_basis === 'EQUITY'`.
 * - `currentTotalProfit`: Cumulative total challenge/account profit. If omitted (`undefined`), derived as
 *   `accountBalance - settings.account_size`. Today's `currentDailyPnl` is never used as cumulative profit.
 * - `tradesTakenToday`: Count of trades executed within the current prop-firm reset window.
 */
export interface PropFirmRuleInput {
  settings: PropFirmSettings | null;
  accountBalance: number;
  accountEquity: number;
  startingAccountSize: number;
  currentDailyPnl: number;
  currentDrawdown: number;
  dailyStartBalance?: number | null;
  dailyStartEquity?: number | null;
  highWatermarkBalance?: number | null;
  highWatermarkEquity?: number | null;
  currentTotalProfit?: number | null;
  proposedTradeRisk: number;
  tradesTakenToday: number;
  currentTimeUtc?: string;
  newsGateResult?: PropFirmNewsGateInput | null;
}

const EPSILON = 1e-6;

const VALID_VALUE_TYPES = new Set(['PERCENTAGE', 'AMOUNT']);
const VALID_CALC_BASES = new Set(['BALANCE', 'EQUITY']);
const VALID_DRAWDOWN_TYPES = new Set(['STATIC', 'TRAILING']);

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function isPositiveFinite(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val > 0;
}

function isNonNegativeFinite(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

/**
 * Pure adapter that converts an authoritative EconomicEventService `EconomicEventResult`
 * into a `PropFirmNewsGateInput` while recording the configured Prop Firm buffers.
 */
export function adaptNewsCheckToPropFirmGate(
  newsCheck: EconomicEventResult | null | undefined,
  settings: Pick<PropFirmSettings, 'news_buffer_before_minutes' | 'news_buffer_after_minutes'>
): PropFirmNewsGateInput | null {
  if (!newsCheck) {
    return null;
  }
  return {
    blocked: newsCheck.tradeBlocked,
    reason: newsCheck.blockReason,
    eventName: newsCheck.eventName,
    currency: newsCheck.currency,
    impact: newsCheck.impact,
    scheduledAt: newsCheck.scheduledAt,
    bufferBeforeMinutes: settings.news_buffer_before_minutes,
    bufferAfterMinutes: settings.news_buffer_after_minutes
  };
}

/**
 * Validates `PropFirmSettings` configuration deterministically.
 * Does NOT validate missing runtime state (such as `highWatermarkEquity` or `newsGateResult`),
 * which are evaluated by their respective rule checks as `UNAVAILABLE`.
 */
function validateConfiguration(settings: PropFirmSettings): string | null {
  if (!settings.firm_name || typeof settings.firm_name !== 'string' || settings.firm_name.trim() === '') {
    return 'Missing or invalid firm_name.';
  }
  if (!settings.account_phase || typeof settings.account_phase !== 'string' || settings.account_phase.trim() === '') {
    return 'Missing or invalid account_phase.';
  }
  if (!isPositiveFinite(settings.account_size)) {
    return 'Invalid account_size (must be a finite number > 0).';
  }

  // Daily Loss Configuration
  if (!VALID_VALUE_TYPES.has(settings.daily_loss_limit_type as string)) {
    return `Invalid daily_loss_limit_type: ${String(settings.daily_loss_limit_type)}. Expected PERCENTAGE or AMOUNT.`;
  }
  if (!VALID_CALC_BASES.has(settings.daily_loss_calculation_basis as string)) {
    return `Invalid daily_loss_calculation_basis: ${String(settings.daily_loss_calculation_basis)}. Expected BALANCE or EQUITY.`;
  }
  if (!isPositiveFinite(settings.daily_loss_limit)) {
    return 'Invalid daily_loss_limit (must be a finite number > 0).';
  }
  if (settings.daily_loss_limit_type === 'PERCENTAGE' && settings.daily_loss_limit > 100) {
    return 'Invalid daily_loss_limit percentage (must be <= 100).';
  }

  // Maximum Drawdown Configuration
  if (!VALID_DRAWDOWN_TYPES.has(settings.drawdown_type as string)) {
    return `Invalid drawdown_type: ${String(settings.drawdown_type)}. Expected STATIC or TRAILING.`;
  }
  if (!VALID_CALC_BASES.has(settings.drawdown_calculation_basis as string)) {
    return `Invalid drawdown_calculation_basis: ${String(settings.drawdown_calculation_basis)}. Expected BALANCE or EQUITY.`;
  }
  if (!isPositiveFinite(settings.maximum_drawdown) || settings.maximum_drawdown > 100) {
    return 'Invalid maximum_drawdown (must be a finite number > 0 and <= 100).';
  }

  // Risk Per Trade Configuration
  if (!VALID_VALUE_TYPES.has(settings.risk_per_trade_type as string)) {
    return `Invalid risk_per_trade_type: ${String(settings.risk_per_trade_type)}. Expected PERCENTAGE or AMOUNT.`;
  }
  if (!isPositiveFinite(settings.risk_per_trade)) {
    return 'Invalid risk_per_trade (must be a finite number > 0).';
  }
  if (settings.risk_per_trade_type === 'PERCENTAGE' && settings.risk_per_trade > 100) {
    return 'Invalid risk_per_trade percentage (must be <= 100).';
  }

  // Maximum Trades Per Day Configuration
  if (settings.maximum_trades_per_day !== null && settings.maximum_trades_per_day !== undefined) {
    if (
      !isFiniteNumber(settings.maximum_trades_per_day) ||
      !Number.isInteger(settings.maximum_trades_per_day) ||
      settings.maximum_trades_per_day <= 0
    ) {
      return 'Invalid maximum_trades_per_day (must be null/undefined or a positive integer).';
    }
  }

  // News Restriction Configuration
  if (typeof settings.news_restriction_enabled !== 'boolean') {
    return 'Invalid news_restriction_enabled (must be a boolean).';
  }
  if (!isNonNegativeFinite(settings.news_buffer_before_minutes)) {
    return 'Invalid news_buffer_before_minutes (must be a finite number >= 0).';
  }
  if (!isNonNegativeFinite(settings.news_buffer_after_minutes)) {
    return 'Invalid news_buffer_after_minutes (must be a finite number >= 0).';
  }

  // Profit Target Configuration
  if (!VALID_VALUE_TYPES.has(settings.profit_target_type as string)) {
    return `Invalid profit_target_type: ${String(settings.profit_target_type)}. Expected PERCENTAGE or AMOUNT.`;
  }
  if (settings.profit_target !== null && settings.profit_target !== undefined) {
    if (!isPositiveFinite(settings.profit_target)) {
      return 'Invalid profit_target (must be null/undefined or a finite number > 0).';
    }
    if (settings.profit_target_type === 'PERCENTAGE' && settings.profit_target > 1000) {
      return 'Invalid profit_target percentage (must be <= 1000).';
    }
  }

  return null;
}

/**
 * Evaluates Prop Firm rules deterministically in isolation.
 */
export function evaluatePropFirmRules(input: PropFirmRuleInput): PropFirmDecision {
  const checks: PropFirmCheckResult[] = [];
  const reasons: string[] = [];
  const { settings } = input;

  // 1. Configuration Validation
  if (!settings) {
    checks.push({
      rule: 'CONFIGURATION',
      status: 'CONFIG_ERROR',
      actualValue: null,
      limit: 'Valid PropFirmSettings',
      reason: 'No prop firm settings configuration provided.'
    });
    return {
      allowed: false,
      reasons: ['Prop firm settings configuration is missing.'],
      checks
    };
  }

  const configErrorReason = validateConfiguration(settings);
  if (configErrorReason) {
    checks.push({
      rule: 'CONFIGURATION',
      status: 'CONFIG_ERROR',
      actualValue: 'INVALID_CONFIG',
      limit: 'Valid Configuration',
      reason: configErrorReason
    });
    return {
      allowed: false,
      reasons: [configErrorReason],
      checks
    };
  }

  checks.push({
    rule: 'CONFIGURATION',
    status: 'PASS',
    actualValue: 'VALID',
    limit: 'VALID',
    reason: 'Configuration is valid.'
  });

  const accountSize = settings.account_size as number;
  const proposedRisk = input.proposedTradeRisk;
  const hasValidCoreAccounts =
    isNonNegativeFinite(input.accountBalance) &&
    isNonNegativeFinite(input.accountEquity) &&
    isPositiveFinite(input.startingAccountSize);
  const hasValidProposedRisk = isPositiveFinite(proposedRisk);

  // 2. Daily Loss Rule
  const dailyLimitVal = settings.daily_loss_limit as number;
  const dailyLimitType = settings.daily_loss_limit_type;
  const dailyBasis = settings.daily_loss_calculation_basis;

  const invalidStartBalance =
    input.dailyStartBalance !== undefined &&
    input.dailyStartBalance !== null &&
    !isPositiveFinite(input.dailyStartBalance);
  const invalidStartEquity =
    input.dailyStartEquity !== undefined &&
    input.dailyStartEquity !== null &&
    !isPositiveFinite(input.dailyStartEquity);

  if (
    !hasValidCoreAccounts ||
    !hasValidProposedRisk ||
    !isFiniteNumber(input.currentDailyPnl) ||
    invalidStartBalance ||
    invalidStartEquity
  ) {
    const invalidReason = 'Invalid or non-finite runtime inputs for daily loss evaluation.';
    checks.push({
      rule: 'DAILY_LOSS',
      status: 'BLOCK',
      actualValue: null,
      limit: dailyLimitVal,
      reason: invalidReason
    });
    reasons.push(invalidReason);
  } else {
    // Percentage reference uses start-of-day balance/equity (or static account_size), never live intraday balance/equity
    const dailyReference =
      dailyBasis === 'EQUITY'
        ? (input.dailyStartEquity ?? input.dailyStartBalance ?? accountSize)
        : (input.dailyStartBalance ?? accountSize);

    const dailyLimitAmount =
      dailyLimitType === 'PERCENTAGE'
        ? dailyReference * (dailyLimitVal / 100)
        : dailyLimitVal;

    // Measure actual daily loss according to daily_loss_calculation_basis:
    // - BALANCE: only realized daily loss (currentDailyPnl < 0) counts; floating unrealized P/L is excluded.
    // - EQUITY: includes both realized daily P/L and open floating unrealized P/L (accountEquity - accountBalance),
    //   as well as any direct equity drop from dailyStartEquity when provided.
    let lossToday = 0;
    if (dailyBasis === 'BALANCE') {
      const lossFromRealizedPnl = input.currentDailyPnl < 0 ? Math.abs(input.currentDailyPnl) : 0;
      const lossFromStartBalance =
        input.dailyStartBalance !== undefined && input.dailyStartBalance !== null
          ? Math.max(0, input.dailyStartBalance - input.accountBalance)
          : 0;
      lossToday = Math.max(lossFromRealizedPnl, lossFromStartBalance);
    } else {
      const floatingPnl = input.accountEquity - input.accountBalance;
      const netEquityDailyPnl = input.currentDailyPnl + floatingPnl;
      const lossFromComponents = netEquityDailyPnl < 0 ? Math.abs(netEquityDailyPnl) : 0;
      const lossFromStartEquity =
        input.dailyStartEquity !== undefined && input.dailyStartEquity !== null
          ? Math.max(0, input.dailyStartEquity - input.accountEquity)
          : 0;
      lossToday = Math.max(lossFromComponents, lossFromStartEquity);
    }

    const remainingDailyAllowance = dailyLimitAmount - lossToday;
    let dailyLossStatus: PropFirmCheckStatus = 'PASS';
    let dailyLossReason = `Daily loss incurred ($${lossToday.toFixed(2)}) + proposed risk ($${proposedRisk.toFixed(2)}) is within ${dailyBasis} daily limit ($${dailyLimitAmount.toFixed(2)}).`;

    if (lossToday >= dailyLimitAmount - EPSILON) {
      dailyLossStatus = 'BLOCK';
      dailyLossReason = `Daily loss limit already reached or breached on ${dailyBasis} basis (Loss: $${lossToday.toFixed(2)} >= Limit: $${dailyLimitAmount.toFixed(2)}).`;
      reasons.push(dailyLossReason);
    } else if (lossToday + proposedRisk > dailyLimitAmount + EPSILON) {
      dailyLossStatus = 'BLOCK';
      dailyLossReason = `Proposed trade risk ($${proposedRisk.toFixed(2)}) would breach ${dailyBasis} daily loss limit (Remaining allowance: $${remainingDailyAllowance.toFixed(2)}).`;
      reasons.push(dailyLossReason);
    }

    checks.push({
      rule: 'DAILY_LOSS',
      status: dailyLossStatus,
      actualValue: Number((lossToday + proposedRisk).toFixed(4)),
      limit: Number(dailyLimitAmount.toFixed(4)),
      reason: dailyLossReason
    });
  }

  // 3. Maximum Drawdown Rule
  const maxDdVal = settings.maximum_drawdown as number;
  const ddType = settings.drawdown_type;
  const ddBasis = settings.drawdown_calculation_basis;
  const maxDdLimitAmount = accountSize * (maxDdVal / 100);

  if (!hasValidCoreAccounts || !hasValidProposedRisk || !isNonNegativeFinite(input.currentDrawdown)) {
    const invalidDdReason = 'Invalid or non-finite runtime inputs for maximum drawdown evaluation.';
    checks.push({
      rule: 'MAX_DRAWDOWN',
      status: 'BLOCK',
      actualValue: null,
      limit: Number(maxDdLimitAmount.toFixed(4)),
      reason: invalidDdReason
    });
    reasons.push(invalidDdReason);
  } else if (ddType === 'STATIC') {
    const basisAccountValue = ddBasis === 'EQUITY' ? input.accountEquity : input.accountBalance;
    const computedBasisDrawdown = Math.max(0, accountSize - basisAccountValue);
    const currentDd =
      computedBasisDrawdown === 0 &&
      input.accountBalance === accountSize &&
      input.accountEquity === accountSize &&
      input.currentDrawdown > 0
        ? input.currentDrawdown
        : computedBasisDrawdown;

    let ddStatus: PropFirmCheckStatus = 'PASS';
    let ddReason = `Static ${ddBasis} drawdown ($${currentDd.toFixed(2)}) + proposed risk ($${proposedRisk.toFixed(2)}) is within limit ($${maxDdLimitAmount.toFixed(2)}).`;

    if (currentDd >= maxDdLimitAmount - EPSILON) {
      ddStatus = 'BLOCK';
      ddReason = `Maximum static ${ddBasis} drawdown reached or breached (Current: $${currentDd.toFixed(2)} >= Limit: $${maxDdLimitAmount.toFixed(2)}).`;
      reasons.push(ddReason);
    } else if (currentDd + proposedRisk > maxDdLimitAmount + EPSILON) {
      ddStatus = 'BLOCK';
      ddReason = `Proposed trade risk ($${proposedRisk.toFixed(2)}) would breach maximum static ${ddBasis} drawdown limit ($${maxDdLimitAmount.toFixed(2)}).`;
      reasons.push(ddReason);
    }

    checks.push({
      rule: 'MAX_DRAWDOWN',
      status: ddStatus,
      actualValue: Number(currentDd.toFixed(4)),
      limit: Number(maxDdLimitAmount.toFixed(4)),
      reason: ddReason
    });
  } else {
    // TRAILING Drawdown
    const rawHwm =
      ddBasis === 'BALANCE'
        ? (input.highWatermarkBalance !== undefined ? input.highWatermarkBalance : input.highWatermarkEquity)
        : input.highWatermarkEquity;

    if (rawHwm === undefined || rawHwm === null) {
      const unavailReason = `Trailing ${ddBasis} drawdown rule configured but required high-watermark state is unavailable.`;
      checks.push({
        rule: 'MAX_DRAWDOWN',
        status: 'UNAVAILABLE',
        actualValue: null,
        limit: Number(maxDdLimitAmount.toFixed(4)),
        reason: unavailReason
      });
      reasons.push(unavailReason);
    } else if (!isPositiveFinite(rawHwm)) {
      const invalidHwmReason = `Invalid high-watermark value for trailing ${ddBasis} drawdown.`;
      checks.push({
        rule: 'MAX_DRAWDOWN',
        status: 'BLOCK',
        actualValue: null,
        limit: Number(maxDdLimitAmount.toFixed(4)),
        reason: invalidHwmReason
      });
      reasons.push(invalidHwmReason);
    } else {
      const basisCurrentValue = ddBasis === 'EQUITY' ? input.accountEquity : input.accountBalance;
      const drawdownFromHwm = Math.max(0, rawHwm - basisCurrentValue);
      const trailingLimit = maxDdLimitAmount;

      let ddStatus: PropFirmCheckStatus = 'PASS';
      let ddReason = `Trailing ${ddBasis} drawdown from HWM ($${drawdownFromHwm.toFixed(2)}) + proposed risk ($${proposedRisk.toFixed(2)}) is within limit ($${trailingLimit.toFixed(2)}).`;

      if (drawdownFromHwm >= trailingLimit - EPSILON) {
        ddStatus = 'BLOCK';
        ddReason = `Maximum trailing ${ddBasis} drawdown reached or breached (Current: $${drawdownFromHwm.toFixed(2)} >= Limit: $${trailingLimit.toFixed(2)}).`;
        reasons.push(ddReason);
      } else if (drawdownFromHwm + proposedRisk > trailingLimit + EPSILON) {
        ddStatus = 'BLOCK';
        ddReason = `Proposed trade risk ($${proposedRisk.toFixed(2)}) would breach maximum trailing ${ddBasis} drawdown limit ($${trailingLimit.toFixed(2)}).`;
        reasons.push(ddReason);
      }

      checks.push({
        rule: 'MAX_DRAWDOWN',
        status: ddStatus,
        actualValue: Number(drawdownFromHwm.toFixed(4)),
        limit: Number(trailingLimit.toFixed(4)),
        reason: ddReason
      });
    }
  }

  // 4. Risk Per Trade Rule
  const riskVal = settings.risk_per_trade as number;
  const riskType = settings.risk_per_trade_type;
  const maxAllowedRiskAmount =
    riskType === 'PERCENTAGE' ? accountSize * (riskVal / 100) : riskVal;

  if (!hasValidProposedRisk) {
    const invalidRiskReason = 'Invalid proposedTradeRisk: must be a finite number greater than 0.';
    checks.push({
      rule: 'RISK_PER_TRADE',
      status: 'BLOCK',
      actualValue: Number.isFinite(proposedRisk) ? proposedRisk : null,
      limit: Number(maxAllowedRiskAmount.toFixed(4)),
      reason: invalidRiskReason
    });
    reasons.push(invalidRiskReason);
  } else {
    let riskStatus: PropFirmCheckStatus = 'PASS';
    let riskReason = `Proposed trade risk ($${proposedRisk.toFixed(2)}) is within per-trade limit ($${maxAllowedRiskAmount.toFixed(2)}).`;

    if (proposedRisk > maxAllowedRiskAmount + EPSILON) {
      riskStatus = 'BLOCK';
      riskReason = `Proposed trade risk ($${proposedRisk.toFixed(2)}) exceeds maximum allowed risk per trade ($${maxAllowedRiskAmount.toFixed(2)}).`;
      reasons.push(riskReason);
    }

    checks.push({
      rule: 'RISK_PER_TRADE',
      status: riskStatus,
      actualValue: Number(proposedRisk.toFixed(4)),
      limit: Number(maxAllowedRiskAmount.toFixed(4)),
      reason: riskReason
    });
  }

  // 5. Maximum Trades Per Day Rule
  const maxTrades = settings.maximum_trades_per_day;
  const tradesToday = input.tradesTakenToday;

  if (!isNonNegativeFinite(tradesToday) || !Number.isInteger(tradesToday)) {
    const invalidTradesReason = 'Invalid tradesTakenToday: must be a non-negative integer.';
    checks.push({
      rule: 'MAX_TRADES_PER_DAY',
      status: 'BLOCK',
      actualValue: Number.isFinite(tradesToday) ? tradesToday : null,
      limit: maxTrades ?? 'UNLIMITED',
      reason: invalidTradesReason
    });
    reasons.push(invalidTradesReason);
  } else if (maxTrades !== null && maxTrades !== undefined) {
    let tradesStatus: PropFirmCheckStatus = 'PASS';
    let tradesReason = `Trades taken today (${tradesToday}) is below daily limit (${maxTrades}).`;

    if (tradesToday >= maxTrades) {
      tradesStatus = 'BLOCK';
      tradesReason = `Maximum trades per day reached (Trades today: ${tradesToday} >= Limit: ${maxTrades}).`;
      reasons.push(tradesReason);
    }

    checks.push({
      rule: 'MAX_TRADES_PER_DAY',
      status: tradesStatus,
      actualValue: tradesToday,
      limit: maxTrades,
      reason: tradesReason
    });
  } else {
    checks.push({
      rule: 'MAX_TRADES_PER_DAY',
      status: 'PASS',
      actualValue: tradesToday,
      limit: 'UNLIMITED',
      reason: 'No maximum trades per day configured.'
    });
  }

  // 6. News Restriction Rule
  const newsEnabled = settings.news_restriction_enabled;
  const bufferBefore = settings.news_buffer_before_minutes;
  const bufferAfter = settings.news_buffer_after_minutes;
  const windowLabel = `-${bufferBefore}m/+${bufferAfter}m`;

  if (newsEnabled) {
    if (!input.newsGateResult || typeof input.newsGateResult.blocked !== 'boolean') {
      const unavailNewsReason = `News restriction is enabled (window ${windowLabel}) but newsGateResult input is missing (fail closed).`;
      checks.push({
        rule: 'NEWS_RESTRICTION',
        status: 'UNAVAILABLE',
        actualValue: 'UNKNOWN',
        limit: `NO_NEWS_BLOCK (${windowLabel})`,
        reason: unavailNewsReason
      });
      reasons.push(unavailNewsReason);
    } else if (input.newsGateResult.blocked) {
      const blockedNewsReason =
        input.newsGateResult.reason ||
        `Blocked by Economic News Gate within configured window (${windowLabel}).`;
      checks.push({
        rule: 'NEWS_RESTRICTION',
        status: 'BLOCK',
        actualValue: 'BLOCKED',
        limit: `NO_NEWS_BLOCK (${windowLabel})`,
        reason: blockedNewsReason
      });
      reasons.push(blockedNewsReason);
    } else {
      checks.push({
        rule: 'NEWS_RESTRICTION',
        status: 'PASS',
        actualValue: 'CLEAR',
        limit: `NO_NEWS_BLOCK (${windowLabel})`,
        reason: `Economic News Gate reports clear window (${windowLabel}).`
      });
    }
  } else {
    checks.push({
      rule: 'NEWS_RESTRICTION',
      status: 'PASS',
      actualValue: 'DISABLED',
      limit: 'DISABLED',
      reason: 'News restriction is disabled.'
    });
  }

  // 7. Profit Target Rule (Informational Only — Never Blocks Execution)
  const profitTargetVal = settings.profit_target;
  const profitTargetType = settings.profit_target_type;

  if (profitTargetVal !== null && profitTargetVal !== undefined) {
    const targetAmount =
      profitTargetType === 'PERCENTAGE'
        ? accountSize * (profitTargetVal / 100)
        : profitTargetVal;

    // Resolve cumulative total profit:
    // Prefer explicit `input.currentTotalProfit`; if omitted (`undefined`), derive from `accountBalance - accountSize`.
    // Never use intraday `currentDailyPnl` as cumulative profit.
    let resolvedTotalProfit: number | null = null;
    if (input.currentTotalProfit !== undefined) {
      resolvedTotalProfit = isFiniteNumber(input.currentTotalProfit) ? input.currentTotalProfit : null;
    } else if (hasValidCoreAccounts) {
      resolvedTotalProfit = input.accountBalance - accountSize;
    }

    if (resolvedTotalProfit === null) {
      checks.push({
        rule: 'PROFIT_TARGET',
        status: 'TARGET_NOT_REACHED',
        actualValue: null,
        limit: Number(targetAmount.toFixed(4)),
        reason: 'Cumulative account profit is unavailable; profit target not verified.'
      });
    } else {
      const targetReached = resolvedTotalProfit >= targetAmount - EPSILON;
      checks.push({
        rule: 'PROFIT_TARGET',
        status: targetReached ? 'TARGET_REACHED' : 'TARGET_NOT_REACHED',
        actualValue: Number(resolvedTotalProfit.toFixed(4)),
        limit: Number(targetAmount.toFixed(4)),
        reason: targetReached
          ? `Cumulative profit ($${resolvedTotalProfit.toFixed(2)}) has reached target ($${targetAmount.toFixed(2)}).`
          : `Cumulative profit ($${resolvedTotalProfit.toFixed(2)}) has not yet reached target ($${targetAmount.toFixed(2)}).`
      });
    }
  } else {
    checks.push({
      rule: 'PROFIT_TARGET',
      status: 'TARGET_NOT_REACHED',
      actualValue: 0,
      limit: 'UNCONFIGURED',
      reason: 'No profit target configured.'
    });
  }

  const allowed = checks.every(
    c => c.status === 'PASS' || c.status === 'TARGET_REACHED' || c.status === 'TARGET_NOT_REACHED'
  );

  return {
    allowed,
    reasons,
    checks
  };
}
