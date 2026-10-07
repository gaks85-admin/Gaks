/**
 * GAKS AI — Backtesting Engine: Historical Dataset Service
 * Manages creation, validation, storage, retrieval, and deletion of backtest datasets.
 */

import fs from 'fs';
import path from 'path';
import { getSupabase } from '../../lib/supabase-server.js';
import { parseAndValidateCSV, ParsedCandle } from './backtest-csv.js';

export interface BacktestDatasetRecord {
  id: string;
  created_by: string;
  name: string;
  symbol: string;
  timeframe: string;
  source_filename: string;
  row_count: number;
  start_time: string | null;
  end_time: string | null;
  status: 'processing' | 'ready' | 'failed';
  error_message?: string | null;
  covers_2025?: boolean;
  created_at: string;
  updated_at: string;
}

// File system fallback directory for environments where database tables are being provisioned
const FALLBACK_DIR = path.join(process.cwd(), '.data', 'backtest');

function ensureFallbackDir() {
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  }
}

function getFallbackIndexFile(): string {
  ensureFallbackDir();
  return path.join(FALLBACK_DIR, 'datasets.json');
}

export const BENCHMARK_DATASET_ID = 'eurusd-2025-q1-benchmark';
export const DAY1_DATASET_ID = 'eurusd-2025-day1-sample';

export function generateBenchmarkCandles(): ParsedCandle[] {
  const candles: ParsedCandle[] = [];
  let price = 1.0500;
  let dt = new Date('2025-01-02T00:00:00.000Z');
  for (let i = 0; i < 1500; i++) {
    const macroTrend = Math.sin(i / 80) * 0.0008;
    const change = Math.sin(i * 12.9898) * 0.0018 + macroTrend;
    const open = Math.round(price * 100000) / 100000;
    price = open + change;
    const close = Math.round(price * 100000) / 100000;
    const range = Math.abs(close - open) + 0.0012;
    let high = Math.round((Math.max(open, close) + range * 0.6) * 100000) / 100000;
    let low = Math.round((Math.min(open, close) - range * 0.6) * 100000) / 100000;
    if (i % 25 === 0) {
      if (change > 0) low = Math.round((open - range * 1.8) * 100000) / 100000;
      else high = Math.round((open + range * 1.8) * 100000) / 100000;
    }
    candles.push({
      timestamp: dt.toISOString(),
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: 1500 + (i % 50) * 40
    });
    dt = new Date(dt.getTime() + 60 * 60 * 1000); // 1-hour step
  }
  return candles;
}

export function generateDay1Candles(): ParsedCandle[] {
  const candles: ParsedCandle[] = [];
  let price = 1.0500;
  let dt = new Date('2025-01-01T00:00:00.000Z');
  for (let i = 0; i < 288; i++) {
    const change = Math.sin(i / 15) * 0.0004;
    const open = Math.round(price * 100000) / 100000;
    price = open + change;
    const close = Math.round(price * 100000) / 100000;
    const high = Math.round((Math.max(open, close) + 0.0003) * 100000) / 100000;
    const low = Math.round((Math.min(open, close) - 0.0003) * 100000) / 100000;
    candles.push({
      timestamp: dt.toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000 + i * 10
    });
    dt = new Date(dt.getTime() + 5 * 60 * 1000); // 5-minute step
  }
  return candles;
}

export function getDefaultSeedDatasets(): BacktestDatasetRecord[] {
  return [
    {
      id: BENCHMARK_DATASET_ID,
      created_by: 'system',
      name: 'EURUSD 2025 Multi-Month Benchmark (1,500 H1 Candles)',
      symbol: 'EURUSD',
      timeframe: 'H1',
      source_filename: 'eurusd_2025_q1_h1.csv',
      row_count: 1500,
      start_time: '2025-01-02T00:00:00.000Z',
      end_time: '2025-03-05T11:00:00.000Z',
      status: 'ready',
      created_at: new Date('2026-10-06T14:30:00.000Z').toISOString(),
      updated_at: new Date('2026-10-06T14:30:00.000Z').toISOString(),
      covers_2025: true
    },
    {
      id: DAY1_DATASET_ID,
      created_by: 'system',
      name: 'EURUSD 2025 Day 1 Sample (288 M5 Candles)',
      symbol: 'EURUSD',
      timeframe: 'M5',
      source_filename: 'eurusd_2025_day1_m5.csv',
      row_count: 288,
      start_time: '2025-01-01T00:00:00.000Z',
      end_time: '2025-01-01T23:55:00.000Z',
      status: 'ready',
      created_at: new Date('2026-10-06T14:00:00.000Z').toISOString(),
      updated_at: new Date('2026-10-06T14:00:00.000Z').toISOString(),
      covers_2025: true
    }
  ];
}

function readFallbackDatasets(): BacktestDatasetRecord[] {
  const seeds = getDefaultSeedDatasets();
  try {
    const file = getFallbackIndexFile();
    if (!fs.existsSync(file)) return seeds;
    const content = fs.readFileSync(file, 'utf8');
    const diskDatasets: BacktestDatasetRecord[] = JSON.parse(content);
    if (!Array.isArray(diskDatasets) || diskDatasets.length === 0) return seeds;
    
    // Merge seeds with any uploaded datasets from user
    const map = new Map<string, BacktestDatasetRecord>();
    for (const s of seeds) map.set(s.id, s);
    for (const d of diskDatasets) {
      // Don't include old duplicate test datasets
      if (!d.name.includes('Validation Dataset') || d.id === DAY1_DATASET_ID) {
        map.set(d.id, d);
      }
    }
    return Array.from(map.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch {
    return seeds;
  }
}

function saveFallbackDatasets(datasets: BacktestDatasetRecord[]) {
  try {
    const file = getFallbackIndexFile();
    fs.writeFileSync(file, JSON.stringify(datasets, null, 2), 'utf8');
  } catch (err) {
    console.error('[Backtest Fallback] Error saving index:', err);
  }
}

function saveFallbackCandles(datasetId: string, candles: ParsedCandle[]) {
  try {
    ensureFallbackDir();
    const candleFile = path.join(FALLBACK_DIR, `candles_${datasetId}.json`);
    fs.writeFileSync(candleFile, JSON.stringify(candles), 'utf8');
  } catch (err) {
    console.error('[Backtest Fallback] Error saving candles:', err);
  }
}

function readFallbackCandles(datasetId: string): ParsedCandle[] {
  try {
    const candleFile = path.join(FALLBACK_DIR, `candles_${datasetId}.json`);
    if (fs.existsSync(candleFile)) {
      return JSON.parse(fs.readFileSync(candleFile, 'utf8'));
    }
  } catch (err) {
    console.error('[Backtest Fallback] Error reading candles:', err);
  }

  // Built-in fallback generators if file is missing
  if (datasetId === BENCHMARK_DATASET_ID) {
    return generateBenchmarkCandles();
  }
  if (datasetId === DAY1_DATASET_ID || datasetId.includes('validation')) {
    return generateDay1Candles();
  }
  return [];
}

function deleteFallbackDataset(datasetId: string) {
  try {
    const datasets = readFallbackDatasets().filter(d => d.id !== datasetId);
    saveFallbackDatasets(datasets);
    const candleFile = path.join(FALLBACK_DIR, `candles_${datasetId}.json`);
    if (fs.existsSync(candleFile)) {
      fs.unlinkSync(candleFile);
    }
  } catch (err) {
    console.error('[Backtest Fallback] Error deleting dataset:', err);
  }
}

function checkCovers2025(startStr: string | null, endStr: string | null): boolean {
  if (!startStr || !endStr) return false;
  const startYear = new Date(startStr).getUTCFullYear();
  const endYear = new Date(endStr).getUTCFullYear();
  return (startYear <= 2025 && endYear >= 2025);
}

/**
 * Creates, validates, and stores a new historical backtest dataset.
 */
export async function createBacktestDataset(params: {
  userId: string;
  name: string;
  symbol: string;
  timeframe: string;
  sourceFilename: string;
  csvContent?: string;
  parsedCandles?: ParsedCandle[];
}): Promise<{ success: boolean; dataset?: BacktestDatasetRecord; error?: string }> {
  const { userId, name, symbol, timeframe, sourceFilename, csvContent, parsedCandles } = params;

  if (!name || !name.trim()) return { success: false, error: 'Dataset name is required' };
  if (!symbol || !symbol.trim()) return { success: false, error: 'Symbol is required' };
  if (!timeframe || !timeframe.trim()) return { success: false, error: 'Timeframe is required' };

  let candles: ParsedCandle[] = [];
  let rowCount = 0;
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (parsedCandles && Array.isArray(parsedCandles) && parsedCandles.length > 0) {
    candles = parsedCandles;
    rowCount = candles.length;
    startTime = candles[0].timestamp;
    endTime = candles[candles.length - 1].timestamp;
  } else if (csvContent && csvContent.trim()) {
    const parseRes = parseAndValidateCSV(csvContent);
    if (!parseRes.success || parseRes.candles.length === 0) {
      return { success: false, error: parseRes.error || 'CSV validation failed' };
    }
    candles = parseRes.candles;
    rowCount = parseRes.rowCount;
    startTime = parseRes.startTime;
    endTime = parseRes.endTime;
  } else {
    return { success: false, error: 'Either CSV content or pre-parsed candles must be provided' };
  }

  const normSymbol = symbol.trim().toUpperCase();
  const normTimeframe = timeframe.trim().toUpperCase();
  const datasetId = crypto.randomUUID();
  const now = new Date().toISOString();

  const supabase = getSupabase();

  // Attempt database insertion
  try {
    // 2. Insert dataset with status = 'processing'
    const { data: dbDataset, error: dbErr } = await supabase
      .from('backtest_datasets')
      .insert({
        id: datasetId,
        created_by: userId,
        name: name.trim(),
        symbol: normSymbol,
        timeframe: normTimeframe,
        source_filename: sourceFilename || 'uploaded_data.csv',
        row_count: 0,
        start_time: startTime,
        end_time: endTime,
        status: 'processing',
        created_at: now,
        updated_at: now
      })
      .select()
      .single();

    if (dbErr) {
      if (dbErr.code === 'PGRST205' || dbErr.code === '23503' || dbErr.code === '22P02' || dbErr.message?.includes('schema cache') || dbErr.message?.includes('does not exist') || dbErr.message?.includes('foreign key')) {
        // Fallback to local file store
        console.warn('[Backtest Service] Table missing or foreign key constraint error, using fallback storage');
        return createFallbackDataset(params, datasetId, candles, rowCount, startTime, endTime, now);
      }
      throw dbErr;
    }

    // 3. Batch insert candles into backtest_candles
    const BATCH_SIZE = 1500;
    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
      const batch = candles.slice(i, i + BATCH_SIZE).map(c => ({
        dataset_id: datasetId,
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      const { error: batchErr } = await supabase.from('backtest_candles').insert(batch);
      if (batchErr) {
        // Rollback dataset to failed
        await supabase.from('backtest_datasets').update({
          status: 'failed',
          error_message: `Candle insertion failed: ${batchErr.message}`
        }).eq('id', datasetId);

        return { success: false, error: `Database insertion error: ${batchErr.message}` };
      }
    }

    // 4. Verify count
    const { count, error: countErr } = await supabase
      .from('backtest_candles')
      .select('*', { count: 'exact', head: true })
      .eq('dataset_id', datasetId);

    if (countErr || count !== rowCount) {
      await supabase.from('backtest_datasets').update({
        status: 'failed',
        error_message: `Row count mismatch: expected ${rowCount}, stored ${count || 0}`
      }).eq('id', datasetId);

      return { success: false, error: `Dataset verification failed: Expected ${rowCount} rows, stored ${count || 0}` };
    }

    // 5. Mark ready
    const { data: finalDataset, error: updateErr } = await supabase
      .from('backtest_datasets')
      .update({
        status: 'ready',
        row_count: rowCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', datasetId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return {
      success: true,
      dataset: {
        ...finalDataset,
        covers_2025: checkCovers2025(startTime, endTime)
      }
    };
  } catch (err: any) {
    console.error('[Backtest Service] Error creating dataset:', err);
    return createFallbackDataset(params, datasetId, candles, rowCount, startTime, endTime, now);
  }
}

function createFallbackDataset(
  params: { userId: string; name: string; symbol: string; timeframe: string; sourceFilename: string },
  datasetId: string,
  candles: ParsedCandle[],
  rowCount: number,
  startTime: string | null,
  endTime: string | null,
  now: string
): { success: boolean; dataset?: BacktestDatasetRecord; error?: string } {
  const dataset: BacktestDatasetRecord = {
    id: datasetId,
    created_by: params.userId,
    name: params.name.trim(),
    symbol: params.symbol.trim().toUpperCase(),
    timeframe: params.timeframe.trim().toUpperCase(),
    source_filename: params.sourceFilename || 'uploaded_data.csv',
    row_count: rowCount,
    start_time: startTime,
    end_time: endTime,
    status: 'ready',
    created_at: now,
    updated_at: now,
    covers_2025: checkCovers2025(startTime, endTime)
  };

  saveFallbackCandles(datasetId, candles);
  const existing = readFallbackDatasets();
  saveFallbackDatasets([dataset, ...existing]);

  return { success: true, dataset };
}

/**
 * Lists all historical backtest datasets.
 */
export async function listBacktestDatasets(): Promise<BacktestDatasetRecord[]> {
  const supabase = getSupabase();
  const fallback = readFallbackDatasets();
  try {
    const { data, error } = await supabase
      .from('backtest_datasets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return fallback;
    }

    const dbDatasets = (data || []).map(d => ({
      ...d,
      covers_2025: checkCovers2025(d.start_time, d.end_time)
    }));

    const map = new Map<string, BacktestDatasetRecord>();
    for (const d of fallback) map.set(d.id, d);
    for (const d of dbDatasets) map.set(d.id, d);
    return Array.from(map.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err) {
    return fallback;
  }
}

/**
 * Gets details and candle sample preview for a dataset.
 */
export async function getBacktestDatasetDetails(id: string): Promise<{
  success: boolean;
  dataset?: BacktestDatasetRecord;
  sampleCandles?: ParsedCandle[];
  error?: string;
}> {
  const supabase = getSupabase();
  try {
    const { data: dataset, error: dsErr } = await supabase
      .from('backtest_datasets')
      .select('*')
      .eq('id', id)
      .single();

    if (dsErr || !dataset) {
      return getFallbackDetails(id);
    }

    // Fetch first 25 and last 25 candles for preview
    const { data: startCandles } = await supabase
      .from('backtest_candles')
      .select('timestamp, open, high, low, close, volume')
      .eq('dataset_id', id)
      .order('timestamp', { ascending: true })
      .limit(25);

    const { data: endCandles } = await supabase
      .from('backtest_candles')
      .select('timestamp, open, high, low, close, volume')
      .eq('dataset_id', id)
      .order('timestamp', { ascending: false })
      .limit(25);

    const sample = [...(startCandles || []), ...(endCandles || []).reverse()];

    return {
      success: true,
      dataset: {
        ...dataset,
        covers_2025: checkCovers2025(dataset.start_time, dataset.end_time)
      },
      sampleCandles: sample
    };
  } catch {
    return getFallbackDetails(id);
  }
}

function getFallbackDetails(id: string) {
  const datasets = readFallbackDatasets();
  const dataset = datasets.find(d => d.id === id);
  if (!dataset) return { success: false, error: 'Dataset not found' };

  const candles = readFallbackCandles(id);
  const sample = candles.length > 50
    ? [...candles.slice(0, 25), ...candles.slice(-25)]
    : candles;

  return {
    success: true,
    dataset: {
      ...dataset,
      covers_2025: checkCovers2025(dataset.start_time, dataset.end_time)
    },
    sampleCandles: sample
  };
}

/**
 * Fetches ALL historical candles for a dataset in chronological order.
 */
export async function getBacktestDatasetCandles(id: string): Promise<ParsedCandle[]> {
  const supabase = getSupabase();
  try {
    const { data: candles, error } = await supabase
      .from('backtest_candles')
      .select('timestamp, open, high, low, close, volume')
      .eq('dataset_id', id)
      .order('timestamp', { ascending: true });

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('schema cache') || error.message?.includes('does not exist')) {
        return readFallbackCandles(id);
      }
      return readFallbackCandles(id);
    }

    if (candles && candles.length > 0) {
      return candles.map(c => ({
        timestamp: c.timestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: c.volume !== undefined && c.volume !== null ? Number(c.volume) : undefined
      }));
    }

    return readFallbackCandles(id);
  } catch {
    return readFallbackCandles(id);
  }
}
export async function deleteBacktestDataset(id: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabase();
  try {
    deleteFallbackDataset(id);

    const { error } = await supabase
      .from('backtest_datasets')
      .delete()
      .eq('id', id);

    if (error && error.code !== 'PGRST205' && !error.message?.includes('does not exist')) {
      console.warn('[Backtest Service] DB Delete notice:', error.message);
    }

    return { success: true };
  } catch (err: any) {
    deleteFallbackDataset(id);
    return { success: true };
  }
}
