const { getMarketStatus } = require("../marketHours");
const { getQuoteBatch } = require("../marketData");
const {
  hasAlpacaCredentials,
  getAlpacaAccount,
  getAlpacaPositions,
  placeAlpacaOrder
} = require("./alpacaEngine");
const {
  hasIbkrConfig,
  getIbkrAccount,
  placeIbkrOrder
} = require("./ibkrEngine");
const { summarizeAccount, placeSimulatedOrder } = require("./simulatedEngine");
const { getStrategyById } = require("../strategyRegistry");

function assertTradingAllowed({ settings, confirmLive }) {
  const marketStatus = getMarketStatus(settings.market, settings.timezone);
  if (settings.tradeMode === "live" && settings.requireMarketOpen && !marketStatus.isOpen) {
    throw new Error(`${marketStatus.name} is closed. Disable the market-hours guard to test outside live hours.`);
  }

  if (settings.tradeMode === "live") {
    if (!settings.allowLiveTrading || !confirmLive) {
      throw new Error("Live trading requires the live trading toggle and the per-order confirmation checkbox.");
    }
    if (settings.market === "asx") {
      if (!hasIbkrConfig(settings)) {
        throw new Error("AUS live trading requires an IBKR broker account ID and Client Portal endpoint in Settings.");
      }
    } else if (!hasAlpacaCredentials("live")) {
      throw new Error("Live Alpaca credentials are not configured.");
    }
  }
}

function normalizeQuantity(quantity) {
  const parsed = Math.floor(Number(quantity || 0));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Quantity must be greater than zero.");
  return parsed;
}

function formatBps(value) {
  const numeric = Number(value || 0);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(0)} bps`;
}

function buildStrategyAssessment({ settings, portfolio, quotes, controls, scanCandidates, plan }) {
  const plannedBySymbol = new Map(plan.map((item) => [item.symbol, item]));
  const candidateSymbols = scanCandidates.length
    ? scanCandidates.map((candidate) => candidate.symbol)
    : settings.watchlist;
  const symbols = [...new Set([
    ...portfolio.map((position) => position.symbol),
    ...candidateSymbols
  ])];
  const openSlots = Math.max(0, controls.maxOpenPositions - portfolio.length);

  return symbols.map((symbol) => {
    const quote = quotes[symbol] || {};
    const planned = plannedBySymbol.get(symbol);
    const position = portfolio.find((item) => item.symbol === symbol);
    const candidate = scanCandidates.find((item) => item.symbol === symbol);
    const price = Number(quote.price || candidate?.price || 0);
    const changePercent = Number(quote.changePercent ?? candidate?.changePercent ?? 0);
    const volume = Number(quote.volume ?? candidate?.volume ?? 0);
    const spreadBps = Number(quote.spreadBps || 0);

    if (planned) {
      return {
        symbol,
        market: settings.market,
        action: planned.side === "sell" ? "SELL" : "BUY",
        decision: planned.side === "sell" ? "Sell planned" : "Buy planned",
        reason: planned.reason,
        price,
        changePercent,
        volume,
        quantity: planned.quantity,
        score: planned.score || 0
      };
    }

    if (position) {
      const moveBps = position.avgEntryPrice && price
        ? ((price - position.avgEntryPrice) / position.avgEntryPrice) * 10000
        : 0;
      return {
        symbol,
        market: settings.market,
        action: "HOLD",
        decision: "No sell",
        reason: `Holding. Current move ${formatBps(moveBps)} has not reached target ${controls.targetProfitBps} bps or stop -${controls.stopLossBps} bps.`,
        price,
        changePercent,
        volume,
        quantity: position.quantity,
        score: Math.abs(moveBps)
      };
    }

    const reasons = [];
    if (!quote || quote.error || !price) reasons.push(quote.error || "No usable price from Yahoo Finance.");
    if (openSlots <= 0) reasons.push(`Maximum open positions reached (${controls.maxOpenPositions}).`);
    if (price && controls.maxAllocationPerTrade < price) reasons.push(`Price $${price.toFixed(2)} is above the per-trade allocation $${Number(controls.maxAllocationPerTrade || 0).toFixed(2)}.`);
    if (changePercent < 0.3) reasons.push(`Momentum ${changePercent.toFixed(2)}% is below the 0.30% buy threshold.`);
    if (volume < controls.minVolume) reasons.push(`Volume ${volume.toLocaleString()} is below the ${Number(controls.minVolume || 0).toLocaleString()} minimum.`);
    if (spreadBps > controls.maxSpreadBps) reasons.push(`Spread ${spreadBps.toFixed(0)} bps is above the ${controls.maxSpreadBps} bps limit.`);
    if (!reasons.length) reasons.push("Passed basic checks but ranked below stronger candidates or no position slot was available.");

    return {
      symbol,
      market: settings.market,
      action: "SKIP",
      decision: "No buy",
      reason: reasons.join(" "),
      price,
      changePercent,
      volume,
      quantity: 0,
      score: candidate?.score || 0
    };
  });
}

function createTradingService({ store }) {
  return {
    async getAccount({ user, settings }) {
      if (settings.market === "asx" && settings.tradeMode === "live" && hasIbkrConfig(settings)) {
        try {
          const account = await getIbkrAccount(settings);
          if (account) return account;
        } catch (error) {
          return {
            provider: "IBKR Client Portal",
            mode: settings.tradeMode,
            status: "UNAVAILABLE",
            error: error.message,
            cash: 0,
            buyingPower: 0,
            equity: 0
          };
        }
      }

      if (settings.market !== "asx" && settings.deskLiveEnabled && (settings.tradeMode === "live" || hasAlpacaCredentials("paper"))) {
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
      if (settings.tradeMode === "paper") {
        store.recordPaperPhaseStart(user.id);
      }

      const beforePosition = store.getPortfolio(user.id).find((position) => {
        return position.symbol === cleanSymbol && (position.market || null) === (settings.market || null);
      });
      const useIbkr = settings.market === "asx" && settings.tradeMode === "live" && hasIbkrConfig(settings);
      const useAlpaca = !useIbkr && settings.market !== "asx" && settings.deskLiveEnabled && (settings.tradeMode === "live" || hasAlpacaCredentials("paper"));
      const order = useIbkr
        ? await placeIbkrOrder({
          settings,
          symbol: cleanSymbol,
          side,
          quantity: cleanQuantity,
          orderType: cleanOrderType,
          limitPrice: cleanLimitPrice
        })
        : useAlpaca
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

    async runStrategy({ user, settings, strategy, execute, confirmLive, scanCandidates = [] }) {
      const lastRunAt = strategy.lastRunAt ? new Date(strategy.lastRunAt).getTime() : 0;
      const elapsedSeconds = (Date.now() - lastRunAt) / 1000;
      if (elapsedSeconds < strategy.cooldownSeconds) {
        throw new Error(`Strategy cooldown active. Try again in ${Math.ceil(strategy.cooldownSeconds - elapsedSeconds)} seconds.`);
      }

      if (execute) assertTradingAllowed({ settings, confirmLive });

      const portfolio = store.getPortfolio(user.id).filter((position) => {
        return position.market === settings.market || (!position.market && settings.watchlist.includes(position.symbol));
      });
      const candidateSymbols = scanCandidates.map((c) => c.symbol);
      const symbolsToFetch = [...new Set([...settings.watchlist, ...candidateSymbols])];
      const quotes = await getQuoteBatch(symbolsToFetch, settings.market);
      const strategyDefinition = getStrategyById(settings.strategyId);
      const plan = strategyDefinition.evaluate({
        settings,
        portfolio,
        quotes,
        controls: strategy,
        scanCandidates
      });
      const assessment = buildStrategyAssessment({
        settings,
        portfolio,
        quotes,
        controls: strategy,
        scanCandidates,
        plan
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
        market: settings.market,
        strategyId: settings.strategyId,
        strategyName: strategyDefinition.name,
        assessment,
        plan,
        executed
      };
    }
  };
}

module.exports = { createTradingService };
