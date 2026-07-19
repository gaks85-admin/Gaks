import yahooFinance from 'yahoo-finance2';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const symbol = 'GBPUSD=X';
    const quote = await yahooFinance.quote(symbol);

    return res.status(200).json({
      success: true,
      symbol: 'GBPUSD',
      price: (quote as any).regularMarketPrice,
      raw: quote
    });
  } catch (error: any) {
    console.error('[Live Rates Debug] Yahoo Finance Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch quote from Yahoo Finance'
    });
  }
}
