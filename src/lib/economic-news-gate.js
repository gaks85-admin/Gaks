import { EconomicEventService } from './economic-event-service.js';
export async function evaluateEconomicNewsGate(options) {
    const { accountType, symbol, newsRestrictionEnabled, service, supabase, nowOverride, suppressLogs = false } = options;
    const defaultBefore = accountType === 'personal' ? 30 : 5;
    const defaultAfter = accountType === 'personal' ? 30 : 5;
    const bufferBefore = typeof options.bufferBeforeMinutes === 'number' && Number.isFinite(options.bufferBeforeMinutes) && options.bufferBeforeMinutes >= 0
        ? options.bufferBeforeMinutes
        : defaultBefore;
    const bufferAfter = typeof options.bufferAfterMinutes === 'number' && Number.isFinite(options.bufferAfterMinutes) && options.bufferAfterMinutes >= 0
        ? options.bufferAfterMinutes
        : defaultAfter;
    const accountTypeLabel = accountType === 'personal' ? 'PERSONAL' : 'PROP FIRM';
    if (!newsRestrictionEnabled) {
        if (!suppressLogs) {
            console.log(`\n[ECONOMIC NEWS GATE]\nAccount Type: ${accountTypeLabel}\nSymbol: ${symbol}\nStatus: CLEAR\nRelevant Event: None\nBuffer: ${bufferBefore}m before / ${bufferAfter}m after\n`);
        }
        return {
            status: 'CLEAR',
            allowed: true,
            accountType,
            symbol,
            bufferBeforeMinutes: bufferBefore,
            bufferAfterMinutes: bufferAfter,
            newsGateResult: {
                eventDetected: false,
                tradeBlocked: false
            }
        };
    }
    try {
        const newsService = service || new EconomicEventService(undefined, supabase);
        newsService.setWindows(bufferBefore, bufferAfter);
        const rawResult = await newsService.checkNewsHardPause(symbol, bufferBefore, bufferAfter, nowOverride);
        if (!rawResult) {
            if (!suppressLogs) {
                console.log(`\n[ECONOMIC NEWS GATE]\nAccount Type: ${accountTypeLabel}\nStatus: UNAVAILABLE\nAction: FAIL CLOSED\n`);
            }
            return {
                status: 'UNAVAILABLE',
                allowed: false,
                accountType,
                symbol,
                bufferBeforeMinutes: bufferBefore,
                bufferAfterMinutes: bufferAfter,
                blockReason: 'NEWS_RESTRICTION_UNAVAILABLE',
                newsGateResult: {
                    eventDetected: false,
                    tradeBlocked: true,
                    blockReason: 'NEWS_RESTRICTION_UNAVAILABLE'
                }
            };
        }
        if (rawResult.tradeBlocked && !rawResult.eventDetected) {
            if (!suppressLogs) {
                console.log(`\n[ECONOMIC NEWS GATE]\nAccount Type: ${accountTypeLabel}\nStatus: UNAVAILABLE\nAction: FAIL CLOSED\n`);
            }
            return {
                status: 'UNAVAILABLE',
                allowed: false,
                accountType,
                symbol,
                bufferBeforeMinutes: bufferBefore,
                bufferAfterMinutes: bufferAfter,
                blockReason: 'NEWS_RESTRICTION_UNAVAILABLE',
                newsGateResult: {
                    eventDetected: false,
                    tradeBlocked: true,
                    blockReason: 'NEWS_RESTRICTION_UNAVAILABLE'
                }
            };
        }
        if (rawResult.tradeBlocked && rawResult.eventDetected) {
            const blockReason = accountType === 'personal'
                ? 'PERSONAL_NEWS_RESTRICTION'
                : (rawResult.blockReason || 'PROP_FIRM_NEWS_RESTRICTION');
            if (!suppressLogs) {
                console.log(`\n[ECONOMIC NEWS GATE]\nAccount Type: ${accountTypeLabel}\nSymbol: ${symbol}\nStatus: BLOCKED\nEvent: ${rawResult.eventName || 'N/A'}\nCurrency: ${rawResult.currency || 'N/A'}\nScheduled: ${rawResult.scheduledAt || 'N/A'}\nBuffer: ${bufferBefore}m before / ${bufferAfter}m after\nReason: ${blockReason}\n`);
            }
            return {
                status: 'BLOCKED',
                allowed: false,
                accountType,
                symbol,
                bufferBeforeMinutes: bufferBefore,
                bufferAfterMinutes: bufferAfter,
                eventName: rawResult.eventName,
                currency: rawResult.currency,
                scheduledAt: rawResult.scheduledAt,
                blockReason,
                newsGateResult: {
                    ...rawResult,
                    tradeBlocked: true,
                    blockReason
                }
            };
        }
        if (!suppressLogs) {
            console.log(`\n[ECONOMIC NEWS GATE]\nAccount Type: ${accountTypeLabel}\nSymbol: ${symbol}\nStatus: CLEAR\nRelevant Event: None\nBuffer: ${bufferBefore}m before / ${bufferAfter}m after\n`);
        }
        return {
            status: 'CLEAR',
            allowed: true,
            accountType,
            symbol,
            bufferBeforeMinutes: bufferBefore,
            bufferAfterMinutes: bufferAfter,
            newsGateResult: {
                eventDetected: false,
                tradeBlocked: false
            }
        };
    }
    catch (err) {
        if (!suppressLogs) {
            console.log(`\n[ECONOMIC NEWS GATE]\nAccount Type: ${accountTypeLabel}\nStatus: UNAVAILABLE\nAction: FAIL CLOSED\n`);
        }
        return {
            status: 'UNAVAILABLE',
            allowed: false,
            accountType,
            symbol,
            bufferBeforeMinutes: bufferBefore,
            bufferAfterMinutes: bufferAfter,
            blockReason: 'NEWS_RESTRICTION_UNAVAILABLE',
            newsGateResult: {
                eventDetected: false,
                tradeBlocked: true,
                blockReason: 'NEWS_RESTRICTION_UNAVAILABLE'
            }
        };
    }
}
