export function timeframeToMinutes(timeframe: string): number {
  if (!timeframe) return 60;

  switch (timeframe) {
    case "1m": return 1;
    case "5m": return 5;
    case "15m": return 15;
    case "30m": return 30;
    case "1H": return 60;
    case "2H": return 120;
    case "4H": return 240;
    case "1D": return 1440;
  }

  // Additional fallback handling for lowercase or alternate aliases (e.g., '1h', 'H1', 'M5')
  const normalized = timeframe.trim().toUpperCase();
  switch (normalized) {
    case "1M": case "M1": case "1": return 1;
    case "5M": case "M5": case "5": return 5;
    case "15M": case "M15": case "15": return 15;
    case "30M": case "M30": case "30": return 30;
    case "1H": case "H1": case "60": return 60;
    case "2H": case "H2": case "120": return 120;
    case "4H": case "H4": case "240": return 240;
    case "1D": case "D1": case "1440": return 1440;
    default: return 60;
  }
}
