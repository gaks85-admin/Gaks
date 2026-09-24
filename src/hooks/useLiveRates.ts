import { useState, useEffect, useCallback } from 'react';

export interface ForexPair {
  symbol: string;
  name: string;
  price: number;
  change: number;
  sentiment: 'Bearish' | 'Bullish' | 'Neutral';
  history: number[];
  status?: 'active' | 'unavailable';
}

export function useLiveRates(interval = '1h', range = '5d') {
  const [rates, setRates] = useState<ForexPair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRates = useCallback(async () => {
    try {
      const response = await fetch(`/api/live-rates?interval=${interval}&range=${range}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data && data.success && Array.isArray(data.pairs)) {
        const mappedPairs: ForexPair[] = data.pairs.map((p: any) => ({
          symbol: p.symbol || 'Unknown',
          name: p.name || 'Unknown',
          price: Number(p.currentPrice !== undefined ? p.currentPrice : (p.price || 0)),
          change: Number(p.change || 0),
          sentiment: p.sentiment || 'Neutral',
          history: Array.isArray(p.history) ? p.history.filter((h: any) => typeof h === 'number' && !isNaN(h)) : [0, 0, 0, 0, 0, 0, 0],
          status: p.status || 'active'
        }));
        setRates(mappedPairs);
        setError(null);
      } else {
        throw new Error('Invalid API response structure');
      }
    } catch (err: any) {
      console.warn('Network update standby or fetch rates deferred:', err.message || err);
      setError(err.message || 'Failed to fetch rates');
    } finally {
      setIsLoading(false);
    }
  }, [interval, range]);

  useEffect(() => {
    fetchRates();
    const intervalId = setInterval(fetchRates, 20000); // 20 seconds auto-refresh to match server cache
    return () => clearInterval(intervalId);
  }, [fetchRates]);

  return { rates, isLoading, error, refetch: fetchRates };
}
