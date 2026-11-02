/**
 * GAKS AI — Provider-Independent Data Source Infrastructure (Stage D2)
 * Abstracted interface for historical data providers.
 */

import { ParsedCandle } from './backtest-csv.js';
import { DatasetMetadata } from './backtest-types.js';

export interface HistoricalProvider {
  id: string;
  name: string;
  isFree: boolean;
  supportedInstruments: string[];
  supportedTimeframes: string[];
  fetchHistory(params: {
    symbol: string;
    timeframe: string;
    start: Date;
    end: Date;
  }): Promise<{ candles: ParsedCandle[]; metadata: Partial<DatasetMetadata> }>;
}

export class HistDataProvider implements HistoricalProvider {
  id = 'histdata';
  name = 'HistData.com';
  isFree = true;
  supportedInstruments = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'];
  supportedTimeframes = ['M1', 'M5', 'H1'];

  async fetchHistory(params: {
    symbol: string;
    timeframe: string;
    start: Date;
    end: Date;
  }): Promise<{ candles: ParsedCandle[]; metadata: Partial<DatasetMetadata> }> {
    // Note: HistData is typically a manual download.
    // This provider serves as a metadata template for manual imports from HistData.
    return {
      candles: [],
      metadata: {
        provider: 'HistData',
        instrument: params.symbol,
        timeframe: params.timeframe,
        startTime: params.start.toISOString(),
        endTime: params.end.toISOString(),
        sourceTimezone: 'EST', // HistData uses EST/NY time usually
        timestampConvention: 'OPEN',
        priceType: 'BID'
      }
    };
  }
}

export class MetaTraderProvider implements HistoricalProvider {
  id = 'metatrader';
  name = 'MetaTrader Export';
  isFree = true;
  supportedInstruments = ['ALL'];
  supportedTimeframes = ['ALL'];

  async fetchHistory(params: {
    symbol: string;
    timeframe: string;
    start: Date;
    end: Date;
  }): Promise<{ candles: ParsedCandle[]; metadata: Partial<DatasetMetadata> }> {
    return {
      candles: [],
      metadata: {
        provider: 'MetaTrader',
        instrument: params.symbol,
        timeframe: params.timeframe,
        startTime: params.start.toISOString(),
        endTime: params.end.toISOString(),
        sourceTimezone: 'UNKNOWN',
        timestampConvention: 'OPEN',
        priceType: 'BID'
      }
    };
  }
}

export const dataProviders: HistoricalProvider[] = [
  new HistDataProvider(),
  new MetaTraderProvider()
];

export function getProviderById(id: string): HistoricalProvider | undefined {
  return dataProviders.find(p => p.id === id);
}
