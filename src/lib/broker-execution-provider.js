class TheoreticalBrokerProvider {
  orders = /* @__PURE__ */ new Map();
  positions = /* @__PURE__ */ new Map();
  async getAccount() {
    return {
      accountId: "theo-account",
      currency: "USD",
      balance: 1e4,
      equity: 1e4,
      marginUsed: 0,
      marginAvailable: 1e4,
      unrealizedPnL: 0,
      leveragedAmount: 0,
      status: "ENABLED"
    };
  }
  async getQuote(symbol) {
    return {
      symbol,
      bid: 1,
      ask: 1.0002,
      // 2 pip spread
      spread: 2e-4,
      timestamp: Date.now(),
      source: "THEORETICAL"
    };
  }
  async placeOrder(order) {
    const newOrder = {
      orderId: "theo-ord-" + Math.random().toString(36).substring(7),
      clientOrderId: order.clientOrderId,
      tradeId: order.tradeId,
      symbol: order.symbol || "UNKNOWN",
      type: order.type || "MARKET",
      side: order.side || "BUY",
      quantity: order.quantity || 0,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
      status: "FILLED",
      filledQuantity: order.quantity || 0,
      remainingQuantity: 0,
      averageFillPrice: order.price,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.orders.set(newOrder.orderId, newOrder);
    if (newOrder.status === "FILLED") {
      const positionId = "theo-pos-" + newOrder.symbol;
      this.positions.set(newOrder.symbol, {
        positionId,
        symbol: newOrder.symbol,
        side: newOrder.side === "BUY" ? "LONG" : "SHORT",
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
    return this.positions.delete(symbol);
  }
  async getExecutionHistory(symbol, limit = 50) {
    return [];
  }
  async getTradePnL(tradeId) {
    return null;
  }
}
const defaultBrokerProvider = new TheoreticalBrokerProvider();
export {
  TheoreticalBrokerProvider,
  defaultBrokerProvider
};
