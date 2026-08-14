
import { BrokerExecutionProvider } from './broker-execution-provider.js';
import { BrokerPosition, BrokerOrder, BrokerReconciliationResult } from './broker-types.js';
import { sendTelegramMessage } from './telegramWrapper.js';

export interface DiscrepancyReport {
  watcherId: string;
  symbol: string;
  type: 'DB_ACTIVE_BROKER_CLOSED' | 'DB_ACTIVE_BROKER_MISSING' | 'BROKER_POSITION_DB_MISSING' | 'ENTRY_PRICE_MISMATCH' | 'QUANTITY_MISMATCH' | 'SL_MISMATCH' | 'TP_MISMATCH' | 'GHOST_POSITION' | 'BROKER_DB_MISMATCH' | 'UNKNOWN_ORDER' | 'UNCERTAIN_ORDER_STATE';
  details: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export class BrokerReconciliationService {
  constructor(private provider: BrokerExecutionProvider, private supabase: any) {}

  async reconcileAll(userId: string): Promise<DiscrepancyReport[]> {
    const reports: DiscrepancyReport[] = [];
    
    // 1. Fetch active watchers from DB
    const { data: dbActiveWatchers, error } = await this.supabase
      .from('watchers')
      .select('*')
      .eq('user_id', userId)
      .eq('trade_status', 'ACTIVE');
      
    if (error) {
      console.error('[Reconciliation] Failed to fetch active watchers:', error);
      return [];
    }

    // 2. Fetch open positions from Broker
    const brokerPositions = await this.provider.getOpenPositions();
    const brokerPosMap = new Map(brokerPositions.map(p => [p.symbol, p]));

    // 3. Compare DB -> Broker
    for (const watcher of dbActiveWatchers || []) {
      const brokerPos = brokerPosMap.get(watcher.selected_pair);
      
      if (!brokerPos) {
        reports.push({
          watcherId: watcher.id,
          symbol: watcher.selected_pair,
          type: 'DB_ACTIVE_BROKER_CLOSED',
          details: `Watcher ${watcher.id} is ACTIVE in DB but no corresponding position found at broker for ${watcher.selected_pair}.`,
          severity: 'HIGH'
        });
        continue;
      }

      // Check for price/quantity mismatches
      const dbQty = watcher.last_signal_data?.quantity || 0;
      if (Math.abs(brokerPos.quantity - dbQty) > 0.0001) {
        reports.push({
          watcherId: watcher.id,
          symbol: watcher.selected_pair,
          type: 'QUANTITY_MISMATCH',
          details: `Quantity mismatch for ${watcher.selected_pair}: DB=${dbQty}, Broker=${brokerPos.quantity}`,
          severity: 'CRITICAL'
        });
      }
      
      const dbSl = watcher.last_signal_data?.stopLoss;
      if (dbSl && brokerPos.sl && Math.abs(brokerPos.sl - dbSl) > 0.0001) {
        reports.push({
          watcherId: watcher.id,
          symbol: watcher.selected_pair,
          type: 'SL_MISMATCH',
          details: `SL mismatch for ${watcher.selected_pair}: DB=${dbSl}, Broker=${brokerPos.sl}`,
          severity: 'HIGH'
        });
      }

      // Check Direction Mismatch
      const dbSide = watcher.last_signal_data?.direction === 'BUY' ? 'LONG' : 'SHORT';
      if (brokerPos.side !== dbSide) {
        reports.push({
          watcherId: watcher.id,
          symbol: watcher.selected_pair,
          type: 'BROKER_DB_MISMATCH',
          details: `Direction mismatch for ${watcher.selected_pair}: DB=${dbSide}, Broker=${brokerPos.side}`,
          severity: 'CRITICAL'
        });
      }
      
      // Mark as reconciled in map
      brokerPosMap.delete(watcher.selected_pair);
    }

    // 4. Compare Broker -> DB (Ghost positions)
    for (const [symbol, pos] of brokerPosMap) {
      reports.push({
        watcherId: 'N/A',
        symbol: symbol,
        type: 'GHOST_POSITION',
        details: `Ghost position found at broker for ${symbol} that is not tracked as ACTIVE in DB. Quantity: ${pos.quantity}`,
        severity: 'CRITICAL'
      });
    }

    // 5. Handle and Log Discrepancies
    if (reports.length > 0) {
      await this.logDiscrepancies(userId, reports);
    }

    return reports;
  }

  private async logDiscrepancies(userId: string, reports: DiscrepancyReport[]) {
    console.warn(`[Reconciliation] Found ${reports.length} discrepancies for user ${userId}`);
    
    // Persist to DB
    const logs = reports.map(r => ({
      user_id: userId,
      watcher_id: r.watcherId === 'N/A' ? null : r.watcherId,
      symbol: r.symbol,
      alert_type: r.type,
      details: r.details,
      severity: r.severity,
      created_at: new Date().toISOString()
    }));

    const { error } = await this.supabase.from('reconciliation_alerts').insert(logs);
    if (error) console.error('[Reconciliation] Failed to save alerts:', error.message);

    // Notify via Telegram for high/critical severity
    const criticalReports = reports.filter(r => r.severity === 'CRITICAL' || r.severity === 'HIGH');
    if (criticalReports.length > 0) {
      const message = `🚨 *RECONCILIATION ALERT*\n\n` + 
        criticalReports.map(r => `*${r.type}* (${r.symbol}): ${r.details}`).join('\n\n');
      
      // Get admin telegram chat ID from user settings or env
      const { data: user } = await this.supabase.from('profiles').select('telegram_chat_id').eq('id', userId).single();
      if (user?.telegram_chat_id) {
        await sendTelegramMessage(user.telegram_chat_id, message);
      }
    }
  }
  
  async reconcileOrder(orderId: string, tradeId: string): Promise<BrokerReconciliationResult> {
    const order = await this.provider.getOrder(orderId);
    if (!order) {
      return { match: false, discrepancies: ['Order not found at broker'], reconciledAt: Date.now() };
    }
    
    const discrepancies: string[] = [];
    if (order.tradeId !== tradeId) {
      discrepancies.push(`Trade ID mismatch: Broker=${order.tradeId}, Expected=${tradeId}`);
    }
    
    return {
      match: discrepancies.length === 0,
      discrepancies,
      reconciledAt: Date.now()
    };
  }
}
