import { 
  BrokerAccount, 
  BrokerOrder, 
  BrokerPosition, 
  BrokerExecution, 
  BrokerPnL,
  OrderType,
  OrderSide,
  OrderStatus,
  BrokerQuote
} from './broker-types.js';

export interface BrokerExecutionProvider {
  // Account
  getAccount(): Promise<BrokerAccount>;
  
  // Market Data
  getQuote(symbol: string): Promise<BrokerQuote>;
  
  // Orders
  placeOrder(order: Partial<BrokerOrder>): Promise<BrokerOrder>;
  getOrder(orderId: string): Promise<BrokerOrder | null>;
  cancelOrder(orderId: string): Promise<boolean>;
  modifyOrder(orderId: string, modifications: Partial<BrokerOrder>): Promise<BrokerOrder>;
  getRecentOrders(limit?: number): Promise<BrokerOrder[]>;
  findOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null>;
  
  // Positions
  getPosition(symbol: string): Promise<BrokerPosition | null>;
  getOpenPositions(): Promise<BrokerPosition[]>;
  closePosition(symbol: string): Promise<boolean>;
  
  // History
  getExecutionHistory(symbol?: string, limit?: number): Promise<BrokerExecution[]>;
  getTradePnL(tradeId: string): Promise<BrokerPnL | null>;
}

export class TheoreticalBrokerProvider implements BrokerExecutionProvider {
  private orders: Map<string, BrokerOrder> = new Map();
  private positions: Map<string, BrokerPosition> = new Map();

  async getAccount(): Promise<BrokerAccount> {
    return {
      accountId: 'theo-account',
      currency: 'USD',
      balance: 10000,
      equity: 10000,
      marginUsed: 0,
      marginAvailable: 10000,
      unrealizedPnL: 0,
      leveragedAmount: 0,
      status: 'ENABLED'
    };
  }

  async getQuote(symbol: string): Promise<BrokerQuote> {
    // In theoretical mode, we just return a placeholder or simulate from market data if needed
    // For now, let's just provide a basic implementation that can be used for testing
    return {
      symbol,
      bid: 1.0,
      ask: 1.0002, // 2 pip spread
      spread: 0.0002,
      timestamp: Date.now(),
      source: 'THEORETICAL'
    };
  }

  async placeOrder(order: Partial<BrokerOrder>): Promise<BrokerOrder> {
    const newOrder: BrokerOrder = {
      orderId: 'theo-ord-' + Math.random().toString(36).substring(7),
      clientOrderId: order.clientOrderId,
      tradeId: order.tradeId,
      symbol: order.symbol || 'UNKNOWN',
      type: order.type || 'MARKET',
      side: order.side || 'BUY',
      quantity: order.quantity || 0,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
      status: 'FILLED',
      filledQuantity: order.quantity || 0,
      remainingQuantity: 0,
      averageFillPrice: order.price,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.orders.set(newOrder.orderId, newOrder);

    if (newOrder.status === 'FILLED') {
      const positionId = 'theo-pos-' + newOrder.symbol;
      this.positions.set(newOrder.symbol, {
        positionId,
        symbol: newOrder.symbol,
        side: newOrder.side === 'BUY' ? 'LONG' : 'SHORT',
        quantity: newOrder.quantity,
        averageEntryPrice: newOrder.averageFillPrice || 0,
        currentPrice: newOrder.averageFillPrice || 0,
        sl: newOrder.sl,
        tp: newOrder.tp,
        unrealizedPnL: 0,
        realizedPnL: 0,
        swap: 0,
        commission: 0,
        openedAt: Date.now()
      });
    }

    return newOrder;
  }

  async getOrder(orderId: string): Promise<BrokerOrder | null> {
    return this.orders.get(orderId) || null;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = 'CANCELED';
      order.updatedAt = Date.now();
      return true;
    }
    return false;
  }

  async modifyOrder(orderId: string, mods: Partial<BrokerOrder>): Promise<BrokerOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error('Order not found');
    const updated = { ...order, ...mods, updatedAt: Date.now() };
    this.orders.set(orderId, updated);
    return updated;
  }

  async getRecentOrders(limit = 10): Promise<BrokerOrder[]> {
    return Array.from(this.orders.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  async findOrderByClientOrderId(clientOrderId: string): Promise<BrokerOrder | null> {
    for (const order of this.orders.values()) {
      if (order.clientOrderId === clientOrderId) return order;
    }
    return null;
  }

  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    return this.positions.get(symbol) || null;
  }

  async getOpenPositions(): Promise<BrokerPosition[]> {
    return Array.from(this.positions.values());
  }

  async closePosition(symbol: string): Promise<boolean> {
    return this.positions.delete(symbol);
  }

  async getExecutionHistory(symbol?: string, limit = 50): Promise<BrokerExecution[]> {
    return [];
  }

  async getTradePnL(tradeId: string): Promise<BrokerPnL | null> {
    return null;
  }
}

export const defaultBrokerProvider = new TheoreticalBrokerProvider();
