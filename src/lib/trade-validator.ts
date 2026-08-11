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

  const isBuy = dir === 'BUY' || dir === 'LONG';
  const entry = watcher.entry_price !== null && watcher.entry_price !== undefined ? parseFloat(String(watcher.entry_price)) : NaN;
  const sl = watcher.stop_loss !== null && watcher.stop_loss !== undefined ? parseFloat(String(watcher.stop_loss)) : NaN;
  const tp = watcher.take_profit !== null && watcher.take_profit !== undefined ? parseFloat(String(watcher.take_profit)) : NaN;

  if (isNaN(entry) || !Number.isFinite(entry) || entry <= 0) {
    return { valid: false, reason: `Invalid entry price (${watcher.entry_price}). Must be finite and positive.` };
  }
  if (isNaN(sl) || !Number.isFinite(sl) || sl <= 0) {
    return { valid: false, reason: `Invalid stop loss (${watcher.stop_loss}). Must be finite and positive.` };
  }
  if (isNaN(tp) || !Number.isFinite(tp) || tp <= 0) {
    return { valid: false, reason: `Invalid take profit (${watcher.take_profit}). Must be finite and positive.` };
  }

  // BUY: SL < Entry < TP
  // SELL: TP < Entry < SL
  if (isBuy) {
    if (!(sl < entry && entry < tp)) {
      return { valid: false, reason: `Invalid BUY geometry: SL (${sl}) must be < Entry (${entry}) must be < TP (${tp}).` };
    }
  } else {
    if (!(tp < entry && entry < sl)) {
      return { valid: false, reason: `Invalid SELL geometry: TP (${tp}) must be < Entry (${entry}) must be < SL (${sl}).` };
    }
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
