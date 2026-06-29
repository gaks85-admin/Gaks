import { useState, useEffect, useCallback } from 'react';

export interface ForexPair {
  symbol: string;
  name: string;
  price: number;
  change: number;
  sentiment: 'Bearish' | 'Bullish';
  history: number[];
}

const INITIAL_FALLBACK_RATES: ForexPair[] = [
  {
    symbol: 'EURUSD',
    name: 'Euro / US Dollar',
    price: 1.0875,
    change: -0.56,
    sentiment: 'Bearish',
    history: [1.0920, 1.0910, 1.0895, 1.0890, 1.0882, 1.0870, 1.0875]
  },
  {
    symbol: 'GBPUSD',
    name: 'British Pound / US Dollar',
    price: 1.2734,
    change: -0.26,
    sentiment: 'Bearish',
    history: [1.2780, 1.2770, 1.2762, 1.2745, 1.2750, 1.2730, 1.2734]
  },
  {
    symbol: 'USDJPY',
    name: 'US Dollar / Japanese Yen',
    price: 156.42,
    change: -0.38,
    sentiment: 'Bearish',
    history: [157.10, 157.02, 156.85, 156.70, 156.62, 156.38, 156.42]
  },
  {
    symbol: 'USDCAD',
    name: 'US Dollar / Canadian Dollar',
    price: 1.3650,
    change: 0.15,
    sentiment: 'Bullish',
    history: [1.3620, 1.3630, 1.3640, 1.3645, 1.3652, 1.3648, 1.3650]
  },
  {
    symbol: 'AUDUSD',
    name: 'Australian Dollar / US Dollar',
    price: 0.6612,
    change: -1.15,
    sentiment: 'Bearish',
    history: [0.6705, 0.6685, 0.6660, 0.6645, 0.6630, 0.6610, 0.6612]
  },
  {
    symbol: 'NZDUSD',
    name: 'New Zealand Dollar / US Dollar',
    price: 0.6120,
    change: -0.45,
    sentiment: 'Bearish',
    history: [0.6180, 0.6170, 0.6155, 0.6140, 0.6132, 0.6118, 0.6120]
  },
  {
    symbol: 'USDCHF',
    name: 'US Dollar / Swiss Franc',
    price: 0.8945,
    change: 0.02,
    sentiment: 'Bullish',
    history: [0.8938, 0.8940, 0.8941, 0.8942, 0.8943, 0.8944, 0.8945]
  }
];

export function useLiveRates() {
  const [rates, setRates] = useState<ForexPair[]>(INITIAL_FALLBACK_RATES);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRates = useCallback(async () => {
    try {
      const response = await fetch('/api/live-rates');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      if (data && data.success && Array.isArray(data.pairs)) {
        const mappedPairs: ForexPair[] = data.pairs.map((p: any) => ({
          symbol: p.symbol,
          name: p.name,
          price: p.currentPrice !== undefined ? p.currentPrice : p.price,
          change: p.change,
          sentiment: p.sentiment,
          history: p.history || []
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
  }, []);

  useEffect(() => {
    fetchRates();
    const interval = setInterval(fetchRates, 10000); // 10 seconds auto-refresh
    return () => clearInterval(interval);
  }, [fetchRates]);

  return { rates, isLoading, error, refetch: fetchRates };
}
