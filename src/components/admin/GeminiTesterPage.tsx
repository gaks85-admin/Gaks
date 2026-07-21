import React, { useState } from 'react';
import { Shield, Key, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function GeminiTesterPage() {
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setError("Please enter an API key.");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      // Determine base URL depending on if we are running in the preview or locally
      let baseUrl = window.location.origin;
      if (baseUrl.includes(':5173') || baseUrl.includes(':3000')) {
        baseUrl = 'http://localhost:3000';
      }
        
      const response = await fetch(`${baseUrl}/api/debug/test-key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
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
          <h1 className="text-2xl font-bold tracking-tight">Gemini API Key Debugger</h1>
        </div>

        <p className="text-sm text-zinc-400">
          This is a temporary developer-only tool to test if a Gemini API key is valid and has quota.
          It performs a simple <code className="text-pink-400 bg-pink-400/10 px-1 py-0.5 rounded">generateContent</code> request with the prompt "Say hello".
        </p>

        <div className="space-y-4 bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <Key className="w-4 h-4" /> Gemini API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-black border border-zinc-700 px-4 py-3 rounded-xl text-sm text-white focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>

          <button
            onClick={handleTestKey}
            disabled={isLoading || !apiKey.trim()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-white text-sm font-bold text-black hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Testing..." : "Test API Key"}
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
                {result.success ? "Success" : "Failed"}
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-black/50 border border-zinc-800 p-3 rounded-lg">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">HTTP Status</div>
                <div className="font-mono text-sm">{result.status || 'N/A'}</div>
              </div>
              
              {!result.success && result.error && (
                <div className="bg-black/50 border border-zinc-800 p-3 rounded-lg">
                  <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-1">Error Code</div>
                  <div className="font-mono text-sm text-red-400">{result.error.code || 'N/A'}</div>
                </div>
              )}
            </div>

            {!result.success && result.error && (
              <div className="bg-black/50 border border-zinc-800 p-4 rounded-lg space-y-2">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Error Message</div>
                <div className="font-mono text-sm text-red-400 break-words">{result.error.message || 'N/A'}</div>
              </div>
            )}

            {!result.success && result.error?.details && (
              <div className="bg-black/50 border border-zinc-800 p-4 rounded-lg space-y-2">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Error Details (Quota, etc)</div>
                <pre className="font-mono text-xs text-zinc-300 break-words whitespace-pre-wrap">
                  {JSON.stringify(result.error.details, null, 2)}
                </pre>
              </div>
            )}

            {result.success && (
              <div className="bg-black/50 border border-zinc-800 p-4 rounded-lg space-y-2">
                <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Response Text</div>
                <div className="text-sm text-zinc-200">{result.responseText}</div>
              </div>
            )}
            
            {result.success && result.fullResponseObject && (
              <details className="bg-black/50 border border-zinc-800 p-4 rounded-lg group">
                <summary className="text-xs text-zinc-500 uppercase font-bold tracking-wider cursor-pointer list-none flex items-center justify-between">
                  <span>Full Response Object</span>
                  <span className="text-zinc-600 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="pt-4">
                  <pre className="font-mono text-xs text-zinc-400 break-words whitespace-pre-wrap max-h-60 overflow-y-auto custom-scrollbar">
                    {JSON.stringify(result.fullResponseObject, null, 2)}
                  </pre>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
