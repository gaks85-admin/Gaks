import React, { useState, useEffect } from 'react';
import { 
  FileText, Upload, RefreshCw, Trash2, CheckCircle2, AlertTriangle, 
  Layers, Calendar, Database, Eye, X, Check, ArrowRight, ShieldCheck, TrendingUp
} from 'lucide-react';

interface BacktestDataset {
  id: string;
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
}

interface ParsedCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface BacktestPageProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export function BacktestPage({ fetchWithAuth, showToast }: BacktestPageProps) {
  const [datasets, setDatasets] = useState<BacktestDataset[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Form State
  const [datasetName, setDatasetName] = useState('');
  const [symbol, setSymbol] = useState('EURUSD');
  const [customSymbol, setCustomSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('M5');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  // Preview & Engine State
  const [previewDataset, setPreviewDataset] = useState<BacktestDataset | null>(null);
  const [sampleCandles, setSampleCandles] = useState<ParsedCandle[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [runningEngineId, setRunningEngineId] = useState<string | null>(null);
  const [engineResult, setEngineResult] = useState<any | null>(null);

  const handleRunBacktest = async (dataset: BacktestDataset) => {
    setRunningEngineId(dataset.id);
    try {
      // 1. Parse account capital from localStorage
      const savedCapital = localStorage.getItem('gaks_capital') || '$100,000';
      let balanceNum = 100000;
      if (savedCapital === 'Custom') {
        const customCapital = localStorage.getItem('gaks_custom_capital') || '100000';
        balanceNum = parseFloat(customCapital.replace(/[^0-9.]/g, '')) || 100000;
      } else {
        balanceNum = parseFloat(savedCapital.replace(/[^0-9.]/g, '')) || 100000;
      }

      // 2. Parse risk percent from localStorage
      const savedRisk = localStorage.getItem('gaks_preferred_risk') || '1%';
      const riskPercentNum = parseFloat(savedRisk.replace(/[^0-9.]/g, '')) || 1.0;

      // 3. Get customized strategy text from localStorage
      const savedStrategyText = localStorage.getItem('gaks_strategy_text') || '';

      const res = await fetchWithAuth('/api/admin/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: dataset.id,
          initialBalance: balanceNum,
          strategyText: savedStrategyText,
          symbol: dataset.symbol,
          timeframe: dataset.timeframe,
          simulation: {
            riskPercent: riskPercentNum,
            spreadPips: 1.0,
            slippagePips: 0.5,
            commissionPerLot: 7.0,
            sameCandlePolicy: 'STOP_LOSS_FIRST',
            executionModel: 'NEXT_CANDLE_OPEN'
          }
        })
      });
      const json = await res.json();
      if (json.success) {
        setEngineResult(json);
        loadRuns();
        showToast(`Phase 5 Simulation completed: ${json.candlesProcessed} candles, ${json.signalsGenerated} signals, ${json.tradesCompleted} simulated trades ($${json.totalNetPnL >= 0 ? '+' : ''}${json.totalNetPnL?.toLocaleString()})!`, 'success');
      } else {
        showToast(json.error || 'Backtest engine failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error running backtest engine', 'error');
    } finally {
      setRunningEngineId(null);
    }
  };

  const loadDatasets = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth('/api/admin/backtest/datasets');
      const json = await res.json();
      if (json.success) {
        setDatasets(json.datasets || []);
      }
    } catch (err) {
      console.error('Error loading backtest datasets:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadRuns = async () => {
    try {
      const res = await fetchWithAuth('/api/admin/backtest/runs');
      const json = await res.json();
      if (json.success) {
        setRuns(json.runs || []);
      }
    } catch (err) {
      console.error('Error loading backtest runs:', err);
    }
  };

  const handleInspectRun = async (runId: string) => {
    try {
      const res = await fetchWithAuth(`/api/admin/backtest/runs/${runId}`);
      const json = await res.json();
      if (json.success && json.run) {
        setEngineResult({
          success: true,
          datasetId: json.run.datasetId,
          symbol: json.run.symbol,
          timeframe: json.run.timeframe,
          startTime: json.run.createdAt,
          endTime: json.run.completedAt,
          initialBalance: json.run.startingBalance,
          finalBalance: json.run.endingBalance,
          totalNetPnL: json.run.netProfit,
          candlesProcessed: json.run.analyticsSnapshot?.totalTrades ? json.run.analyticsSnapshot.totalTrades * 10 : 100,
          signalsGenerated: json.run.trades?.length || 0,
          tradesCompleted: json.run.trades?.length || 0,
          signals: [],
          trades: json.run.trades || [],
          analytics: json.run.analyticsSnapshot
        });
      }
    } catch (err: any) {
      showToast(err.message || 'Error loading backtest run details', 'error');
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!confirm('Are you sure you want to delete this historical backtest run?')) return;
    try {
      const res = await fetchWithAuth(`/api/admin/backtest/runs/${runId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        showToast('Backtest run deleted successfully', 'success');
        loadRuns();
      } else {
        showToast(json.error || 'Failed to delete backtest run', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error deleting backtest run', 'error');
    }
  };

  useEffect(() => {
    loadDatasets();
    loadRuns();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    if (!datasetName) {
      const defaultName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
      setDatasetName(defaultName);
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFileContent(text || '');
    };
    reader.readAsText(file);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !fileContent) {
      showToast('Please select a valid CSV file', 'error');
      return;
    }

    const finalSymbol = (symbol === 'CUSTOM' ? customSymbol : symbol).trim().toUpperCase();
    if (!finalSymbol) {
      showToast('Please specify a valid symbol', 'error');
      return;
    }

    if (!datasetName.trim()) {
      showToast('Please specify a dataset name', 'error');
      return;
    }

    try {
      setUploading(true);
      const res = await fetchWithAuth('/api/admin/backtest/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: datasetName.trim(),
          symbol: finalSymbol,
          timeframe,
          sourceFilename: selectedFile.name,
          csvContent: fileContent
        })
      });

      const json = await res.json();
      if (json.success) {
        showToast(`Successfully imported ${json.dataset?.row_count?.toLocaleString()} candles!`, 'success');
        // Reset form
        setSelectedFile(null);
        setFileContent('');
        setDatasetName('');
        await loadDatasets();
      } else {
        showToast(json.error || 'Import failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error uploading dataset', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete dataset "${name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetchWithAuth(`/api/admin/backtest/datasets/${id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json.success) {
        showToast('Dataset deleted successfully', 'success');
        await loadDatasets();
      } else {
        showToast(json.error || 'Failed to delete dataset', 'error');
      }
    } catch (err: any) {
      showToast('Error deleting dataset', 'error');
    }
  };

  const handlePreview = async (dataset: BacktestDataset) => {
    setPreviewDataset(dataset);
    setLoadingPreview(true);
    try {
      const res = await fetchWithAuth(`/api/admin/backtest/datasets/${dataset.id}`);
      const json = await res.json();
      if (json.success) {
        setSampleCandles(json.sampleCandles || []);
      }
    } catch (err) {
      console.error('Error fetching dataset preview:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return 'N/A';
    try {
      const d = new Date(isoStr);
      return d.getUTCFullYear() + '-' + 
        String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + 
        String(d.getUTCDate()).padStart(2, '0') + ' ' + 
        String(d.getUTCHours()).padStart(2, '0') + ':' + 
        String(d.getUTCMinutes()).padStart(2, '0') + ' UTC';
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-zinc-800/60">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-sky-500/10 border border-sky-500/20 text-sky-400 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white font-sans tracking-tight">
              Backtesting Engine — Historical Datasets
            </h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 pl-1">
            Phase 3: Import, validate, and store normalized OHLC historical candle data for deterministic strategy backtesting.
          </p>
        </div>

        <button
          onClick={loadDatasets}
          className="px-3.5 py-2 bg-zinc-100 dark:bg-zinc-800/80 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh List
        </button>
      </div>

      {/* Import Form Card */}
      <div className="bg-zinc-50 dark:bg-zinc-900/50 p-5 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-sky-500" />
            Import Historical CSV Dataset
          </h3>
          <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
            Phase 3 Ready
          </span>
        </div>

        <form onSubmit={handleImport} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Dataset Name */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Dataset Name
              </label>
              <input
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="e.g. 2025 EURUSD M5 Full Year"
                className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500"
                required
              />
            </div>

            {/* Symbol Selection */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Symbol
              </label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500"
              >
                <option value="EURUSD">EURUSD (Euro / US Dollar)</option>
                <option value="GBPUSD">GBPUSD (British Pound / US Dollar)</option>
                <option value="USDJPY">USDJPY (US Dollar / Japanese Yen)</option>
                <option value="AUDUSD">AUDUSD (Australian Dollar / US Dollar)</option>
                <option value="XAUUSD">XAUUSD (Gold / US Dollar)</option>
                <option value="BTCUSD">BTCUSD (Bitcoin / US Dollar)</option>
                <option value="ETHUSD">ETHUSD (Ethereum / US Dollar)</option>
                <option value="CUSTOM">Custom Symbol...</option>
              </select>
              {symbol === 'CUSTOM' && (
                <input
                  type="text"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value)}
                  placeholder="e.g. US30, NAS100"
                  className="mt-2 w-full px-3.5 py-2 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500"
                  required
                />
              )}
            </div>

            {/* Timeframe */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                Timeframe
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white focus:outline-none focus:border-sky-500"
              >
                <option value="M1">M1 (1 Minute)</option>
                <option value="M5">M5 (5 Minutes)</option>
                <option value="M15">M15 (15 Minutes)</option>
                <option value="M30">M30 (30 Minutes)</option>
                <option value="H1">H1 (1 Hour)</option>
                <option value="H4">H4 (4 Hours)</option>
                <option value="D1">D1 (1 Day)</option>
              </select>
            </div>
          </div>

          {/* File Upload Box */}
          <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 hover:border-sky-500/50 rounded-2xl p-5 text-center transition-colors">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileChange}
              id="csv-upload-input"
              className="hidden"
            />
            <label htmlFor="csv-upload-input" className="cursor-pointer flex flex-col items-center justify-center space-y-2">
              <FileText className="w-8 h-8 text-sky-500 mb-1" />
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                {selectedFile ? selectedFile.name : 'Click to select or drag & drop historical CSV file'}
              </span>
              <span className="text-[11px] text-zinc-500">
                {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : 'Supported headers: timestamp, open, high, low, close, volume'}
              </span>
            </label>
          </div>

          {/* Upload Button */}
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white flex items-center gap-2 transition-all cursor-pointer shadow-md ${
                uploading || !selectedFile 
                  ? 'bg-zinc-400 dark:bg-zinc-800 cursor-not-allowed text-zinc-500' 
                  : 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/20'
              }`}
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Validating & Storing Candles...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Validate & Import Dataset
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Imported Datasets Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-500" />
            Imported Datasets ({datasets.length})
          </h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12 text-zinc-400">
            <RefreshCw className="w-6 h-6 animate-spin text-sky-500 mr-2.5" />
            <span className="text-xs font-semibold">Loading datasets...</span>
          </div>
        ) : datasets.length === 0 ? (
          <div className="p-8 text-center bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl">
            <FileText className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">No historical datasets imported yet.</p>
            <p className="text-[11px] text-zinc-500 mt-1 max-w-sm mx-auto">
              Upload a 2025 OHLC CSV dataset above to build your backtesting data foundation for Phase 4.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {datasets.map((dataset) => (
              <div
                key={dataset.id}
                className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all shadow-sm"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-white font-sans">
                      {dataset.name}
                    </h4>

                    <span className="px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[10px] font-mono font-bold">
                      {dataset.symbol}
                    </span>

                    <span className="px-2 py-0.5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[10px] font-mono font-bold">
                      {dataset.timeframe}
                    </span>

                    {dataset.covers_2025 ? (
                      <span className="px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 text-[10px] font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3 stroke-[3]" />
                        2025 Complete
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20 text-[10px] font-semibold">
                        Partial Range
                      </span>
                    )}

                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      dataset.status === 'ready'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : dataset.status === 'processing'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {dataset.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      <Database className="w-3.5 h-3.5 text-zinc-400" />
                      {dataset.row_count?.toLocaleString()} candles
                    </span>

                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                      {formatDate(dataset.start_time)} <ArrowRight className="w-3 h-3 text-zinc-500 inline" /> {formatDate(dataset.end_time)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end md:self-auto shrink-0">
                  {dataset.status === 'ready' && (
                    <button
                      onClick={() => handleRunBacktest(dataset)}
                      disabled={runningEngineId === dataset.id}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {runningEngineId === dataset.id ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Layers className="w-3.5 h-3.5" />
                      )}
                      Run Engine
                    </button>
                  )}

                  <button
                    onClick={() => handlePreview(dataset)}
                    className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </button>

                  <button
                    onClick={() => handleDelete(dataset.id, dataset.name)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-colors cursor-pointer"
                    title="Delete dataset"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Backtest History Section (Phase 7) */}
      <div className="bg-zinc-50 dark:bg-zinc-900/50 p-5 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-500" />
            Persisted Backtest History ({runs.length})
          </h3>
          <button
            onClick={loadRuns}
            className="px-3 py-1.5 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh History
          </button>
        </div>

        {runs.length === 0 ? (
          <p className="text-zinc-500 text-xs italic py-4">No completed backtest runs persisted yet. Run a backtest engine to save a result.</p>
        ) : (
          <div className="space-y-3">
            {runs.map((run: any) => (
              <div key={run.id} className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      {run.symbol} • {run.timeframe}
                    </span>
                    <span className="text-zinc-400 text-[11px] font-mono">{formatDate(run.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-mono text-zinc-600 dark:text-zinc-300">
                    <span>Start: ${run.startingBalance?.toLocaleString()}</span>
                    <span>End: ${run.endingBalance?.toLocaleString()}</span>
                    <span className={`font-bold ${run.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {run.netProfit >= 0 ? '+' : ''}${run.netProfit?.toLocaleString()} ({run.returnPercent}%)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleInspectRun(run.id)}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Inspect Result
                  </button>
                  <button
                    onClick={() => handleDeleteRun(run.id)}
                    className="p-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 rounded-xl transition-colors cursor-pointer"
                    title="Delete historical run"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewDataset && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-fade-in">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Eye className="w-4 h-4 text-sky-400" />
                  Dataset Preview: {previewDataset.name}
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Showing sample OHLC candles ({sampleCandles.length} rows preview)
                </p>
              </div>

              <button
                onClick={() => setPreviewDataset(null)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {loadingPreview ? (
                <div className="flex items-center justify-center p-8 text-zinc-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  <span className="text-xs">Loading candle sample...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-300 font-mono">
                    <thead className="bg-zinc-800/60 text-zinc-400 font-sans text-[11px] uppercase">
                      <tr>
                        <th className="p-2">Timestamp (UTC)</th>
                        <th className="p-2 text-right">Open</th>
                        <th className="p-2 text-right">High</th>
                        <th className="p-2 text-right">Low</th>
                        <th className="p-2 text-right">Close</th>
                        <th className="p-2 text-right">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/40">
                      {sampleCandles.map((c, i) => (
                        <tr key={i} className="hover:bg-zinc-800/30">
                          <td className="p-2 text-zinc-400">{formatDate(c.timestamp)}</td>
                          <td className="p-2 text-right">{c.open}</td>
                          <td className="p-2 text-right text-emerald-400">{c.high}</td>
                          <td className="p-2 text-right text-red-400">{c.low}</td>
                          <td className="p-2 text-right font-bold">{c.close}</td>
                          <td className="p-2 text-right text-zinc-500">{c.volume ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex justify-end">
              <button
                onClick={() => setPreviewDataset(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Engine Result Modal */}
      {engineResult && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-fade-in">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Phase 4 Deterministic Engine Output
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  100% Deterministic Execution (Zero Look-Ahead, Zero External Calls)
                </p>
              </div>

              <button
                onClick={() => setEngineResult(null)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              {engineResult.analytics && (
                <div className="space-y-4 bg-zinc-950/40 p-4 rounded-2xl border border-zinc-800/80">
                  <h4 className="font-bold text-zinc-100 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    Phase 6 Performance Analytics Summary
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block uppercase font-mono">Net Profit</span>
                      <span className={`text-sm font-bold font-mono ${engineResult.analytics.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {engineResult.analytics.netProfit >= 0 ? '+' : ''}${engineResult.analytics.netProfit?.toLocaleString()} ({engineResult.analytics.returnPercent}%)
                      </span>
                    </div>

                    <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block uppercase font-mono">Win Rate</span>
                      <span className="text-sm font-bold text-sky-400 font-mono">
                        {engineResult.analytics.winRate !== null ? `${engineResult.analytics.winRate}%` : 'N/A'}
                      </span>
                    </div>

                    <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block uppercase font-mono">Profit Factor</span>
                      <span className="text-sm font-bold text-purple-400 font-mono">
                        {engineResult.analytics.profitFactor !== null ? engineResult.analytics.profitFactor : 'N/A'}
                      </span>
                    </div>

                    <div className="bg-zinc-900/80 p-3 rounded-xl border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 block uppercase font-mono">Max Drawdown</span>
                      <span className="text-sm font-bold text-red-400 font-mono">
                        -${engineResult.analytics.maxDrawdownCurrency?.toLocaleString()} ({engineResult.analytics.maxDrawdownPercent}%)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Avg Win / Loss</span>
                      <span className="text-emerald-400">+${engineResult.analytics.averageWin || 0}</span> / <span className="text-red-400">-${engineResult.analytics.averageLoss || 0}</span>
                    </div>
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Expectancy</span>
                      <span className="text-zinc-200">${engineResult.analytics.expectancy ?? 'N/A'}</span>
                    </div>
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Long P/L (Win%)</span>
                      <span className="text-zinc-200">${engineResult.analytics.longTrades?.netPnL ?? 0} ({engineResult.analytics.longTrades?.winRate ?? 0}%)</span>
                    </div>
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Short P/L (Win%)</span>
                      <span className="text-zinc-200">${engineResult.analytics.shortTrades?.netPnL ?? 0} ({engineResult.analytics.shortTrades?.winRate ?? 0}%)</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Streaks (Win / Loss)</span>
                      <span className="text-emerald-400">W: {engineResult.analytics.longestWinningStreak}</span> | <span className="text-red-400">L: {engineResult.analytics.longestLosingStreak}</span>
                    </div>
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Avg Trade Duration</span>
                      <span className="text-zinc-200">{engineResult.analytics.averageDurationMinutes ?? 0} mins</span>
                    </div>
                    <div className="p-2.5 bg-zinc-900/50 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 text-[10px] block">Realized R Multiple</span>
                      <span className="text-sky-400">{engineResult.analytics.averageRealizedR ?? 'N/A'}R</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-bold text-zinc-200 mb-2">Simulated Trades ({engineResult.trades?.length || 0})</h4>
                {engineResult.trades?.length === 0 ? (
                  <p className="text-zinc-500 text-xs italic">No trades executed for this simulation run.</p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {engineResult.trades?.map((tr: any, idx: number) => (
                      <div key={idx} className="p-3 bg-zinc-800/40 border border-zinc-800 rounded-xl flex items-center justify-between text-xs font-mono">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              tr.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {tr.direction} ({tr.lotSize} lots)
                            </span>
                            <span className="text-zinc-400 text-[10px]">{formatDate(tr.entryTimestamp)}</span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[9px] uppercase">{tr.exitReason}</span>
                          </div>
                          <div className="text-zinc-400 text-[11px]">
                            Entry: {tr.entryPrice} → Exit: {tr.exitPrice} (SL: {tr.stopLoss} | TP: {tr.takeProfit})
                          </div>
                        </div>

                        <div className="text-right">
                          <div className={`font-bold ${tr.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {tr.netPnL >= 0 ? '+' : ''}${tr.netPnL}
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            Costs: ${(tr.spreadCost + tr.slippageCost + tr.commissionCost).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-bold text-zinc-200 mb-2">Deterministic Signals ({engineResult.signals?.length || 0})</h4>
                {engineResult.signals?.length === 0 ? (
                  <p className="text-zinc-500 text-xs italic">No trade setup signals generated for this strategy/timeframe window.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {engineResult.signals?.map((sig: any, idx: number) => (
                      <div key={idx} className="p-3 bg-zinc-800/30 border border-zinc-800 rounded-xl flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                              sig.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                              {sig.direction}
                            </span>
                            <span className="text-zinc-400 font-mono">{formatDate(sig.timestamp)}</span>
                          </div>
                          <p className="text-zinc-300 text-[11px]">{sig.reason}</p>
                        </div>

                        <div className="text-right font-mono text-[11px]">
                          <div className="text-white font-bold">Entry: {sig.entryPrice}</div>
                          <div className="text-zinc-400">SL: {sig.stopLoss || '-'} | TP: {sig.takeProfit || '-'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-zinc-800 bg-zinc-950/50 flex justify-between items-center">
              <span className="text-[11px] text-zinc-500">Ready for Phase 5 Trade & Fill Simulation</span>
              <button
                onClick={() => setEngineResult(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Close Output
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
