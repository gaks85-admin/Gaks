import { defaultMarketDataService } from "./market-data-service.js";
class PaperBrokerProvider {
  orders = /* @__PURE__ */ new Map();
  positions = /* @__PURE__ */ new Map();
  executions = [];
  balance = 1e4;
  equity = 1e4;
  commissionPerLot = 3.5;
  // $3.50 per standard lot
  feePerTrade = 0.5;
  // $0.50 flat fee
  constructor(initialBalance = 1e4) {
    this.balance = initialBalance;
    this.equity = initialBalance;
    this.loadState();
  }
  loadState() {
  }
  async getAccount() {
    await this.updateEquity();
    return {
      accountId: "paper-account",
      currency: "USD",
      balance: this.balance,
      equity: this.equity,
      marginUsed: 0,
      marginAvailable: this.equity,
      unrealizedPnL: this.equity - this.balance,
      leveragedAmount: 0,
      status: "ENABLED"
    };
  }
  async getQuote(symbol) {
    try {
      const price = await defaultMarketDataService.fetchCurrentPrice(symbol);
      if (price === null) throw new Error("Price not available");
      const baseSpread = price * 1e-4;
      const volatilityModifier = 1 + Math.random() * 0.5;
      const actualSpread = baseSpread * volatilityModifier;
      return {
        symbol,
        bid: price - actualSpread / 2,
        ask: price + actualSpread / 2,
        spread: actualSpread,
        timestamp: Date.now(),
        source: "PAPER_SIM"
      };
    } catch (err) {
      return {
        symbol,
        bid: 1,
        ask: 1.0002,
        spread: 2e-4,
        timestamp: Date.now(),
        source: "PAPER_FALLBACK"
      };
    }
  }
  async placeOrder(order) {
    const orderId = "paper-ord-" + Math.random().toString(36).substring(7);
    const newOrder = {
      orderId,
      clientOrderId: order.clientOrderId,
      tradeId: order.tradeId,
      symbol: order.symbol || "UNKNOWN",
      type: order.type || "MARKET",
      side: order.side || "BUY",
      quantity: order.quantity || 0,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
      status: "SUBMITTED",
      filledQuantity: 0,
      remainingQuantity: order.quantity || 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.orders.set(orderId, newOrder);
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
    newOrder.status = "ACCEPTED";
    newOrder.updatedAt = Date.now();
    const quote = await this.getQuote(newOrder.symbol);
    const requestedPrice = newOrder.side === "BUY" ? quote.ask : quote.bid;
    const slippagePips = Math.random() * 1e-4 - 2e-5;
    const actualFillPrice = newOrder.side === "BUY" ? requestedPrice + slippagePips : requestedPrice - slippagePips;
    const lotSize = newOrder.quantity;
    const commission = lotSize * this.commissionPerLot;
    const totalFees = this.feePerTrade + commission;
    newOrder.status = "FILLED";
    newOrder.filledQuantity = newOrder.quantity;
    newOrder.remainingQuantity = 0;
    newOrder.averageFillPrice = actualFillPrice;
    newOrder.updatedAt = Date.now();
    const execution = {
      executionId: "paper-exec-" + Math.random().toString(36).substring(7),
      orderId: newOrder.orderId,
      symbol: newOrder.symbol,
      side: newOrder.side,
      quantity: newOrder.quantity,
      price: actualFillPrice,
      commission,
      timestamp: Date.now(),
      slippage: slippagePips
    };
    this.executions.push(execution);
    this.balance -= totalFees;
    const positionId = "paper-pos-" + newOrder.symbol;
    const existingPos = this.positions.get(newOrder.symbol);
    if (existingPos) {
      const totalQty = existingPos.quantity + newOrder.quantity;
      const avgPrice = (existingPos.averageEntryPrice * existingPos.quantity + actualFillPrice * newOrder.quantity) / totalQty;
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
        side: newOrder.side === "BUY" ? "LONG" : "SHORT",
        quantity: newOrder.quantity,
        averageEntryPrice: actualFillPrice,
        currentPrice: actualFillPrice,
        sl: newOrder.sl,
        tp: newOrder.tp,
        unrealizedPnL: 0,
        realizedPnL: 0,
        swap: 0,
        commission,
        openedAt: Date.now()
      });
    }
    return newOrder;
  }
  async getOrder(orderId) {
    return this.orders.get(orderId) || null;
  }
  async cancelOrder(orderId) {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = "CANCELED";
      order.updatedAt = Date.now();
      return true;
    }
    return false;
  }
  async modifyOrder(orderId, mods) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("Order not found");
    const updated = { ...order, ...mods, updatedAt: Date.now() };
    this.orders.set(orderId, updated);
    return updated;
  }
  async getRecentOrders(limit = 10) {
    return Array.from(this.orders.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
  async findOrderByClientOrderId(clientOrderId) {
    for (const order of this.orders.values()) {
      if (order.clientOrderId === clientOrderId) return order;
    }
    return null;
  }
  async getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }
  async getOpenPositions() {
    return Array.from(this.positions.values());
  }
  async closePosition(symbol) {
    const pos = this.positions.get(symbol);
    if (!pos) return false;
    const quote = await this.getQuote(symbol);
    const exitPrice = pos.side === "LONG" ? quote.bid : quote.ask;
    const pnl = pos.side === "LONG" ? (exitPrice - pos.averageEntryPrice) * pos.quantity : (pos.averageEntryPrice - exitPrice) * pos.quantity;
    this.balance += pnl;
    this.positions.delete(symbol);
    return true;
  }
  async getExecutionHistory(symbol, limit = 50) {
    let filtered = this.executions;
    if (symbol) {
      filtered = filtered.filter((e) => e.symbol === symbol);
    }
    return filtered.slice(-limit).reverse();
  }
  async getTradePnL(tradeId) {
    return null;
  }
  updateEquity() {
    let unrealized = 0;
    this.equity = this.balance + unrealized;
  }
}
export {
  PaperBrokerProvider
};
