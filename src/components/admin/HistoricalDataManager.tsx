import React, { useState } from 'react';
import { 
  Database, Upload, CheckCircle2, AlertTriangle, XCircle, 
  RefreshCw, Trash2, ShieldCheck, Clock, FileText, 
  BarChart4, ArrowRight, Layers, Search, History
} from 'lucide-react';

interface DatasetMetadata {
  provider: string;
  instrument: string;
  timeframe: string;
  startTime: string;
  endTime: string;
  candleCount: number;
  validationStatus: string;
  version: string;
}

interface DatasetValidationReport {
  status: string;
  totalCandles: number;
  validCandles: number;
  duplicateCount: number;
  missingCandleCount: number;
  coveragePercent: number;
  longestGapMinutes: number;
  warnings: string[];
  errors: string[];
}

interface BacktestDataset {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  row_count: number;
  status: string;
  version: string;
  metadata?: DatasetMetadata;
  validation_report?: DatasetValidationReport;
  created_at: string;
}

interface HistoricalDataManagerProps {
  datasets: BacktestDataset[];
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  showToast: (message: string, type?: 'success' | 'error') => void;
  onRefresh: () => void;
}

export function HistoricalDataManager({ datasets, fetchWithAuth, showToast, onRefresh }: HistoricalDataManagerProps) {
  const [selectedDataset, setSelectedDataset] = useState<BacktestDataset | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const handleValidate = async (datasetId: string) => {
    setValidatingId(datasetId);
    try {
      const res = await fetchWithAuth('/api/admin/backtest/datasets/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId })
      });
      const json = await res.json();
      if (json.success) {
        showToast('Validation completed successfully', 'success');
        onRefresh();
      } else {
        showToast(json.error || 'Validation failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error validating dataset', 'error');
    } finally {
      setValidatingId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'VALID': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'PARTIAL': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'INVALID': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <RefreshCw className="w-4 h-4 text-zinc-400" />;
    }
  };

  const calculateTotalCoverage = () => {
    // Simplified logic for demo
    const coverage = datasets.reduce((acc, d) => acc + (d.validation_report?.coveragePercent || 0), 0);
    return datasets.length > 0 ? (coverage / datasets.length).toFixed(1) : '0.0';
  };

  return (
    <div className="space-y-6">
      {/* 10-Year Coverage Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <Database className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Datasets</span>
          </div>
          <div className="text-2xl font-mono font-bold text-white">{datasets.length}</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <BarChart4 className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Overall Coverage</span>
          </div>
          <div className="text-2xl font-mono font-bold text-sky-400">{calculateTotalCoverage()}%</div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Valid Datasets</span>
          </div>
          <div className="text-2xl font-mono font-bold text-emerald-400">
            {datasets.filter(d => d.validation_report?.status === 'VALID').length}
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl">
          <div className="flex items-center gap-2 text-zinc-400 mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Candles</span>
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            {datasets.reduce((acc, d) => acc + d.row_count, 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Dataset List */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-500" />
            Historical Data Inventory
          </h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input 
                type="text" 
                placeholder="Filter symbol..." 
                className="bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500/50 w-40"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-950 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">
                <th className="px-4 py-3 border-b border-zinc-800">Dataset / Version</th>
                <th className="px-4 py-3 border-b border-zinc-800">Symbol</th>
                <th className="px-4 py-3 border-b border-zinc-800">Timeframe</th>
                <th className="px-4 py-3 border-b border-zinc-800">Coverage</th>
                <th className="px-4 py-3 border-b border-zinc-800">Status</th>
                <th className="px-4 py-3 border-b border-zinc-800 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {datasets.map((d) => (
                <tr key={d.id} className="hover:bg-zinc-800/30 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-white group-hover:text-sky-400 transition-colors">{d.name}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">v{d.version || '1.0.0'} • {d.id.substring(0, 8)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] font-mono text-zinc-300">
                      {d.symbol}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">{d.timeframe}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 w-24">
                      <div className="flex justify-between text-[9px] text-zinc-500 font-mono">
                        <span>{d.validation_report?.coveragePercent || 0}%</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-sky-500 transition-all" 
                          style={{ width: `${d.validation_report?.coveragePercent || 0}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(d.validation_report?.status || 'PENDING')}
                      <span className="text-[10px] font-bold text-zinc-300">
                        {d.validation_report?.status || 'PENDING'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => handleValidate(d.id)}
                        disabled={validatingId === d.id}
                        className="p-1.5 hover:bg-sky-500/10 text-zinc-400 hover:text-sky-400 rounded-lg transition-all"
                        title="Run Validation"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${validatingId === d.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button 
                        onClick={() => setSelectedDataset(d)}
                        className="p-1.5 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-lg transition-all"
                        title="View Report"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Validation Report Modal */}
      {selectedDataset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Validation Report</h3>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{selectedDataset.name} (v{selectedDataset.version})</p>
              </div>
              <button onClick={() => setSelectedDataset(null)} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
                <XCircle className="w-5 h-5 text-zinc-500" />
              </button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Total Candles</span>
                  <span className="text-xl font-mono text-white">{selectedDataset.row_count.toLocaleString()}</span>
                </div>
                <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Missing Gaps</span>
                  <span className="text-xl font-mono text-amber-500">{selectedDataset.validation_report?.missingCandleCount || 0}</span>
                </div>
                <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">Duplicates</span>
                  <span className="text-xl font-mono text-red-500">{selectedDataset.validation_report?.duplicateCount || 0}</span>
                </div>
              </div>

              {/* Errors & Warnings */}
              <div className="space-y-4">
                {selectedDataset.validation_report?.errors.length ? (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-red-500 uppercase tracking-wider flex items-center gap-2">
                      <XCircle className="w-3 h-3" /> Critical Failures
                    </h4>
                    <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-1.5">
                      {selectedDataset.validation_report.errors.map((err, i) => (
                        <p key={i} className="text-xs text-red-400 flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 bg-red-500 rounded-full shrink-0" /> {err}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedDataset.validation_report?.warnings.length ? (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3" /> Integrity Warnings
                    </h4>
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-1.5">
                      {selectedDataset.validation_report.warnings.map((warn, i) => (
                        <p key={i} className="text-xs text-amber-400 flex items-start gap-2">
                          <span className="mt-1 w-1 h-1 bg-amber-500 rounded-full shrink-0" /> {warn}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(!selectedDataset.validation_report?.errors.length && !selectedDataset.validation_report?.warnings.length) && (
                  <div className="flex flex-col items-center justify-center p-8 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                    <p className="text-sm font-bold text-white">Full Integrity Match</p>
                    <p className="text-xs text-emerald-400/70 mt-1">This dataset version is 100% deterministic and safe for backtesting.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 bg-zinc-950/50 border-t border-zinc-800 flex justify-end">
              <button 
                onClick={() => setSelectedDataset(null)}
                className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold transition-all"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
