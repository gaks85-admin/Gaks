import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, AlertTriangle, CheckCircle2, RefreshCw, Trash2, Activity,
  BarChart4, Layers, Cpu, Eye, FileText, FlaskConical, TrendingUp
} from 'lucide-react';

interface ScientificValidationViewProps {
  datasets: any[];
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

export function ScientificValidationView({
  datasets,
  fetchWithAuth,
  showToast
}: ScientificValidationViewProps) {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('');
  const [running, setRunning] = useState<boolean>(false);
  const [experiments, setExperiments] = useState<any[]>([]);
  const [selectedExp, setSelectedExp] = useState<any | null>(null);
  const [loadingList, setLoadingList] = useState<boolean>(true);

  useEffect(() => {
    loadExperiments();
  }, []);

  const loadExperiments = async () => {
    setLoadingList(true);
    try {
      const res = await fetchWithAuth('/api/admin/backtest/validation/list');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setExperiments(data.experiments || []);
          if (data.experiments && data.experiments.length > 0 && !selectedExp) {
            setSelectedExp(data.experiments[0]);
          }
        }
      }
    } catch (err) {
      console.error('Error loading experiments:', err);
    } finally {
      setLoadingList(false);
    }
  };

  const handleRunValidation = async () => {
    if (!selectedDatasetId) {
      showToast('Please select a dataset first', 'error');
      return;
    }

    setRunning(true);
    try {
      const res = await fetchWithAuth('/api/admin/backtest/validation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: selectedDatasetId,
          config: { initialBalance: 100000 }
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Scientific validation completed successfully', 'success');
        setSelectedExp(data.experiment);
        await loadExperiments();
      } else {
        showToast(data.error || 'Scientific validation failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error running validation', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleDeleteExp = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this validation experiment record?')) return;

    try {
      const res = await fetchWithAuth(`/api/admin/backtest/validation/delete?id=${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        showToast('Experiment deleted', 'success');
        if (selectedExp?.id === id) setSelectedExp(null);
        await loadExperiments();
      }
    } catch (err: any) {
      showToast(err.message || 'Error deleting experiment', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PASS':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" /> OVERALL PASS
          </span>
        );
      case 'FAIL':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3.5 h-3.5" /> OVERALL FAIL
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Activity className="w-3.5 h-3.5" /> INCONCLUSIVE
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Control Panel Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">Scientific Validation Engine (Stage E)</h2>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Rigorous, reproducible multi-stage validation: Lookahead audit, Data leakage, Walk-forward,
              Out-of-sample holdout, Sensitivity, Regimes, Monte Carlo, and Robustness.
            </p>
          </div>

          <button
            onClick={loadExperiments}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} /> Refresh History
          </button>
        </div>

        {/* Dataset Selection & Run Action */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end bg-zinc-950 p-4 rounded-lg border border-zinc-800/80">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Select Historical Dataset</label>
            <select
              value={selectedDatasetId}
              onChange={e => setSelectedDatasetId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- Choose a ready historical dataset --</option>
              {datasets.filter(d => d.status === 'ready').map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.symbol} {d.timeframe} — {d.row_count?.toLocaleString()} candles) v{d.version || '1.0.0'}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleRunValidation}
            disabled={running || !selectedDatasetId}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm flex items-center justify-center gap-2 transition"
          >
            {running ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Executing E1–E8 Audit Suite...
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Run Validation (E1–E8)
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Grid: Experiment List & Detailed Inspection Report */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Experiments History List */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 h-fit">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-400" />
            Validation Experiment History
          </h3>

          {experiments.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-500">
              No scientific validation experiments executed yet. Select a dataset and click "Run Validation".
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {experiments.map(exp => (
                <div
                  key={exp.id}
                  onClick={() => setSelectedExp(exp)}
                  className={`p-3 rounded-lg border text-xs cursor-pointer transition flex items-center justify-between ${
                    selectedExp?.id === exp.id
                      ? 'bg-zinc-800 border-emerald-500/50 text-white'
                      : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <div>
                    <div className="font-semibold text-white">{exp.symbol} {exp.timeframe}</div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      {new Date(exp.createdAt).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {getStatusBadge(exp.status)}
                    <button
                      onClick={e => handleDeleteExp(exp.id, e)}
                      className="p-1 hover:text-rose-400 text-zinc-500 transition"
                      title="Delete Record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detailed Experiment Report Display */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedExp ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center text-zinc-500">
              Select an experiment from history or run a new validation suite to view detailed findings.
            </div>
          ) : (
            <>
              {/* Summary Header */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
                  <div>
                    <h3 className="text-lg font-bold text-white">{selectedExp.name}</h3>
                    <div className="text-xs text-zinc-400 mt-0.5">
                      Executed: {new Date(selectedExp.createdAt).toLocaleString()} | ID: {selectedExp.id.substring(0, 8)}...
                    </div>
                  </div>
                  {getStatusBadge(selectedExp.status)}
                </div>

                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-xs text-zinc-300">
                  <span className="font-semibold text-zinc-200">Evaluation Reason: </span>
                  {selectedExp.summaryReason}
                </div>
              </div>

              {/* Grid of E1-E8 Findings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* E1 — Lookahead Audit Card */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Eye className="w-4 h-4 text-emerald-400" /> E1: Lookahead Bias Audit
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      selectedExp.e1Lookahead?.passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {selectedExp.e1Lookahead?.passed ? 'PASSED' : 'FAILED'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {selectedExp.e1Lookahead?.passed
                      ? 'Zero future-candle leakage. Future price mutations preserve past signal outputs.'
                      : 'Lookahead bias detected during future candle mutation test.'}
                  </p>
                </div>

                {/* E2 — Data Leakage Card */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-sky-400" /> E2: Data Leakage Audit
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      selectedExp.e2DataLeakage?.passed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {selectedExp.e2DataLeakage?.passed ? 'PASSED' : 'FAILED'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {selectedExp.e2DataLeakage?.passed
                      ? 'Clean data partitioning. Zero timestamp overlaps or holdout contamination.'
                      : 'Data leakage or duplicate candle timestamp issues found.'}
                  </p>
                </div>

                {/* E3 — Walk-Forward Card */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-amber-400" /> E3: Walk-Forward Efficiency
                    </span>
                    <span className="text-xs font-semibold text-amber-400">
                      WFE: {(selectedExp.e3WalkForward?.walkForwardEfficiencyRatio || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-300">
                    <div>Windows: {selectedExp.e3WalkForward?.totalWindows || 0} ({selectedExp.e3WalkForward?.windowType})</div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      OOS Net PnL: ${selectedExp.e3WalkForward?.overallOutOfSamplePnL?.toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* E4 — Out-of-Sample Card */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-purple-400" /> E4: Out-of-Sample Holdout
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                      selectedExp.e4OutOfSample?.isPassed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}>
                      {selectedExp.e4OutOfSample?.isPassed ? 'PASSED' : 'FAILED'}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-300">
                    <div>Holdout PnL: ${selectedExp.e4OutOfSample?.holdoutAnalytics?.netProfit?.toFixed(2)}</div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      Degradation Ratio: {(selectedExp.e4OutOfSample?.degradationRatio || 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                {/* E5 — Sensitivity Analysis */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Cpu className="w-4 h-4 text-cyan-400" /> E5: Parameter Sensitivity
                    </span>
                    <span className="text-xs font-semibold text-cyan-400">
                      Score: {selectedExp.e5Sensitivity?.sensitivityScore}/100
                    </span>
                  </div>
                  <div className="text-xs text-zinc-300">
                    <div>Max Performance Drop: {(selectedExp.e5Sensitivity?.maxPerformanceDropPercent || 0).toFixed(1)}%</div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      Overfit Cliff Count: {selectedExp.e5Sensitivity?.cliffCount || 0}
                    </div>
                  </div>
                </div>

                {/* E7 — Monte Carlo Risk of Ruin */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <BarChart4 className="w-4 h-4 text-indigo-400" /> E7: Monte Carlo Simulation
                    </span>
                    <span className="text-xs font-semibold text-indigo-400">
                      Ruin Risk: {(selectedExp.e7MonteCarlo?.riskOfRuinPercent || 0).toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-xs text-zinc-300">
                    <div>Median Final Equity: ${selectedExp.e7MonteCarlo?.finalEquity?.p50?.toFixed(2)}</div>
                    <div className="text-[11px] text-zinc-400 mt-1">
                      5th %ile Drawdown: {(selectedExp.e7MonteCarlo?.maxDrawdownPercent?.p95 || 0).toFixed(1)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* E8 — Robustness Multipliers Breakdown */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" /> E8: Execution Robustness Matrix
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  {selectedExp.e8Robustness?.scenarios?.map((scen: any, idx: number) => (
                    <div key={idx} className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                      <div className="font-semibold text-zinc-300">{scen.scenarioName}</div>
                      <div className={`text-sm font-bold mt-1 ${scen.isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                        ${scen.analytics?.netProfit?.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {scen.isProfitable ? 'PROFITABLE' : 'UNPROFITABLE'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
