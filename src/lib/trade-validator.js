import { validateTradeGeometry } from './trade-geometry-validator.js';
export function validateActiveTradeState(watcher) {
    const tradeStatus = (watcher.trade_status || '').toUpperCase().trim();
    if (tradeStatus !== 'ACTIVE') {
        return { valid: true };
    }
    const dir = (watcher.direction || '').toUpperCase().trim();
    if (dir === 'NO_TRADE' || !dir || (dir !== 'BUY' && dir !== 'SELL' && dir !== 'LONG' && dir !== 'SHORT')) {
        return { valid: false, reason: `Invalid or missing direction ('${watcher.direction}'). Must be BUY or SELL (NO_TRADE is not valid for ACTIVE state).` };
    }
    const normalizedDir = dir === 'LONG' ? 'BUY' : (dir === 'SHORT' ? 'SELL' : dir);
    const entry = watcher.entry_price !== null && watcher.entry_price !== undefined ? parseFloat(String(watcher.entry_price)) : NaN;
    const sl = watcher.stop_loss !== null && watcher.stop_loss !== undefined ? parseFloat(String(watcher.stop_loss)) : NaN;
    const tp = watcher.take_profit !== null && watcher.take_profit !== undefined ? parseFloat(String(watcher.take_profit)) : NaN;
    const geoResult = validateTradeGeometry({
        symbol: 'ACTIVE_TRADE',
        direction: normalizedDir,
        entryPrice: entry,
        stopLoss: sl,
        takeProfit: tp,
        minRr: 0.1
    });
    if (!geoResult.valid) {
        return { valid: false, reason: geoResult.reason };
    }
    return { valid: true };
}
export function isWatcherDue(watcher, now = new Date(), scanIntervalMinutes = 60, graceMs = 30000) {
    const tradeStatus = (watcher.trade_status || '').toUpperCase().trim();
    let lastScanDate = null;
    if (watcher.last_scan_at) {
        const parsed = new Date(watcher.last_scan_at);
        if (!isNaN(parsed.getTime())) {
            lastScanDate = parsed;
        }
    }
    if (tradeStatus === 'ACTIVE') {
        if (lastScanDate && (now.getTime() - lastScanDate.getTime() < 5000)) {
            return { isDue: false, reason: 'Active trade scanned less than 5s ago', nextScanDate: new Date(lastScanDate.getTime() + 5000) };
        }
        return { isDue: true, reason: 'Active trade eligible for immediate price monitoring', nextScanDate: null };
    }
    if (!lastScanDate) {
        return { isDue: true, reason: 'Never scanned (eligible immediately)', nextScanDate: null };
    }
    const nextScanDate = new Date(lastScanDate.getTime() + scanIntervalMinutes * 60 * 1000);
    const threshold = nextScanDate.getTime() - graceMs;
    if (now.getTime() >= threshold) {
        const reason = now.getTime() >= nextScanDate.getTime() ? 'Scan time reached or overdue' : 'Within SCAN_DUE_GRACE_MS grace window';
        return { isDue: true, reason, nextScanDate };
    }
    return { isDue: false, reason: 'Not due yet (outside grace window)', nextScanDate };
}
