import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, X, Info, CheckCircle2, Share } from 'lucide-react';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'header' | 'button' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ 
  className = '',
  variant = 'header'
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  // If already running as an installed standalone PWA
  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="flex items-center justify-between p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            <div>
              <div className="text-xs font-semibold text-white">App Installed</div>
              <div className="text-[11px] text-emerald-400/80">Running in standalone mobile application mode</div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const installed = await install();
      if (!installed) {
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  const renderModal = () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 shadow-2xl text-left">
        <div className="flex justify-between items-start mb-4">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
            <Smartphone className="w-6 h-6 text-cyan-400" />
          </div>
          <button 
            onClick={() => setShowGuide(false)}
            className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <h3 className="text-lg font-bold text-white mb-1.5">Install Gaks AI on Your Device</h3>
        <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
          Install the full standalone app directly to your home screen for instant access, native gestures, and uninterrupted trade monitoring.
        </p>

        {isIOS ? (
          <div className="space-y-3 mb-6 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80">
            <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">iOS Safari Instructions:</div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 flex items-center justify-center text-xs font-bold">1</div>
              <p className="text-xs text-zinc-300">
                Tap the <strong className="text-white inline-flex items-center gap-1">Share <Share className="w-3 h-3 inline" /></strong> button in your Safari bottom toolbar.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 flex items-center justify-center text-xs font-bold">2</div>
              <p className="text-xs text-zinc-300">
                Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 flex items-center justify-center text-xs font-bold">3</div>
              <p className="text-xs text-zinc-300">
                Tap <strong className="text-white">Add</strong> in the top right.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 mb-6 bg-zinc-950/60 p-4 rounded-xl border border-zinc-800/80">
            <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">Android & Chrome Instructions:</div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 flex items-center justify-center text-xs font-bold">1</div>
              <p className="text-xs text-zinc-300">
                Tap the <strong className="text-white">⋮ menu (three dots)</strong> in the top right corner of Chrome.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 flex items-center justify-center text-xs font-bold">2</div>
              <p className="text-xs text-zinc-300">
                Select <strong className="text-white">Install App</strong> or <strong className="text-white">Add to Home screen</strong>.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/50 flex items-center justify-center text-xs font-bold">3</div>
              <p className="text-xs text-zinc-300">
                Confirm by tapping <strong className="text-white">Install</strong>.
              </p>
            </div>
          </div>
        )}

        <button
          onClick={() => setShowGuide(false)}
          className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 py-2.5 text-xs font-semibold text-white transition-colors"
        >
          Got It
        </button>
      </div>
    </div>
  );

  // Card Variant (for Settings Tab or full promotional block)
  if (variant === 'card') {
    return (
      <>
        <div className="p-5 sm:p-6 rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-cyan-950/30 via-zinc-900 to-zinc-950 relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                Mobile App Installable
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">PWA</span>
              </div>
              <p className="text-xs text-zinc-400 max-w-sm">
                Install Gaks AI on your iPhone, iPad, or Android device for quick access, standalone viewport, and instant launching.
              </p>
            </div>
          </div>
          <button
            onClick={handleInstallClick}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-all shadow-md shadow-cyan-900/30 shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install on Device</span>
          </button>
        </div>
        {showGuide && renderModal()}
      </>
    );
  }

  // Full button variant (for Auth or large CTAs)
  if (variant === 'button') {
    return (
      <>
        <button
          onClick={handleInstallClick}
          className={`flex items-center justify-center gap-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 px-4 py-2 text-xs font-medium text-zinc-200 hover:text-white transition-all ${className}`}
        >
          <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
          <span>Install Mobile App</span>
        </button>
        {showGuide && renderModal()}
      </>
    );
  }

  // Default Header Variant (compact)
  return (
    <>
      <button
        onClick={handleInstallClick}
        className={`flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:text-cyan-200 transition-all cursor-pointer ${className}`}
        title="Install Gaks AI as a mobile app"
      >
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span className="hidden sm:inline">Install App</span>
      </button>
      {showGuide && renderModal()}
    </>
  );
};
