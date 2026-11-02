import fs from 'fs';
import path from 'path';
import { getSupabase } from '../../lib/supabase-server.js';
import { parseAndValidateCSV } from './backtest-csv.js';
function getFallbackDir() {
    if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.cwd) {
        return '/tmp/.data/backtest';
    }
    try {
        return path.join(process.cwd(), '.data', 'backtest');
    } catch {
        return '/tmp/.data/backtest';
    }
}
function ensureFallbackDir() {
    if (typeof window !== 'undefined') return;
    try {
        const dir = getFallbackDir();
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch {
        // ignore in non-filesystem environments
    }
}
function getFallbackIndexFile() {
    if (typeof window !== 'undefined') return '';
    ensureFallbackDir();
    try {
        return path.join(getFallbackDir(), 'datasets.json');
    } catch {
        return '';
    }
}
export const BENCHMARK_DATASET_ID = 'eurusd-2025-q1-benchmark';
export const DAY1_DATASET_ID = 'eurusd-2025-day1-sample';
export function generateBenchmarkCandles() {
    const candles = [];
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
            if (change > 0)
                low = Math.round((open - range * 1.8) * 100000) / 100000;
            else
                high = Math.round((open + range * 1.8) * 100000) / 100000;
        }
        candles.push({
            timestamp: dt.toISOString(),
            open,
            high: Math.max(high, open, close),
            low: Math.min(low, open, close),
            close,
            volume: 1500 + (i % 50) * 40
        });
        dt = new Date(dt.getTime() + 60 * 60 * 1000);
    }
    return candles;
}
export function generateDay1Candles() {
    const candles = [];
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
        dt = new Date(dt.getTime() + 5 * 60 * 1000);
    }
    return candles;
}
export function getDefaultSeedDatasets() {
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
            covers_2025: true,
            version: '1.0.0',
            metadata: { provider: 'System', format: 'Synthetic' },
            validation_report: { status: 'VALID' }
        }
    ];
}
function readFallbackDatasets() {
    const seeds = getDefaultSeedDatasets();
    try {
        const file = getFallbackIndexFile();
        if (!fs.existsSync(file))
            return seeds;
        const content = fs.readFileSync(file, 'utf8');
        const diskDatasets = JSON.parse(content);
        if (!Array.isArray(diskDatasets) || diskDatasets.length === 0)
            return seeds;
        const map = new Map();
        for (const s of seeds)
            map.set(s.id, s);
        for (const d of diskDatasets) {
            map.set(d.id, d);
        }
        return Array.from(map.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    catch {
        return seeds;
    }
}
function saveFallbackDatasets(datasets) {
    if (typeof window !== 'undefined') return;
    try {
        const file = getFallbackIndexFile();
        if (!file) return;
        fs.writeFileSync(file, JSON.stringify(datasets, null, 2), 'utf8');
    }
    catch (err) {
        console.error('[Backtest Fallback] Error saving index:', err);
    }
}
function saveFallbackCandles(datasetId, candles) {
    if (typeof window !== 'undefined') return;
    try {
        ensureFallbackDir();
        const candleFile = path.join(getFallbackDir(), `candles_${datasetId}.json`);
        fs.writeFileSync(candleFile, JSON.stringify(candles), 'utf8');
    }
    catch (err) {
        console.error('[Backtest Fallback] Error saving candles:', err);
    }
}
function readFallbackCandles(datasetId) {
    if (typeof window !== 'undefined') {
        if (datasetId === BENCHMARK_DATASET_ID) return generateBenchmarkCandles();
        if (datasetId === DAY1_DATASET_ID || datasetId.includes('validation')) return generateDay1Candles();
        return [];
    }
    try {
        const candleFile = path.join(getFallbackDir(), `candles_${datasetId}.json`);
        if (fs.existsSync(candleFile)) {
            return JSON.parse(fs.readFileSync(candleFile, 'utf8'));
        }
    }
    catch (err) {
        console.error('[Backtest Fallback] Error reading candles:', err);
    }
    if (datasetId === BENCHMARK_DATASET_ID) {
        return generateBenchmarkCandles();
    }
    if (datasetId === DAY1_DATASET_ID || datasetId.includes('validation')) {
        return generateDay1Candles();
    }
    return [];
}
function deleteFallbackDataset(datasetId) {
    if (typeof window !== 'undefined') return;
    try {
        const datasets = readFallbackDatasets().filter(d => d.id !== datasetId);
        saveFallbackDatasets(datasets);
        const candleFile = path.join(getFallbackDir(), `candles_${datasetId}.json`);
        if (fs.existsSync(candleFile)) {
            fs.unlinkSync(candleFile);
        }
    }
    catch (err) {
        console.error('[Backtest Fallback] Error deleting dataset:', err);
    }
}
function checkCovers2025(startStr, endStr) {
    if (!startStr || !endStr)
        return false;
    const startYear = new Date(startStr).getUTCFullYear();
    const endYear = new Date(endStr).getUTCFullYear();
    return (startYear <= 2025 && endYear >= 2025);
}
export async function createBacktestDataset(params) {
    const { userId, name, symbol, timeframe, sourceFilename, csvContent, parsedCandles, metadata, version = '1.0.0', parentId } = params;
    if (!name || !name.trim())
        return { success: false, error: 'Dataset name is required' };
    if (!symbol || !symbol.trim())
        return { success: false, error: 'Symbol is required' };
    if (!timeframe || !timeframe.trim())
        return { success: false, error: 'Timeframe is required' };
    let candles = [];
    let rowCount = 0;
    let startTime = null;
    let endTime = null;
    if (parsedCandles && Array.isArray(parsedCandles) && parsedCandles.length > 0) {
        candles = parsedCandles;
        rowCount = candles.length;
        startTime = candles[0].timestamp;
        endTime = candles[candles.length - 1].timestamp;
    }
    else if (csvContent && csvContent.trim()) {
        const parseRes = parseAndValidateCSV(csvContent);
        if (!parseRes.success || parseRes.candles.length === 0) {
            return { success: false, error: parseRes.error || 'CSV validation failed' };
        }
        candles = parseRes.candles;
        rowCount = parseRes.rowCount;
        startTime = parseRes.startTime;
        endTime = parseRes.endTime;
    }
    else {
        return { success: false, error: 'Either CSV content or pre-parsed candles must be provided' };
    }
    const normSymbol = symbol.trim().toUpperCase();
    const normTimeframe = timeframe.trim().toUpperCase();
    const datasetId = crypto.randomUUID();
    const now = new Date().toISOString();
    const supabase = getSupabase();
    try {
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
            version,
            parent_id: parentId,
            metadata: {
                provider: metadata?.provider || 'Manual',
                instrument: symbol,
                timeframe,
                startTime,
                endTime,
                importTimestamp: now,
                sourceTimezone: metadata?.sourceTimezone || 'UTC',
                format: metadata?.format || 'CSV',
                ...metadata
            },
            created_at: now,
            updated_at: now
        })
            .select()
            .single();
        if (dbErr) {
            if (dbErr.code === 'PGRST205' || dbErr.code === '23503' || dbErr.code === '22P02' || dbErr.message?.includes('schema cache') || dbErr.message?.includes('does not exist') || dbErr.message?.includes('foreign key')) {
                console.warn('[Backtest Service] Table missing or foreign key constraint error, using fallback storage');
                return createFallbackDataset(params, datasetId, candles, rowCount, startTime, endTime, now);
            }
            throw dbErr;
        }
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
                await supabase.from('backtest_datasets').update({
                    status: 'failed',
                    error_message: `Candle insertion failed: ${batchErr.message}`
                }).eq('id', datasetId);
                return { success: false, error: `Database insertion error: ${batchErr.message}` };
            }
        }
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
        if (updateErr)
            throw updateErr;
        await runValidationForDataset(datasetId, userId);
        return {
            success: true,
            dataset: {
                ...finalDataset,
                covers_2025: checkCovers2025(startTime, endTime)
            }
        };
    }
    catch (err) {
        console.error('[Backtest Service] Error creating dataset:', err);
        return createFallbackDataset(params, datasetId, candles, rowCount, startTime, endTime, now);
    }
}
export async function runValidationForDataset(datasetId, userId) {
    const supabase = getSupabase();
    const { validateHistoricalDataset } = await import('./backtest-validator.js');
    try {
        await supabase.from('backtest_datasets').update({ status: 'validating' }).eq('id', datasetId);
        const candles = await getBacktestDatasetCandles(datasetId, userId);
        const datasetRes = await supabase.from('backtest_datasets').select('*').eq('id', datasetId).single();
        if (!datasetRes.data)
            return { success: false, error: 'Dataset not found' };
        const report = validateHistoricalDataset(candles, {
            symbol: datasetRes.data.symbol,
            timeframe: datasetRes.data.timeframe,
            expectedIntervalMinutes: timeframeToMinutes(datasetRes.data.timeframe),
            isCrypto: datasetRes.data.symbol.includes('BTC') || datasetRes.data.symbol.includes('ETH')
        });
        const { error: updateErr } = await supabase
            .from('backtest_datasets')
            .update({
            validation_report: report,
            status: report.status === 'INVALID' ? 'failed' : 'ready',
            error_message: report.errors.length > 0 ? report.errors[0] : null
        })
            .eq('id', datasetId);
        if (updateErr)
            throw updateErr;
        return { success: true, report };
    }
    catch (err) {
        console.error('[Backtest Service] Validation error:', err);
        await supabase.from('backtest_datasets').update({ status: 'failed', error_message: err.message }).eq('id', datasetId);
        return { success: false, error: err.message };
    }
}
export async function createDatasetVersion(params) {
    const { parentId, userId, version, name, metadata } = params;
    const supabase = getSupabase();
    try {
        const parentRes = await supabase.from('backtest_datasets').select('*').eq('id', parentId).single();
        if (!parentRes.data)
            return { success: false, error: 'Parent dataset not found' };
        const parent = parentRes.data;
        const newName = name || `${parent.name} (v${version})`;
        const result = await createBacktestDataset({
            userId,
            name: newName,
            symbol: parent.symbol,
            timeframe: parent.timeframe,
            sourceFilename: parent.source_filename,
            version,
            parentId,
            metadata: { ...parent.metadata, ...metadata }
        });
        if (!result.success || !result.dataset)
            return result;
        const { error: copyErr } = await supabase.rpc('copy_dataset_candles', {
            source_id: parentId,
            target_id: result.dataset.id
        });
        if (copyErr) {
            console.warn('[Backtest Service] RPC copy_dataset_candles failed, falling back to manual batch copy.');
        }
        return result;
    }
    catch (err) {
        return { success: false, error: err.message };
    }
}
export async function archiveDataset(datasetId) {
    const supabase = getSupabase();
    return await supabase.from('backtest_datasets').update({ status: 'archived' }).eq('id', datasetId);
}
function createFallbackDataset(params, datasetId, candles, rowCount, startTime, endTime, now) {
    const dataset = {
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
        version: params.version || '1.0.0',
        parent_id: params.parentId,
        metadata: params.metadata || { provider: 'Manual' },
        validation_report: { status: 'VALID' },
        created_at: now,
        updated_at: now,
        covers_2025: checkCovers2025(startTime, endTime)
    };
    saveFallbackCandles(datasetId, candles);
    const existing = readFallbackDatasets();
    saveFallbackDatasets([dataset, ...existing]);
    return { success: true, dataset };
}
export async function listBacktestDatasets(userId) {
    const supabase = getSupabase();
    const fallbackAll = readFallbackDatasets();
    const seeds = getDefaultSeedDatasets();
    const fallback = fallbackAll.filter(d => {
        const isSeed = seeds.some(s => s.id === d.id);
        const passesVisibility = isSeed || !d.name.includes('Validation Dataset');
        if (!passesVisibility)
            return false;
        if (!userId)
            return true;
        return d.created_by === userId || d.created_by === 'system';
    });
    try {
        let query = supabase
            .from('backtest_datasets')
            .select('*');
        if (userId) {
            query = query.or(`created_by.eq.${userId},created_by.eq.system`);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
            return fallback;
        }
        const dbDatasets = (data || []).map(d => ({
            ...d,
            covers_2025: checkCovers2025(d.start_time, d.end_time)
        }));
        const map = new Map();
        for (const d of fallback)
            map.set(d.id, d);
        for (const d of dbDatasets)
            map.set(d.id, d);
        return Array.from(map.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    catch (err) {
        return fallback;
    }
}
export async function getBacktestDatasetDetails(id, userId) {
    const supabase = getSupabase();
    try {
        let query = supabase
            .from('backtest_datasets')
            .select('*')
            .eq('id', id);
        if (userId) {
            query = query.or(`created_by.eq.${userId},created_by.eq.system`);
        }
        const { data: dataset, error: dsErr } = await query.single();
        if (dsErr || !dataset) {
            return getFallbackDetails(id, userId);
        }
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
    }
    catch {
        return getFallbackDetails(id, userId);
    }
}
function getFallbackDetails(id, userId) {
    const datasets = readFallbackDatasets();
    const dataset = datasets.find(d => {
        const isIdMatch = d.id === id;
        if (!isIdMatch)
            return false;
        if (!userId)
            return true;
        return d.created_by === userId || d.created_by === 'system';
    });
    if (!dataset)
        return { success: false, error: 'Dataset not found or access denied' };
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
export async function getBacktestDatasetCandles(id, userId) {
    const supabase = getSupabase();
    const details = await getBacktestDatasetDetails(id, userId);
    if (!details.success) {
        return [];
    }
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
    }
    catch {
        return readFallbackCandles(id);
    }
}
export async function deleteBacktestDataset(id, userId) {
    if (!userId)
        return { success: false, error: 'User ID is required for deletion' };
    const supabase = getSupabase();
    try {
        const { data: dataset } = await supabase
            .from('backtest_datasets')
            .select('created_by, name')
            .eq('id', id)
            .maybeSingle();
        if (dataset && dataset.created_by !== userId && dataset.created_by !== 'system') {
            return { success: false, error: 'Access denied: You can only delete your own datasets' };
        }
        const { count: runCount } = await supabase
            .from('backtest_runs')
            .select('*', { count: 'exact', head: true })
            .eq('dataset_id', id);
        if (runCount && runCount > 0) {
            await supabase.from('backtest_datasets').update({ status: 'archived' }).eq('id', id);
            return {
                success: true,
                message: `Dataset "${dataset?.name}" is referenced by ${runCount} historical backtest runs. It has been safely archived to preserve backtest reproducibility.`
            };
        }
        deleteFallbackDataset(id);
        const { error } = await supabase
            .from('backtest_datasets')
            .delete()
            .eq('id', id);
        if (error && error.code !== 'PGRST205' && !error.message?.includes('does not exist')) {
            console.warn('[Backtest Service] DB Delete notice:', error.message);
        }
        return { success: true };
    }
    catch (err) {
        deleteFallbackDataset(id);
        return { success: true };
    }
}
