/**
 * GAKS AI — Large Dataset Import & Column Normalization Utilities (Stage D3)
 * Provides chunked CSV parsing, automatic header identification, format normalization,
 * and SHA-256 dataset content hashing.
 */

import { ParsedCandle } from './backtest-csv.js';
import crypto from 'crypto';

export interface ColumnMapping {
  timestampIdx: number;
  openIdx: number;
  highIdx: number;
  lowIdx: number;
  closeIdx: number;
  volumeIdx: number;
  isSeparateTimeCol?: boolean;
  dateIdx?: number;
  timeIdx?: number;
}

export interface ChunkedParseOptions {
  lines: string[];
  startIndex: number;
  chunkSize: number;
  mapping: ColumnMapping;
  sourceTimezone?: string;
}

export interface ChunkedParseResult {
  candles: ParsedCandle[];
  processedLines: number;
  nextIndex: number;
  isComplete: boolean;
  errors: string[];
}

/**
 * Normalizes CSV headers or headerless lines to extract column indices.
 */
export function normalizeColumnMapping(headersOrFirstRow: string[]): { mapping: ColumnMapping | null; error?: string } {
  if (!headersOrFirstRow || headersOrFirstRow.length === 0) {
    return { mapping: null, error: 'Empty line provided for column mapping' };
  }

  const clean = headersOrFirstRow.map(h => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));

  let timestampIdx = -1;
  let dateIdx = -1;
  let timeIdx = -1;
  let openIdx = -1;
  let highIdx = -1;
  let lowIdx = -1;
  let closeIdx = -1;
  let volumeIdx = -1;

  // 1. Explicit Header Search
  for (let i = 0; i < clean.length; i++) {
    const h = clean[i];
    if (['timestamp', 'datetime', 'date_time', 'time_stamp', 'gmt time', 'ts'].includes(h)) {
      if (timestampIdx === -1) timestampIdx = i;
    } else if (['date', 'd', 'date(utc)'].includes(h)) {
      if (dateIdx === -1) dateIdx = i;
    } else if (['time', 't', 'time(utc)'].includes(h)) {
      if (timeIdx === -1) timeIdx = i;
    } else if (['open', 'o', 'open_price', 'openprice', 'bid_open', 'ask_open'].includes(h)) {
      if (openIdx === -1) openIdx = i;
    } else if (['high', 'h', 'high_price', 'highprice', 'bid_high', 'ask_high'].includes(h)) {
      if (highIdx === -1) highIdx = i;
    } else if (['low', 'l', 'low_price', 'lowprice', 'bid_low', 'ask_low'].includes(h)) {
      if (lowIdx === -1) lowIdx = i;
    } else if (['close', 'c', 'close_price', 'closeprice', 'bid_close', 'ask_close'].includes(h)) {
      if (closeIdx === -1) closeIdx = i;
    } else if (['volume', 'vol', 'v', 'vol_base', 'ticks'].includes(h)) {
      if (volumeIdx === -1) volumeIdx = i;
    }
  }

  // Handle separate Date and Time columns
  if (timestampIdx === -1 && dateIdx !== -1 && timeIdx !== -1) {
    timestampIdx = dateIdx;
  }

  // 2. Fallback for Headerless MT4 / HistData files
  if (timestampIdx === -1 || openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1) {
    const firstCol = clean[0];
    if (clean.length >= 5 && /^\d{4}/.test(firstCol)) {
      // Headerless format
      if (clean.length >= 7) {
        // Date, Time, Open, High, Low, Close, Volume
        return {
          mapping: {
            timestampIdx: 0,
            dateIdx: 0,
            timeIdx: 1,
            openIdx: 2,
            highIdx: 3,
            lowIdx: 4,
            closeIdx: 5,
            volumeIdx: 6,
            isSeparateTimeCol: true
          }
        };
      } else if (clean.length === 6) {
        if (!isNaN(parseFloat(clean[1]))) {
          // DateTime, Open, High, Low, Close, Volume
          return { mapping: { timestampIdx: 0, openIdx: 1, highIdx: 2, lowIdx: 3, closeIdx: 4, volumeIdx: 5 } };
        } else {
          // Date, Time, Open, High, Low, Close
          return {
            mapping: {
              timestampIdx: 0,
              dateIdx: 0,
              timeIdx: 1,
              openIdx: 2,
              highIdx: 3,
              lowIdx: 4,
              closeIdx: 5,
              volumeIdx: -1,
              isSeparateTimeCol: true
            }
          };
        }
      } else if (clean.length === 5) {
        // DateTime, Open, High, Low, Close
        return { mapping: { timestampIdx: 0, openIdx: 1, highIdx: 2, lowIdx: 3, closeIdx: 4, volumeIdx: -1 } };
      }
    }

    return {
      mapping: null,
      error: `Could not identify CSV column mapping from headers: [${clean.join(', ')}]`
    };
  }

  return {
    mapping: {
      timestampIdx,
      openIdx,
      highIdx,
      lowIdx,
      closeIdx,
      volumeIdx,
      isSeparateTimeCol: dateIdx !== -1 && timeIdx !== -1 && dateIdx !== timeIdx,
      dateIdx,
      timeIdx
    }
  };
}

/**
 * Parses a chunk of CSV lines without loading the full file into memory.
 */
export function parseCSVChunk(options: ChunkedParseOptions): ChunkedParseResult {
  const { lines, startIndex, chunkSize, mapping } = options;
  const candles: ParsedCandle[] = [];
  const errors: string[] = [];

  const endIndex = Math.min(startIndex + chunkSize, lines.length);

  for (let i = startIndex; i < endIndex; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    const cols = line.split(/[,;\t]/).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 5) continue;

    let rawTs = cols[mapping.timestampIdx];
    if (mapping.isSeparateTimeCol && mapping.dateIdx !== undefined && mapping.timeIdx !== undefined) {
      rawTs = `${cols[mapping.dateIdx]} ${cols[mapping.timeIdx]}`;
    }

    // Standardize timestamp
    let isoTs: string | null = null;
    try {
      let cleaned = rawTs;
      if (/^(\d{4})\.?(\d{2})\.?(\d{2})[ T](\d{2}):?(\d{2}):?(\d{2})?$/.test(cleaned)) {
        cleaned = cleaned.replace(/^(\d{4})\.?(\d{2})\.?(\d{2})[ T](\d{2}):?(\d{2}):?(\d{2})?$/, '$1-$2-$3T$4:$5:$6Z')
          .replace(':Z', ':00Z');
      }
      cleaned = cleaned.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(cleaned)) {
        cleaned = cleaned.replace(' ', 'T') + 'Z';
      }

      const d = new Date(cleaned);
      if (!isNaN(d.getTime())) {
        isoTs = d.toISOString();
      }
    } catch {
      isoTs = null;
    }

    if (!isoTs) {
      errors.push(`Line ${i + 1}: Invalid timestamp format "${rawTs}"`);
      continue;
    }

    const open = parseFloat(cols[mapping.openIdx]);
    const high = parseFloat(cols[mapping.highIdx]);
    const low = parseFloat(cols[mapping.lowIdx]);
    const close = parseFloat(cols[mapping.closeIdx]);
    const volRaw = mapping.volumeIdx !== -1 && mapping.volumeIdx < cols.length ? parseFloat(cols[mapping.volumeIdx]) : null;
    const volume = volRaw !== null && !isNaN(volRaw) && volRaw >= 0 ? volRaw : null;

    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      errors.push(`Line ${i + 1}: Invalid numeric price values`);
      continue;
    }

    candles.push({
      timestamp: isoTs,
      open,
      high,
      low,
      close,
      volume
    });
  }

  return {
    candles,
    processedLines: endIndex - startIndex,
    nextIndex: endIndex,
    isComplete: endIndex >= lines.length,
    errors
  };
}

/**
 * Calculates a canonical SHA-256 fingerprint for a dataset's candles.
 */
export function computeDatasetHash(candles: ParsedCandle[]): string {
  if (typeof window === 'undefined') {
    try {
      const hash = crypto.createHash('sha256');
      for (const c of candles) {
        hash.update(`${c.timestamp}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume || 0}\n`);
      }
      return hash.digest('hex');
    } catch {
      // fallback to pure JS hash below
    }
  }

  // Fast, deterministic 64-bit Murmur/FNV-style hash for browser execution
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (const c of candles) {
    const str = `${c.timestamp}|${c.open}|${c.high}|${c.low}|${c.close}|${c.volume || 0}\n`;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}
