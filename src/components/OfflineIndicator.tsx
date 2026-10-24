import React, { useEffect, useState } from 'react';
import { WifiOff, AlertCircle } from 'lucide-react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-sm animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex items-center gap-3 rounded-2xl bg-amber-500 p-4 shadow-xl shadow-amber-900/20 text-white">
        <div className="p-2 bg-white/20 rounded-lg">
          <WifiOff className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold">You're Offline</h4>
          <p className="text-xs opacity-90">Using cached data. Signals may be delayed.</p>
        </div>
        <AlertCircle className="w-4 h-4 opacity-50" />
      </div>
    </div>
  );
};
