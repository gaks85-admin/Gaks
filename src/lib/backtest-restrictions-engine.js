import { getMarketSchedule } from './market-hours.js';
import { evaluateQualityGate } from './quality-gate.js';
import { evaluateRiskGovernor, GOVERNOR_THRESHOLDS } from './risk-governor.js';
import { resolvePersistedAccountType } from './prop-firm-service.js';
export function isMarketOpenHistorically(symbol, timestampUtc) {
    const date = new Date(timestampUtc);
    const schedule = getMarketSchedule(symbol, date);
    return {
        isOpen: schedule.isOpen,
        reason: schedule.reason
    };
}
export function getActiveMarketSessions(timestampUtc) {
    const date = new Date(timestampUtc);
    const sessions = [];
    const getLocalHour = (timeZone) => {
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone,
                hour: 'numeric',
                hour12: false
            });
            return parseInt(formatter.format(date), 10);
        }
        catch {
            return date.getUTCHours();
        }
    };
    const londonHour = getLocalHour('Europe/London');
    if (londonHour >= 8 && londonHour < 17) {
        sessions.push('London');
    }
    const nyHour = getLocalHour('America/New_York');
    if (nyHour >= 8 && nyHour < 17) {
        sessions.push('New York');
    }
    const tokyoHour = getLocalHour('Asia/Tokyo');
    if (tokyoHour >= 9 && tokyoHour < 18) {
        sessions.push('Asian');
        sessions.push('Tokyo');
    }
    const sydneyHour = getLocalHour('Australia/Sydney');
    if (sydneyHour >= 7 && sydneyHour < 16) {
        sessions.push('Sydney');
    }
    return sessions;
}
export function evaluateSessionMatch(rulesSessions, activeSessions) {
    if (!rulesSessions || !Array.isArray(rulesSessions) || rulesSessions.length === 0) {
        return { matched: true, reason: 'No session filter rule active in strategy' };
    }
    const compiledSessions = rulesSessions.map(s => s.toLowerCase().trim());
    const matched = activeSessions.some(act => {
        const actLower = act.toLowerCase().trim();
        return compiledSessions.some(cs => actLower.includes(cs) || cs.includes(actLower));
    });
    const activeStr = activeSessions.length > 0 ? activeSessions.join(', ') : 'Off-Session';
    return {
        matched,
        reason: matched
            ? `Active sessions (${activeStr}) match configured strategy session: ${rulesSessions.join(', ')}`
            : `Active sessions (${activeStr}) outside configured strategy session: ${rulesSessions.join(', ')}`
    };
}
export function classifyHistoricalTradeOutcome(trade) {
    if (trade.exitReason === 'BREAKEVEN' || trade.outcome === 'BREAKEVEN') {
        return 'BREAKEVEN';
    }
    if (trade.exitReason === 'STOP_LOSS' || trade.exitReason === 'SAME_CANDLE_STOP_LOSS') {
        return 'LOSS';
    }
    if (trade.outcome === 'WIN') {
        return 'WIN';
    }
    if (trade.outcome === 'LOSS') {
        return 'LOSS';
    }
    if (trade.netPnL === 0 || (trade.grossPnL === 0 && trade.exitPrice === trade.entryPrice)) {
        return 'BREAKEVEN';
    }
    if (trade.netPnL > 0) {
        return 'WIN';
    }
    return 'LOSS';
}
export class HistoricalRestrictionsGovernor {
    initialBalance;
    currentBalance;
    currentEquity;
    peakBalance;
    symbol;
    accountType;
    propFirmSettings;
    isPropFirmBreached = false;
    propFirmBreachReason = '';
    propFirmBreachTimestamp = '';
    highWatermarkBalance;
    currentDayUtc = '';
    dailyClosedPnL = 0;
    maxDailyLossEncountered = 0;
    maxDrawdownEncounteredPercent = 0;
    consecutiveLosses = 0;
    consecutiveWins = 0;
    totalTrades = 0;
    totalRealizedR = 0;
    cooldownUntilTimestamp = 0;
    cooldownReasonType = 'POST_TRADE';
    historicalNewsEvents = [];
    totalCandidatesEvaluated = 0;
    totalSignalsPassed = 0;
    rejectionsByGate = {
        marketHours: 0,
        sessionFilter: 0,
        economicNews: 0,
        qualityGate: 0,
        riskGovernor: 0,
        cooldown: 0,
        propFirm: 0
    };
    rejectionDetails = [];
    enableMarketHours = true;
    enableSessions = true;
    enableQualityGate = true;
    enableRiskGovernor = true;
    enableCooldown = true;
    enablePropFirm = true;
    constructor(params) {
        this.initialBalance = params.initialBalance;
        this.currentBalance = params.initialBalance;
        this.currentEquity = params.initialBalance;
        this.peakBalance = params.initialBalance;
        this.symbol = params.symbol.toUpperCase();
        this.accountType = resolvePersistedAccountType(params.accountType);
        this.propFirmSettings = params.propFirmSettings || null;
        this.highWatermarkBalance = this.propFirmSettings?.account_size || params.initialBalance;
        if (params.historicalNewsEvents && Array.isArray(params.historicalNewsEvents)) {
            this.historicalNewsEvents = params.historicalNewsEvents;
        }
        if (params.toggles) {
            if (params.toggles.marketHours !== undefined)
                this.enableMarketHours = params.toggles.marketHours;
            if (params.toggles.sessionFilter !== undefined)
                this.enableSessions = params.toggles.sessionFilter;
            if (params.toggles.qualityGate !== undefined)
                this.enableQualityGate = params.toggles.qualityGate;
            if (params.toggles.riskGovernor !== undefined)
                this.enableRiskGovernor = params.toggles.riskGovernor;
            if (params.toggles.cooldown !== undefined)
                this.enableCooldown = params.toggles.cooldown;
            if (params.toggles.propFirm !== undefined)
                this.enablePropFirm = params.toggles.propFirm;
        }
    }
    reset() {
        this.currentBalance = this.initialBalance;
        this.currentEquity = this.initialBalance;
        this.peakBalance = this.initialBalance;
        this.isPropFirmBreached = false;
        this.propFirmBreachReason = '';
        this.propFirmBreachTimestamp = '';
        this.highWatermarkBalance = this.propFirmSettings?.account_size || this.initialBalance;
        this.currentDayUtc = '';
        this.dailyClosedPnL = 0;
        this.maxDailyLossEncountered = 0;
        this.maxDrawdownEncounteredPercent = 0;
        this.consecutiveLosses = 0;
        this.consecutiveWins = 0;
        this.totalTrades = 0;
        this.totalRealizedR = 0;
        this.cooldownUntilTimestamp = 0;
        this.cooldownReasonType = 'POST_TRADE';
        this.totalCandidatesEvaluated = 0;
        this.totalSignalsPassed = 0;
        this.rejectionsByGate = {
            marketHours: 0,
            sessionFilter: 0,
            economicNews: 0,
            qualityGate: 0,
            riskGovernor: 0,
            cooldown: 0,
            propFirm: 0
        };
        this.rejectionDetails = [];
    }
    onCandle(timestampUtc, balance, equity) {
        this.currentBalance = balance;
        this.currentEquity = equity;
        if (balance > this.peakBalance) {
            this.peakBalance = balance;
        }
        if (balance > this.highWatermarkBalance) {
            this.highWatermarkBalance = balance;
        }
        if (this.peakBalance > 0) {
            const ddPct = ((this.peakBalance - balance) / this.peakBalance) * 100;
            if (ddPct > this.maxDrawdownEncounteredPercent) {
                this.maxDrawdownEncounteredPercent = ddPct;
            }
        }
        const candleDate = new Date(timestampUtc);
        const dayKey = `${candleDate.getUTCFullYear()}-${String(candleDate.getUTCMonth() + 1).padStart(2, '0')}-${String(candleDate.getUTCDate()).padStart(2, '0')}`;
        if (this.currentDayUtc && this.currentDayUtc !== dayKey) {
            this.dailyClosedPnL = 0;
        }
        this.currentDayUtc = dayKey;
    }
    onTradeClosed(trade) {
        this.totalTrades++;
        const exitDate = new Date(trade.exitTimestamp);
        this.currentDayUtc = `${exitDate.getUTCFullYear()}-${String(exitDate.getUTCMonth() + 1).padStart(2, '0')}-${String(exitDate.getUTCDate()).padStart(2, '0')}`;
        this.dailyClosedPnL += trade.netPnL;
        if (this.dailyClosedPnL < 0 && Math.abs(this.dailyClosedPnL) > this.maxDailyLossEncountered) {
            this.maxDailyLossEncountered = Math.abs(this.dailyClosedPnL);
        }
        const realizedR = trade.riskAmount > 0 ? trade.netPnL / trade.riskAmount : 0;
        this.totalRealizedR += realizedR;
        const outcome = classifyHistoricalTradeOutcome(trade);
        const exitTime = new Date(trade.exitTimestamp).getTime();
        if (outcome === 'WIN') {
            this.consecutiveWins++;
            this.consecutiveLosses = 0;
            this.cooldownUntilTimestamp = exitTime + 5 * 60 * 1000;
            this.cooldownReasonType = 'POST_TRADE';
        }
        else if (outcome === 'BREAKEVEN') {
            this.consecutiveLosses = 0;
            this.consecutiveWins = 0;
            this.cooldownUntilTimestamp = exitTime + 5 * 60 * 1000;
            this.cooldownReasonType = 'POST_TRADE';
        }
        else {
            this.consecutiveLosses++;
            this.consecutiveWins = 0;
            this.cooldownUntilTimestamp = exitTime + 4 * 60 * 60 * 1000;
            this.cooldownReasonType = 'LOSS';
        }
        this.currentBalance = trade.balanceAfter;
        this.currentEquity = trade.balanceAfter;
        if (this.currentBalance > this.peakBalance) {
            this.peakBalance = this.currentBalance;
        }
        if (this.currentBalance > this.highWatermarkBalance) {
            this.highWatermarkBalance = this.currentBalance;
        }
        if (this.accountType === 'prop' && this.propFirmSettings && !this.isPropFirmBreached) {
            const maxDrawdownPct = this.propFirmSettings.maximum_drawdown || 10;
            const accountSize = this.propFirmSettings.account_size || this.initialBalance;
            const maxDrawdownAmount = this.propFirmSettings.daily_loss_limit_type === 'AMOUNT'
                ? maxDrawdownPct
                : (accountSize * maxDrawdownPct) / 100;
            if (this.propFirmSettings.drawdown_type === 'TRAILING') {
                const trailingFloor = this.highWatermarkBalance - maxDrawdownAmount;
                if (this.currentBalance <= trailingFloor || this.currentEquity <= trailingFloor) {
                    this.isPropFirmBreached = true;
                    this.propFirmBreachReason = `Trailing drawdown floor ($${trailingFloor.toFixed(2)}) breached. High watermark: $${this.highWatermarkBalance.toFixed(2)}, Current Balance: $${this.currentBalance.toFixed(2)}`;
                    this.propFirmBreachTimestamp = trade.exitTimestamp;
                }
            }
            else {
                const staticFloor = accountSize - maxDrawdownAmount;
                if (this.currentBalance <= staticFloor || this.currentEquity <= staticFloor) {
                    this.isPropFirmBreached = true;
                    this.propFirmBreachReason = `Static drawdown floor ($${staticFloor.toFixed(2)}) breached. Account size: $${accountSize}, Current Balance: $${this.currentBalance.toFixed(2)}`;
                    this.propFirmBreachTimestamp = trade.exitTimestamp;
                }
            }
        }
    }
    evaluateCandidate(candidate) {
        this.totalCandidatesEvaluated++;
        const candleTime = new Date(candidate.timestamp).getTime();
        const candleDate = new Date(candidate.timestamp);
        const dayKey = `${candleDate.getUTCFullYear()}-${String(candleDate.getUTCMonth() + 1).padStart(2, '0')}-${String(candleDate.getUTCDate()).padStart(2, '0')}`;
        if (this.currentDayUtc && this.currentDayUtc !== dayKey) {
            this.dailyClosedPnL = 0;
        }
        this.currentDayUtc = dayKey;
        if (this.enableMarketHours) {
            const marketSchedule = isMarketOpenHistorically(candidate.symbol, candidate.timestamp);
            if (!marketSchedule.isOpen) {
                this.recordRejection('marketHours', 'MARKET_HOURS', marketSchedule.reason, candidate);
                return {
                    passed: false,
                    blockedGate: 'MARKET_HOURS',
                    reason: marketSchedule.reason
                };
            }
        }
        if (this.enableSessions) {
            const strategySessions = candidate.strategyRules?.session;
            if (strategySessions && Array.isArray(strategySessions) && strategySessions.length > 0) {
                const activeSessions = getActiveMarketSessions(candidate.timestamp);
                const sessionCheck = evaluateSessionMatch(strategySessions, activeSessions);
                if (!sessionCheck.matched) {
                    this.recordRejection('sessionFilter', 'SESSION', sessionCheck.reason, candidate);
                    return {
                        passed: false,
                        blockedGate: 'SESSION',
                        reason: sessionCheck.reason
                    };
                }
            }
        }
        if (this.historicalNewsEvents.length > 0) {
            const bufferBeforeMs = 30 * 60 * 1000;
            const bufferAfterMs = 30 * 60 * 1000;
            const blockingEvent = this.historicalNewsEvents.find(ev => {
                if (ev.impact !== 'HIGH')
                    return false;
                const evTime = new Date(ev.timestamp).getTime();
                return candleTime >= (evTime - bufferBeforeMs) && candleTime <= (evTime + bufferAfterMs);
            });
            if (blockingEvent) {
                const newsReason = `Blocked by High-Impact Economic Event "${blockingEvent.title}" at ${blockingEvent.timestamp}`;
                this.recordRejection('economicNews', 'ECONOMIC_NEWS', newsReason, candidate);
                return {
                    passed: false,
                    blockedGate: 'ECONOMIC_NEWS',
                    reason: newsReason
                };
            }
        }
        if (this.enableQualityGate) {
            const qgResult = evaluateQualityGate({
                ruleScore: candidate.confidence,
                marketStructure: candidate.marketStructure || {},
                mandatoryRulesPassed: true,
                direction: candidate.direction,
                slValid: true,
                tpValid: true,
                rrValid: true,
                consecutiveLosses: this.consecutiveLosses,
                minQualityThreshold: candidate.strategyRules?.min_quality_threshold || 75
            });
            if (!qgResult.passed) {
                this.recordRejection('qualityGate', 'QUALITY_GATE', qgResult.reason, candidate);
                return {
                    passed: false,
                    blockedGate: 'QUALITY_GATE',
                    reason: qgResult.reason,
                    qualityGateResult: qgResult
                };
            }
        }
        if (this.enableCooldown && this.cooldownUntilTimestamp > 0) {
            if (candleTime < this.cooldownUntilTimestamp) {
                const remainingMinutes = Math.ceil((this.cooldownUntilTimestamp - candleTime) / (60 * 1000));
                const cdReason = this.cooldownReasonType === 'LOSS'
                    ? `Active 4-hour post-loss cooldown (${remainingMinutes} mins remaining)`
                    : `Active 5-minute post-trade cooldown (${remainingMinutes} mins remaining)`;
                this.recordRejection('cooldown', 'COOLDOWN', cdReason, candidate);
                return {
                    passed: false,
                    blockedGate: 'COOLDOWN',
                    reason: cdReason
                };
            }
        }
        if (this.enableRiskGovernor) {
            const estimatedDrawdownPercent = this.peakBalance > 0
                ? ((this.peakBalance - this.currentBalance) / this.peakBalance) * 100
                : 0;
            const expectancyR = this.totalTrades > 0 ? this.totalRealizedR / this.totalTrades : 0;
            const maxDailyLossAmount = this.initialBalance * 0.05;
            const governorResult = evaluateRiskGovernor({
                metrics: {
                    totalTrades: this.totalTrades,
                    winRate: this.totalTrades > 0 ? Math.round((this.consecutiveWins / this.totalTrades) * 100) : 50,
                    expectancyR,
                    consecutiveLosses: this.consecutiveLosses,
                    consecutiveWins: this.consecutiveWins,
                    totalRealizedR: this.totalRealizedR,
                    performanceByPair: {},
                    performanceBySetup: {},
                    sampleSizeTier: this.totalTrades >= GOVERNOR_THRESHOLDS.MIN_TRADES_ELIGIBLE ? 'ELIGIBLE' : (this.totalTrades >= GOVERNOR_THRESHOLDS.MIN_TRADES_WEAK ? 'WEAK' : 'INSUFFICIENT')
                },
                equityState: {
                    configuredCapital: this.initialBalance,
                    estimatedEquity: this.currentEquity,
                    estimatedDrawdownPercent,
                    dailyPnL: this.dailyClosedPnL,
                    maxDailyLossAmount
                },
                candidate: {
                    pair: candidate.symbol,
                    timeframe: candidate.timeframe,
                    qualityScore: candidate.confidence
                }
            });
            if (governorResult.status === 'NO_TRADE') {
                const govReason = `Risk Governor NO_TRADE: ${governorResult.reasonCodes.join(', ')} (${governorResult.explanation})`;
                this.recordRejection('riskGovernor', 'RISK_GOVERNOR', govReason, candidate);
                return {
                    passed: false,
                    blockedGate: 'RISK_GOVERNOR',
                    reason: govReason,
                    riskGovernorResult: governorResult
                };
            }
            else if (governorResult.status === 'RESTRICTED_SELECTIVITY') {
                if (candidate.confidence < 80) {
                    const govReason = `Risk Governor RESTRICTED_SELECTIVITY: Confidence (${candidate.confidence}%) is below strict 80% threshold. Reason: ${governorResult.reasonCodes.join(', ')}`;
                    this.recordRejection('riskGovernor', 'RISK_GOVERNOR', govReason, candidate);
                    return {
                        passed: false,
                        blockedGate: 'RISK_GOVERNOR',
                        reason: govReason,
                        riskGovernorResult: governorResult
                    };
                }
            }
        }
        if (this.enablePropFirm) {
            if (this.accountType === 'personal') {
            }
            else {
                if (!this.propFirmSettings) {
                    const missingReason = 'PROP_FIRM_SETTINGS_UNAVAILABLE: Account type is prop firm but no prop firm settings configured';
                    this.recordRejection('propFirm', 'PROP_FIRM', missingReason, candidate);
                    return {
                        passed: false,
                        blockedGate: 'PROP_FIRM',
                        reason: missingReason
                    };
                }
                if (this.isPropFirmBreached) {
                    const breachedReason = `PROP_FIRM_BREACHED: ${this.propFirmBreachReason}`;
                    this.recordRejection('propFirm', 'PROP_FIRM', breachedReason, candidate);
                    return {
                        passed: false,
                        blockedGate: 'PROP_FIRM',
                        reason: breachedReason
                    };
                }
                const accountSize = this.propFirmSettings.account_size || this.initialBalance;
                const dailyLossLimitRaw = this.propFirmSettings.daily_loss_limit || 5;
                const dailyLossLimitAmount = this.propFirmSettings.daily_loss_limit_type === 'AMOUNT'
                    ? dailyLossLimitRaw
                    : (accountSize * dailyLossLimitRaw) / 100;
                if (this.dailyClosedPnL < 0 && Math.abs(this.dailyClosedPnL) >= dailyLossLimitAmount) {
                    const dailyLossReason = `PROP_FIRM_DAILY_LOSS_LIMIT_EXCEEDED: Day closed loss (-$${Math.abs(this.dailyClosedPnL).toFixed(2)}) reached limit (-$${dailyLossLimitAmount.toFixed(2)})`;
                    this.recordRejection('propFirm', 'PROP_FIRM', dailyLossReason, candidate);
                    return {
                        passed: false,
                        blockedGate: 'PROP_FIRM',
                        reason: dailyLossReason
                    };
                }
            }
        }
        this.totalSignalsPassed++;
        return { passed: true };
    }
    recordRejection(gateKey, gateName, reason, candidate) {
        this.rejectionsByGate[gateKey]++;
        this.rejectionDetails.push({
            gate: gateName,
            reason,
            timestamp: candidate.timestamp,
            direction: candidate.direction
        });
    }
    getSummary() {
        const accountSize = this.propFirmSettings?.account_size || this.initialBalance;
        const maxDrawdownLimit = this.propFirmSettings?.maximum_drawdown || 10;
        const dailyLossLimit = this.propFirmSettings?.daily_loss_limit || 5;
        return {
            enabledGates: {
                marketHours: this.enableMarketHours,
                sessionFilter: this.enableSessions,
                economicNews: this.historicalNewsEvents.length > 0,
                qualityGate: this.enableQualityGate,
                riskGovernor: this.enableRiskGovernor,
                cooldown: this.enableCooldown,
                propFirm: this.enablePropFirm && this.accountType === 'prop'
            },
            gateExecutionOrder: [
                'MARKET_HOURS',
                'SESSION',
                'ECONOMIC_NEWS',
                'STRATEGY_EVALUATION',
                'QUALITY_GATE',
                'COOLDOWN',
                'RISK_GOVERNOR',
                'PROP_FIRM'
            ],
            totalCandidatesEvaluated: this.totalCandidatesEvaluated,
            totalSignalsPassed: this.totalSignalsPassed,
            rejectionsByGate: { ...this.rejectionsByGate },
            rejectionDetails: [...this.rejectionDetails],
            propFirmAudit: {
                accountType: this.accountType,
                settingsApplied: !!this.propFirmSettings,
                isBreached: this.isPropFirmBreached,
                breachReason: this.propFirmBreachReason || undefined,
                breachTimestamp: this.propFirmBreachTimestamp || undefined,
                dailyLossLimit,
                maxDailyLossEncountered: Math.round(this.maxDailyLossEncountered * 100) / 100,
                maxDrawdownLimit,
                maxDrawdownEncountered: Math.round(this.maxDrawdownEncounteredPercent * 100) / 100,
                drawdownType: this.propFirmSettings?.drawdown_type || 'STATIC'
            },
            economicNewsStatus: {
                status: this.historicalNewsEvents.length > 0 ? 'AVAILABLE' : 'NOT_AVAILABLE',
                message: this.historicalNewsEvents.length > 0
                    ? `${this.historicalNewsEvents.length} historical economic news events evaluated with ±30m buffers`
                    : 'Historical economic news calendar is not available for this run. Live economic news gate was unsimulated.',
                eventsLoaded: this.historicalNewsEvents.length
            },
            unsimulatableLiveChecks: [
                {
                    name: 'Live Broker Quote Freshness',
                    status: 'UNSIMULATABLE_IN_HISTORICAL_BACKTEST',
                    reason: 'Historical candle datasets do not contain millisecond tick latency or live broker quote staleness.'
                },
                {
                    name: 'Broker Account Leverage & Margin Availability',
                    status: 'UNSIMULATABLE_IN_HISTORICAL_BACKTEST',
                    reason: 'Live broker margin utilization varies with floating spreads, concurrent positions, and account tier.'
                },
                {
                    name: 'Live Execution Slippage & Broker Rejections',
                    status: 'UNSIMULATABLE_IN_HISTORICAL_BACKTEST',
                    reason: 'Live orders can be rejected by MT4/MT5/cTrader brokers or experience variable network slippage.'
                },
                {
                    name: 'External Telegram Notification Delivery',
                    status: 'UNSIMULATABLE_IN_HISTORICAL_BACKTEST',
                    reason: 'Historical simulations do not dispatch live external Telegram bot messages.'
                },
                {
                    name: 'External AI API Availability & Rate Limits',
                    status: 'UNSIMULATABLE_IN_HISTORICAL_BACKTEST',
                    reason: 'Historical backtester uses deterministic rules and does not query external Gemini API endpoints.'
                }
            ]
        };
    }
    getConsecutiveLosses() {
        return this.consecutiveLosses;
    }
    getConsecutiveWins() {
        return this.consecutiveWins;
    }
    getCooldownUntilTimestamp() {
        return this.cooldownUntilTimestamp;
    }
    getCooldownReasonType() {
        return this.cooldownReasonType;
    }
}
