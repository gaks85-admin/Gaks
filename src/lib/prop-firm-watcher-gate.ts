import { defaultEconomicEventService, EconomicEventService } from './economic-event-service.js';
import { resolvePersistedAccountType } from './prop-firm-service.js';
import { NewsGateEvaluation } from './types.js';

export interface WatcherPropFirmGateParams {
  supabase: any;
  userId: string;
  symbol: string;
  rawAccountType: string;
  proposedTradeRisk: number;
  currentMarketPrice: number;
  propFirmSettings?: any;
  runtimeOverride?: {
    tradeHistoryLoader?: () => Promise<{ trades: any[]; error: any }>;
    openWatchersLoader?: () => Promise<{ watchers: any[]; error: any }>;
    newsChecker?: (symbol: string) => Promise<NewsGateEvaluation>;
  };
}

export interface WatcherPropFirmGateResult {
  passed: boolean;
  allowed?: boolean;
  decision?: string;
  success?: boolean;
  blockReason?: string;
  details?: string;
}

export async function evaluateWatcherPropFirmGate(
  params: WatcherPropFirmGateParams
): Promise<WatcherPropFirmGateResult> {
  const accountType = resolvePersistedAccountType(params.rawAccountType);

  if (accountType === 'personal') {
    return { passed: true };
  }

  const settings = params.propFirmSettings;
  if (!settings) {
    return {
      passed: false,
      blockReason: 'PROP_FIRM_SETTINGS_UNAVAILABLE',
      details: 'Prop firm account type configured but no prop_firm_settings record found.'
    };
  }

  // Check News Restriction for Prop Firm
  if (settings.news_restriction_enabled) {
    const bufferBefore = settings.news_buffer_before_minutes ?? 30;
    const bufferAfter = settings.news_buffer_after_minutes ?? 30;

    let newsResult: NewsGateEvaluation;
    if (params.runtimeOverride?.newsChecker) {
      newsResult = await params.runtimeOverride.newsChecker(params.symbol);
    } else {
      const newsService = new EconomicEventService(params.supabase);
      newsResult = await newsService.checkNewsHardPause(params.symbol, {
        bufferBeforeMinutes: bufferBefore,
        bufferAfterMinutes: bufferAfter
      });
    }

    if (newsResult.status === 'BLOCKED') {
      return {
        passed: false,
        blockReason: 'PROP_FIRM_NEWS_BLOCKED',
        details: newsResult.reason || 'Blocked due to upcoming high-impact economic news.'
      };
    }
  }

  return { passed: true };
}

export { resolvePersistedAccountType, computePropFirmResetBoundaryUtc, calculateSingleOpenWatcherRisk } from './prop-firm-service.js';
