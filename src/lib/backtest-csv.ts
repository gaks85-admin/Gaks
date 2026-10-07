/**
 * GAKS AI — Backtesting Engine: Historical CSV Parser & Validator
 * Provides strict parsing, validation, normalization, and integrity checks
 * for historical OHLC candle data.
 */

export interface ParsedCandle {
  timestamp: string; // ISO 8601 UTC string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface CSVParseResult {
  success: boolean;
  candles: ParsedCandle[];
  rowCount: number;
  startTime: string | null;
  endTime: string | null;
  covers2025: boolean;
  error?: string;
  warning?: string;
}

/**
 * Normalizes headers and identifies column indices for OHLCV data.
 */
function identifyHeaders(headerRow: string[]): {
  timestampIdx: number;
  openIdx: number;
  highIdx: number;
  lowIdx: number;
  closeIdx: number;
  volumeIdx: number;
  error?: string;
} {
  const headers = headerRow.map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));

  let timestampIdx = -1;
  let openIdx = -1;
  let highIdx = -1;
  let lowIdx = -1;
  let closeIdx = -1;
  let volumeIdx = -1;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (['timestamp', 'time', 'datetime', 'date', 'date_time', 'ts'].includes(h)) {
      if (timestampIdx === -1) timestampIdx = i;
    } else if (['open', 'o', 'open_price', 'openprice'].includes(h)) {
      if (openIdx === -1) openIdx = i;
    } else if (['high', 'h', 'high_price', 'highprice'].includes(h)) {
      if (highIdx === -1) highIdx = i;
    } else if (['low', 'l', 'low_price', 'lowprice'].includes(h)) {
      if (lowIdx === -1) lowIdx = i;
    } else if (['close', 'c', 'close_price', 'closeprice'].includes(h)) {
      if (closeIdx === -1) closeIdx = i;
    } else if (['volume', 'vol', 'v', 'vol_base'].includes(h)) {
      if (volumeIdx === -1) volumeIdx = i;
    }
  }

  const missing: string[] = [];
  if (timestampIdx === -1) missing.push('timestamp (time/datetime)');
  if (openIdx === -1) missing.push('open');
  if (highIdx === -1) missing.push('high');
  if (lowIdx === -1) missing.push('low');
  if (closeIdx === -1) missing.push('close');

  if (missing.length > 0) {
    return {
      timestampIdx, openIdx, highIdx, lowIdx, closeIdx, volumeIdx,
      error: `Missing required CSV headers: ${missing.join(', ')}. Found headers: [${headers.join(', ')}]`
    };
  }

  // Ensure unique mapping
  const indices = [timestampIdx, openIdx, highIdx, lowIdx, closeIdx];
  const uniqueIndices = new Set(indices);
  if (uniqueIndices.size < indices.length) {
    return {
      timestampIdx, openIdx, highIdx, lowIdx, closeIdx, volumeIdx,
      error: 'Ambiguous CSV headers: Multiple required fields mapped to the same column index.'
    };
  }

  return { timestampIdx, openIdx, highIdx, lowIdx, closeIdx, volumeIdx };
}

/**
 * Splits a CSV line safely, respecting quotes.
 */
function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses timestamp string into deterministic ISO UTC string.
 */
function parseTimestamp(rawTs: string): { iso: string | null; error?: string } {
  if (!rawTs) return { iso: null, error: 'Empty timestamp string' };

  let cleaned = rawTs.trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return { iso: null, error: 'Empty timestamp string' };

  // Handle compact HistData timestamps like "20250101 170000" or "2025.01.01 17:00"
  if (/^(\d{4})\.?(\d{2})\.?(\d{2})[ T](\d{2}):?(\d{2}):?(\d{2})?$/.test(cleaned)) {
    cleaned = cleaned.replace(/^(\d{4})\.?(\d{2})\.?(\d{2})[ T](\d{2}):?(\d{2}):?(\d{2})?$/, (match, y, m, d, hh, mm, ss) => {
      return `${y}-${m}-${d}T${hh}:${mm}:${ss || '00'}Z`;
    });
  }

  // Handle UNIX timestamp in seconds or milliseconds
  if (/^\d{10}$/.test(cleaned)) {
    const date = new Date(parseInt(cleaned, 10) * 1000);
    return { iso: date.toISOString() };
  }
  if (/^\d{13}$/.test(cleaned)) {
    const date = new Date(parseInt(cleaned, 10));
    return { iso: date.toISOString() };
  }

  // Handle date format like "2025.01.01 00:00:00" -> replace dots with dashes
  cleaned = cleaned.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');

  // If no timezone offset is present (e.g. "2025-01-01 00:00:00" or "2025-01-01T00:00:00")
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(' ', 'T') + 'Z';
  }

  const date = new Date(cleaned);
  if (isNaN(date.getTime())) {
    return { iso: null, error: `Invalid date format: "${rawTs}"` };
  }

  return { iso: date.toISOString() };
}

/**
 * Strictly parses and validates a CSV text input into normalized HistoricalCandles.
 */
export function parseAndValidateCSV(csvText: string): CSVParseResult {
  if (!csvText || !csvText.trim()) {
    return {
      success: false,
      candles: [],
      rowCount: 0,
      startTime: null,
      endTime: null,
      covers2025: false,
      error: 'CSV content is empty'
    };
  }

  const rawLines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  // Filter out commentary, copyright headers, and status report metadata (e.g. HistData status report lines)
  const lines = rawLines.filter(line => {
    const lower = line.toLowerCase();
    if (lower.startsWith('#') || lower.startsWith('//') || lower.startsWith('/*')) return false;
    if (
      lower.includes('histdata.com') || 
      lower.includes('gap of') || 
      lower.includes('status report') || 
      lower.startsWith('file:') ||
      lower.includes('tick interval')
    ) return false;
    return true;
  });

  if (lines.length === 0) {
    return {
      success: false,
      candles: [],
      rowCount: 0,
      startTime: null,
      endTime: null,
      covers2025: false,
      error: "This file is a HistData status report text file (~0.10 MB) rather than the candle data file. Please select the main CSV file 'DAT_MT_EURUSD_M1_2025.csv' (~30 MB) from your downloaded ZIP folder."
    };
  }

  const firstLineCols = splitCSVLine(lines[0]);
  let headerMap = identifyHeaders(firstLineCols);
  let startRowIndex = 1;
  let isSeparateTimeCol = false;

  if (headerMap.error) {
    // Check if line 0 is a headerless MetaTrader / HistData data row (starts with year digits e.g. 2025, 2024)
    const cleanedFirstCol = (firstLineCols[0] || '').trim().replace(/["']/g, '');
    if (firstLineCols.length >= 5 && /^\d{4}/.test(cleanedFirstCol)) {
      startRowIndex = 0; // Headerless file, start reading from row 0
      if (firstLineCols.length >= 7) {
        // Date, Time, Open, High, Low, Close, Volume
        headerMap = { timestampIdx: 0, openIdx: 2, highIdx: 3, lowIdx: 4, closeIdx: 5, volumeIdx: 6 };
        isSeparateTimeCol = true;
      } else if (firstLineCols.length === 6) {
        if (!isNaN(parseFloat(firstLineCols[1]))) {
          // Date+Time, Open, High, Low, Close, Volume
          headerMap = { timestampIdx: 0, openIdx: 1, highIdx: 2, lowIdx: 3, closeIdx: 4, volumeIdx: 5 };
        } else {
          // Date, Time, Open, High, Low, Close
          headerMap = { timestampIdx: 0, openIdx: 2, highIdx: 3, lowIdx: 4, closeIdx: 5, volumeIdx: -1 };
          isSeparateTimeCol = true;
        }
      } else if (firstLineCols.length === 5) {
        // Date+Time, Open, High, Low, Close
        headerMap = { timestampIdx: 0, openIdx: 1, highIdx: 2, lowIdx: 3, closeIdx: 4, volumeIdx: -1 };
      }
    } else {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: headerMap.error
      };
    }
  }

  const candles: ParsedCandle[] = [];
  const timestampSet = new Set<string>();

  for (let rowIndex = startRowIndex; rowIndex < lines.length; rowIndex++) {
    const line = lines[rowIndex];
    if (!line) continue;

    const cols = splitCSVLine(line);
    const rowNum = rowIndex + 1;

    let rawTs = cols[headerMap.timestampIdx];
    if (isSeparateTimeCol && cols.length > 1) {
      rawTs = `${cols[0]} ${cols[1]}`;
    }
    const rawOpen = cols[headerMap.openIdx];
    const rawHigh = cols[headerMap.highIdx];
    const rawLow = cols[headerMap.lowIdx];
    const rawClose = cols[headerMap.closeIdx];
    const rawVol = headerMap.volumeIdx !== -1 ? cols[headerMap.volumeIdx] : null;

    if (!rawTs || rawOpen === undefined || rawHigh === undefined || rawLow === undefined || rawClose === undefined) {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: `Row ${rowNum}: Missing required field(s)`
      };
    }

    // Parse timestamp
    const tsResult = parseTimestamp(rawTs);
    if (tsResult.error || !tsResult.iso) {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: `Row ${rowNum}: ${tsResult.error}`
      };
    }

    const timestamp = tsResult.iso;

    // Deduplicate duplicate timestamps from DST transitions / broker overlaps
    if (timestampSet.has(timestamp)) {
      continue;
    }
    timestampSet.add(timestamp);

    // Parse numbers
    const cleanOpenStr = rawOpen.trim().replace(/^["']|["']$/g, '');
    const cleanHighStr = rawHigh.trim().replace(/^["']|["']$/g, '');
    const cleanLowStr = rawLow.trim().replace(/^["']|["']$/g, '');
    const cleanCloseStr = rawClose.trim().replace(/^["']|["']$/g, '');

    const open = Number(cleanOpenStr);
    const high = Number(cleanHighStr);
    const low = Number(cleanLowStr);
    const close = Number(cleanCloseStr);
    let volume: number | null = null;

    if (rawVol !== null && rawVol !== undefined && rawVol.trim() !== '') {
      const cleanVolStr = rawVol.trim().replace(/^["']|["']$/g, '');
      const parsedVol = Number(cleanVolStr);
      if (isNaN(parsedVol) || !isFinite(parsedVol) || parsedVol < 0) {
        return {
          success: false,
          candles: [],
          rowCount: 0,
          startTime: null,
          endTime: null,
          covers2025: false,
          error: `Row ${rowNum}: Invalid volume value "${rawVol}"`
        };
      }
      volume = parsedVol;
    }

    // Validate numeric non-NaN, non-Infinity, non-negative
    if (cleanOpenStr === '' || isNaN(open) || !isFinite(open) || open < 0) {
      return { success: false, candles: [], rowCount: 0, startTime: null, endTime: null, covers2025: false, error: `Row ${rowNum}: Invalid open price "${rawOpen}"` };
    }
    if (cleanHighStr === '' || isNaN(high) || !isFinite(high) || high < 0) {
      return { success: false, candles: [], rowCount: 0, startTime: null, endTime: null, covers2025: false, error: `Row ${rowNum}: Invalid high price "${rawHigh}"` };
    }
    if (cleanLowStr === '' || isNaN(low) || !isFinite(low) || low < 0) {
      return { success: false, candles: [], rowCount: 0, startTime: null, endTime: null, covers2025: false, error: `Row ${rowNum}: Invalid low price "${rawLow}"` };
    }
    if (cleanCloseStr === '' || isNaN(close) || !isFinite(close) || close < 0) {
      return { success: false, candles: [], rowCount: 0, startTime: null, endTime: null, covers2025: false, error: `Row ${rowNum}: Invalid close price "${rawClose}"` };
    }

    // OHLC Integrity Rules
    // high >= max(open, close)
    // low <= min(open, close)
    // high >= low
    const maxOC = Math.max(open, close);
    const minOC = Math.min(open, close);

    // Use floating precision tolerance (1e-7)
    if (high < maxOC - 1e-7) {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: `Row ${rowNum}: High price (${high}) is less than max(open, close) (${maxOC})`
      };
    }
    if (low > minOC + 1e-7) {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: `Row ${rowNum}: Low price (${low}) is greater than min(open, close) (${minOC})`
      };
    }
    if (high < low - 1e-7) {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: `Row ${rowNum}: High price (${high}) is less than low price (${low})`
      };
    }

    timestampSet.add(timestamp);
    candles.push({
      timestamp,
      open,
      high,
      low,
      close,
      volume
    });
  }

  if (candles.length === 0) {
    return {
      success: false,
      candles: [],
      rowCount: 0,
      startTime: null,
      endTime: null,
      covers2025: false,
      error: 'No valid data rows found in CSV'
    };
  }

  // Sort candles chronologically by timestamp
  candles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Post-sort verification of strictly increasing timestamps
  for (let i = 1; i < candles.length; i++) {
    const prevTs = new Date(candles[i - 1].timestamp).getTime();
    const currTs = new Date(candles[i].timestamp).getTime();
    if (currTs === prevTs) {
      return {
        success: false,
        candles: [],
        rowCount: 0,
        startTime: null,
        endTime: null,
        covers2025: false,
        error: `Duplicate timestamp detected after sorting: ${candles[i].timestamp}`
      };
    }
  }

  const startTime = candles[0].timestamp;
  const endTime = candles[candles.length - 1].timestamp;

  // Check 2025 Coverage:
  // Starts on or before Jan 10, 2025 and ends on or after Dec 20, 2025, or spans entire 2025
  const startYear = new Date(startTime).getUTCFullYear();
  const endYear = new Date(endTime).getUTCFullYear();
  const covers2025 = (startYear <= 2025 && endYear >= 2025);

  return {
    success: true,
    candles,
    rowCount: candles.length,
    startTime,
    endTime,
    covers2025
  };
}
