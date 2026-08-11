import { validateTradeGeometry } from './trade-geometry-validator.js';

export interface ActiveTradeValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateActiveTradeState(watcher: {
  trade_status?: string | null;
  direction?: string | null;
  entry_price?: number | string | null;
  stop_loss?: number | string | null;
  take_profit?: number | string | null;
}): ActiveTradeValidationResult {
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
    minRr: 0.1 // lenient min R:R for active state check, focus on geometry
  });

  if (!geoResult.valid) {
    return { valid: false, reason: geoResult.reason };
  }

  return { valid: true };
}

export function isWatcherDue(
  watcher: {
    last_scan_at?: string | null;
    selected_timeframe?: string | null;
  },
  now: Date = new Date(),
  scanIntervalMinutes: number = 60,
  graceMs: number = 30000
): { isDue: boolean; reason: string; nextScanDate: Date | null } {
  let lastScanDate: Date | null = null;
  if (watcher.last_scan_at) {
    const parsed = new Date(watcher.last_scan_at);
    if (!isNaN(parsed.getTime())) {
      lastScanDate = parsed;
    }
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
