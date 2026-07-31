import React, { useState } from 'react';
import { Shield, Key, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function GeminiTesterPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  const handleTestConnection = async () => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setLatency(null);

    const startTime = Date.now();

    try {
      // Determine base URL depending on if we are running in the preview or locally
      let baseUrl = window.location.origin;
      if (baseUrl.includes(':5173') || baseUrl.includes(':3000')) {
        baseUrl = 'http://localhost:3000';
      }
        
      const response = await fetch(`${baseUrl}/api/debug/test-gemini`, {
        method: 'POST', // or GET
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      setLatency(Date.now() - startTime);
      setResult(data);
    } catch (err: any) {
      setLatency(Date.now() - startTime);
      setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-12">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
          <Shield className="w-8 h-8 text-yellow-500" />
          <h1 className="text-2xl font-bold tracking-tight">Test Gemini Connection</h1>
        </div>

        <p className="text-sm text-zinc-400">
          This uses the exact same production configuration (environment variable or Supabase-stored key) used by the Market Watcher.
        </p>

        <div className="space-y-4 bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
          <button
            onClick={handleTestConnection}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white text-sm font-bold text-black hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Testing..." : "Test Gemini Connection"}
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex gap-3 items-start">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="break-words">{error}</div>
          </div>
        )}

        {result && (
          <div className={`p-6 rounded-2xl border ${result.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'} space-y-4`}>
            <div className="flex items-center gap-3">
              {result.success ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              ) : (
                <AlertCircle className="w-6 h-6 text-red-400" />
              )}
              <h2 className={`text-lg font-bold ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
                {result.success ? "Connection Successful" : "Connection Failed"}
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/50 border border-zinc-800 p-3 rounded-lg">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">API Status</div>
                <div className="font-mono text-sm">{result.status || 'N/A'}</div>
              </div>
              <div className="bg-black/50 border border-zinc-800 p-3 rounded-lg">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Model Used</div>
                <div className="font-mono text-sm">{result.model || 'N/A'}</div>
              </div>
              <div className="bg-black/50 border border-zinc-800 p-3 rounded-lg">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Latency</div>
                <div className="font-mono text-sm">{latency ? `${latency}ms` : 'N/A'}</div>
              </div>
            </div>

            {result.success && (
              <div className="bg-black/50 border border-zinc-800 p-4 rounded-lg space-y-2">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Response</div>
                <div className="text-sm text-zinc-200 font-mono">{result.responseText}</div>
              </div>
            )}
            
            {!result.success && result.error && (
              <div className="bg-black/50 border border-zinc-800 p-4 rounded-lg space-y-2">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Error</div>
                <div className="font-mono text-sm text-red-400 break-words">{result.error.message || 'N/A'}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
