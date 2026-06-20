const { getMarketStatus } = require("../marketHours");
const { getQuoteBatch } = require("../marketData");
const {
  hasAlpacaCredentials,
  getAlpacaAccount,
  getAlpacaPositions,
  placeAlpacaOrder
} = require("./alpacaEngine");
const { summarizeAccount, placeSimulatedOrder } = require("./simulatedEngine");
const { getStrategyById } = require("../strategyRegistry");

function assertTradingAllowed({ settings, confirmLive }) {
  const marketStatus = getMarketStatus(settings.market, settings.timezone);
  if (settings.requireMarketOpen && !marketStatus.isOpen) {
    throw new Error(`${marketStatus.name} is closed. Disable the market-hours guard to test outside live hours.`);
  }

  if (settings.tradeMode === "live") {
    if (!settings.allowLiveTrading || !confirmLive) {
      throw new Error("Live trading requires the live trading toggle and the per-order confirmation checkbox.");
    }
    if (!hasAlpacaCredentials("live")) {
      throw new Error("Live Alpaca credentials are not configured.");
    }
  }
}

function normalizeQuantity(quantity) {
  const parsed = Math.floor(Number(quantity || 0));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Quantity must be greater than zero.");
  return parsed;
}

function createTradingService({ store }) {
  return {
    async getAccount({ user, settings }) {
      if (settings.deskLiveEnabled && (settings.tradeMode === "live" || hasAlpacaCredentials("paper"))) {
        try {
          const account = await getAlpacaAccount(settings.tradeMode);
          if (account) {
            const positions = await getAlpacaPositions(settings.tradeMode);
            store.replacePortfolio(user.id, positions);
            return account;
          }
        } catch (error) {
          return {
            provider: "Alpaca",
            mode: settings.tradeMode,
            status: "UNAVAILABLE",
            error: error.message,
            cash: 0,
            buyingPower: 0,
            equity: 0
          };
        }
      }

      return summarizeAccount(store.getSimulatedAccount(user.id), store.getPortfolio(user.id));
    },

    async placeOrder({ user, settings, symbol, side, quantity, orderType, limitPrice, confirmLive, strategyId, executionReason }) {
      const effectiveStrategyId = strategyId || settings.strategyId || "manual";
      const strategyDefinition = getStrategyById(effectiveStrategyId);
      const cleanSymbol = String(symbol || "").trim().toUpperCase();
      if (!cleanSymbol) throw new Error("A symbol is required.");
      if (!["buy", "sell"].includes(side)) throw new Error("Side must be buy or sell.");
      const cleanQuantity = normalizeQuantity(quantity);
      const cleanOrderType = orderType === "limit" ? "limit" : "market";
      const cleanLimitPrice = cleanOrderType === "limit" ? Number(limitPrice) : null;
      if (cleanOrderType === "limit" && (!cleanLimitPrice || cleanLimitPrice <= 0)) {
        throw new Error("Limit orders require a positive limit price.");
      }

      assertTradingAllowed({ settings, confirmLive });

      const beforePosition = store.getPortfolio(user.id).find((position) => {
        return position.symbol === cleanSymbol && (position.market || null) === (settings.market || null);
      });
      const useAlpaca = settings.deskLiveEnabled && (settings.tradeMode === "live" || hasAlpacaCredentials("paper"));
      const order = useAlpaca
        ? await placeAlpacaOrder({
          mode: settings.tradeMode,
          symbol: cleanSymbol,
          side,
          quantity: cleanQuantity,
          orderType: cleanOrderType,
          limitPrice: cleanLimitPrice
        })
        : await placeSimulatedOrder({
          store,
          userId: user.id,
          settings,
          symbol: cleanSymbol,
          side,
          quantity: cleanQuantity,
          orderType: cleanOrderType,
          limitPrice: cleanLimitPrice
        });

      store.addOrder(user.id, order);
      const executionPrice = order.filledAvgPrice || cleanLimitPrice || 0;
      const notional = order.notional || cleanQuantity * executionPrice;
      const profitLoss = side === "sell" && beforePosition
        ? (executionPrice - Number(beforePosition.avgEntryPrice || 0)) * cleanQuantity
        : 0;
      const profitLossPercent = side === "sell" && beforePosition?.avgEntryPrice
        ? ((executionPrice - beforePosition.avgEntryPrice) / beforePosition.avgEntryPrice) * 100
        : 0;
      const trade = store.addTrade(user.id, {
        symbol: cleanSymbol,
        market: settings.market,
        side,
        quantity: cleanQuantity,
        price: executionPrice,
        notional,
        mode: order.mode,
        provider: order.provider,
        status: order.status,
        strategyId: effectiveStrategyId,
        strategyName: strategyDefinition.name,
        profitLoss,
        profitLossPercent
      });
      store.addTradeLog(user.id, {
        tradeId: trade.id,
        tradeDate: trade.createdAt,
        market: settings.market,
        symbol: cleanSymbol,
        side,
        quantity: cleanQuantity,
        price: executionPrice,
        notional,
        strategyId: effectiveStrategyId,
        strategyName: strategyDefinition.name,
        provider: order.provider,
        mode: order.mode,
        status: order.status,
        profitLoss,
        profitLossPercent,
        reason: executionReason || "manual order",
        orderType: cleanOrderType,
        brokerOrderId: order.brokerOrderId || ""
      });
      return order;
    },

    async runStrategy({ user, settings, strategy, execute, confirmLive }) {
      const lastRunAt = strategy.lastRunAt ? new Date(strategy.lastRunAt).getTime() : 0;
      const elapsedSeconds = (Date.now() - lastRunAt) / 1000;
      if (elapsedSeconds < strategy.cooldownSeconds) {
        throw new Error(`Strategy cooldown active. Try again in ${Math.ceil(strategy.cooldownSeconds - elapsedSeconds)} seconds.`);
      }

      if (execute) assertTradingAllowed({ settings, confirmLive });

      const portfolio = store.getPortfolio(user.id).filter((position) => {
        return position.market === settings.market || (!position.market && settings.watchlist.includes(position.symbol));
      });
      const quotes = await getQuoteBatch(settings.watchlist, settings.market);
      const strategyDefinition = getStrategyById(settings.strategyId);
      const plan = strategyDefinition.evaluate({
        settings,
        portfolio,
        quotes,
        controls: strategy
      });
      const executed = [];

      if (execute) {
        for (const item of plan) {
          const order = await this.placeOrder({
            user,
            settings,
            symbol: item.symbol,
            side: item.side,
            quantity: item.quantity,
            orderType: "market",
            confirmLive,
            strategyId: settings.strategyId,
            executionReason: item.reason
          });
          executed.push(order);
        }
      }

      store.markStrategyRun(user.id);

      return {
        execute,
        message: execute
          ? `Strategy run complete. ${executed.length} order(s) submitted.`
          : `Strategy preview complete. ${plan.length} candidate action(s) found.`,
        generatedAt: new Date().toISOString(),
        strategyId: settings.strategyId,
        strategyName: strategyDefinition.name,
        plan,
        executed
      };
    }
  };
}

module.exports = { createTradingService };
