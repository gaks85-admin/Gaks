import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[GAKS App Crash Caught by ErrorBoundary]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center font-sans">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mb-4 text-2xl font-bold shadow-lg">
            ⚠️
          </div>
          <h1 className="text-lg font-bold mb-2 tracking-tight">Application Error Detected</h1>
          <p className="text-xs text-zinc-400 max-w-sm mb-4 leading-relaxed">
            An unexpected error occurred while loading this view. You can reload to restore your session.
          </p>
          <div className="text-[11px] font-mono text-red-300/80 bg-zinc-900/90 border border-zinc-800 p-3 rounded-xl max-w-md w-full mb-6 text-left overflow-auto max-h-36">
            {this.state.error?.message || 'Unknown runtime error'}
          </div>
          <button
            onClick={() => {
              try {
                sessionStorage.clear();
              } catch (_) {}
              window.location.reload();
            }}
            className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
