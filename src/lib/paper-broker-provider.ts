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
import { BrokerExecutionProvider } from './broker-execution-provider.js';
import { defaultMarketDataService } from './market-data-service.js';

export class PaperBrokerProvider implements BrokerExecutionProvider {
  private orders: Map<string, BrokerOrder> = new Map();
  private positions: Map<string, BrokerPosition> = new Map();
  private executions: BrokerExecution[] = [];
  private balance: number = 10000;
  private equity: number = 10000;
  private commissionPerLot: number = 3.50; // $3.50 per standard lot
  private feePerTrade: number = 0.50; // $0.50 flat fee

  constructor(initialBalance: number = 10000) {
    this.balance = initialBalance;
    this.equity = initialBalance;
    this.loadState();
  }

  private loadState() {
    // In a real environment, this might load from a file or specific paper_broker_state table
    // For this implementation, we rely on the DB being the source of truth via reconciliation
    // but we can simulate local state for the duration of the provider instance.
  }

  async getAccount(): Promise<BrokerAccount> {
    await this.updateEquity();
    return {
      accountId: 'paper-account',
      currency: 'USD',
      balance: this.balance,
      equity: this.equity,
      marginUsed: 0,
      marginAvailable: this.equity,
      unrealizedPnL: this.equity - this.balance,
      leveragedAmount: 0,
      status: 'ENABLED'
    };
  }

  async getQuote(symbol: string): Promise<BrokerQuote> {
    try {
      const price = await defaultMarketDataService.fetchCurrentPrice(symbol);
      if (price === null) throw new Error("Price not available");
      
      // Simulate realistic spread (variable)
      const baseSpread = price * 0.0001; // 1 pip base
      const volatilityModifier = 1 + (Math.random() * 0.5); // Up to 50% spread expansion
      const actualSpread = baseSpread * volatilityModifier;

      return {
        symbol,
        bid: price - (actualSpread / 2),
        ask: price + (actualSpread / 2),
        spread: actualSpread,
        timestamp: Date.now(),
        source: 'PAPER_SIM'
      };
    } catch (err) {
      return {
        symbol,
        bid: 1.0,
        ask: 1.0002,
        spread: 0.0002,
        timestamp: Date.now(),
        source: 'PAPER_FALLBACK'
      };
    }
  }

  async placeOrder(order: Partial<BrokerOrder>): Promise<BrokerOrder> {
    const orderId = 'paper-ord-' + Math.random().toString(36).substring(7);
    
    // 1. Initial State: SUBMITTED
    const newOrder: BrokerOrder = {
      orderId,
      clientOrderId: order.clientOrderId,
      tradeId: order.tradeId,
      symbol: order.symbol || 'UNKNOWN',
      type: order.type || 'MARKET',
      side: order.side || 'BUY',
      quantity: order.quantity || 0,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
      status: 'SUBMITTED',
      filledQuantity: 0,
      remainingQuantity: order.quantity || 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.orders.set(orderId, newOrder);

    // 2. Transition: ACCEPTED (simulate network/broker delay)
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
    newOrder.status = 'ACCEPTED';
    newOrder.updatedAt = Date.now();

    // 3. Execution (Simulate Fill)
    const quote = await this.getQuote(newOrder.symbol);
    const requestedPrice = newOrder.side === 'BUY' ? quote.ask : quote.bid;
    
    // Simulate Slippage
    const slippagePips = (Math.random() * 0.0001) - 0.00002; // -0.2 to +1.0 pips
    const actualFillPrice = newOrder.side === 'BUY' ? requestedPrice + slippagePips : requestedPrice - slippagePips;

    // Costs
    const lotSize = newOrder.quantity;
    const commission = lotSize * this.commissionPerLot;
    const totalFees = this.feePerTrade + commission;

    newOrder.status = 'FILLED';
    newOrder.filledQuantity = newOrder.quantity;
    newOrder.remainingQuantity = 0;
    newOrder.averageFillPrice = actualFillPrice;
    newOrder.updatedAt = Date.now();

    // Create execution record
    const execution: BrokerExecution = {
      executionId: 'paper-exec-' + Math.random().toString(36).substring(7),
      orderId: newOrder.orderId,
      symbol: newOrder.symbol,
      side: newOrder.side,
      quantity: newOrder.quantity,
      price: actualFillPrice,
      commission: commission,
      timestamp: Date.now(),
      slippage: slippagePips
    };
    this.executions.push(execution);
    this.balance -= totalFees;

    // 4. Position Management
    const positionId = 'paper-pos-' + newOrder.symbol;
    const existingPos = this.positions.get(newOrder.symbol);

    if (existingPos) {
      // Aggregate position (simplified for paper)
      const totalQty = existingPos.quantity + newOrder.quantity;
      const avgPrice = ((existingPos.averageEntryPrice * existingPos.quantity) + (actualFillPrice * newOrder.quantity)) / totalQty;
      
      this.positions.set(newOrder.symbol, {
        ...existingPos,
        quantity: totalQty,
        averageEntryPrice: avgPrice,
        currentPrice: actualFillPrice,
        commission: existingPos.commission + commission,
        sl: newOrder.sl || existingPos.sl,
        tp: newOrder.tp || existingPos.tp
      });
    } else {
      this.positions.set(newOrder.symbol, {
        positionId,
        symbol: newOrder.symbol,
        side: newOrder.side === 'BUY' ? 'LONG' : 'SHORT',
        quantity: newOrder.quantity,
        averageEntryPrice: actualFillPrice,
        currentPrice: actualFillPrice,
        sl: newOrder.sl,
        tp: newOrder.tp,
        unrealizedPnL: 0,
        realizedPnL: 0,
        swap: 0,
        commission: commission,
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
    const pos = this.positions.get(symbol);
    if (!pos) return false;

    const quote = await this.getQuote(symbol);
    const exitPrice = pos.side === 'LONG' ? quote.bid : quote.ask;
    
    const pnl = pos.side === 'LONG' 
      ? (exitPrice - pos.averageEntryPrice) * pos.quantity
      : (pos.averageEntryPrice - exitPrice) * pos.quantity;

    this.balance += pnl;
    this.positions.delete(symbol);
    return true;
  }

  async getExecutionHistory(symbol?: string, limit = 50): Promise<BrokerExecution[]> {
    let filtered = this.executions;
    if (symbol) {
      filtered = filtered.filter(e => e.symbol === symbol);
    }
    return filtered.slice(-limit).reverse();
  }

  async getTradePnL(tradeId: string): Promise<BrokerPnL | null> {
    return null;
  }

  private updateEquity() {
    let unrealized = 0;
    // We'd need current prices for all positions to be really accurate
    // For paper mode we can just use the last known price or 0 for now
    this.equity = this.balance + unrealized;
  }
}
