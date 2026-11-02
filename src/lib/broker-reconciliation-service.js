import { sendTelegramMessage } from './telegramWrapper.js';
export class BrokerReconciliationService {
    provider;
    supabase;
    constructor(provider, supabase) {
        this.provider = provider;
        this.supabase = supabase;
    }
    async reconcileAll(userId) {
        const reports = [];
        const { data: dbActiveWatchers, error } = await this.supabase
            .from('watchers')
            .select('*')
            .eq('user_id', userId)
            .eq('trade_status', 'ACTIVE');
        if (error) {
            console.error('[Reconciliation] Failed to fetch active watchers:', error);
            return [];
        }
        const brokerPositions = await this.provider.getOpenPositions();
        const brokerPosMap = new Map(brokerPositions.map(p => [p.symbol, p]));
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
            brokerPosMap.delete(watcher.selected_pair);
        }
        for (const [symbol, pos] of brokerPosMap) {
            reports.push({
                watcherId: 'N/A',
                symbol: symbol,
                type: 'GHOST_POSITION',
                details: `Ghost position found at broker for ${symbol} that is not tracked as ACTIVE in DB. Quantity: ${pos.quantity}`,
                severity: 'CRITICAL'
            });
        }
        if (reports.length > 0) {
            await this.logDiscrepancies(userId, reports);
        }
        return reports;
    }
    async logDiscrepancies(userId, reports) {
        console.warn(`[Reconciliation] Found ${reports.length} discrepancies for user ${userId}`);
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
        if (error)
            console.error('[Reconciliation] Failed to save alerts:', error.message);
        const criticalReports = reports.filter(r => r.severity === 'CRITICAL' || r.severity === 'HIGH');
        if (criticalReports.length > 0) {
            const message = `🚨 *RECONCILIATION ALERT*\n\n` +
                criticalReports.map(r => `*${r.type}* (${r.symbol}): ${r.details}`).join('\n\n');
            const { data: user } = await this.supabase.from('profiles').select('telegram_chat_id').eq('id', userId).single();
            if (user?.telegram_chat_id) {
                await sendTelegramMessage(user.telegram_chat_id, message);
            }
        }
    }
    async reconcileOrder(orderId, tradeId) {
        const order = await this.provider.getOrder(orderId);
        if (!order) {
            return { match: false, discrepancies: ['Order not found at broker'], reconciledAt: Date.now() };
        }
        const discrepancies = [];
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
