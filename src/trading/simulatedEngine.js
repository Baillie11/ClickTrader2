const { getQuote } = require("../marketData");

function summarizeAccount(account, positions) {
  const positionValue = positions.reduce((sum, position) => {
    return sum + Number(position.quantity || 0) * Number(position.lastPrice || position.avgEntryPrice || 0);
  }, 0);
  return {
    mode: "paper",
    provider: "Local simulator",
    cash: account.cash,
    buyingPower: account.cash,
    equity: account.cash + positionValue,
    status: "SIMULATED",
    dayTradeCount: 0,
    patternDayTrader: false,
    tradingBlocked: false,
    transfersBlocked: false
  };
}

async function placeSimulatedOrder({ store, userId, settings, symbol, side, quantity, orderType, limitPrice }) {
  const quote = await getQuote(symbol, settings.market);
  const executionPrice = orderType === "limit" && limitPrice ? Number(limitPrice) : quote.price;
  const notional = executionPrice * quantity;
  const account = store.getSimulatedAccount(userId);

  if (side === "buy" && account.cash < notional) {
    throw new Error(`Insufficient simulated cash. Needed ${notional.toFixed(2)}, available ${account.cash.toFixed(2)}.`);
  }

  const currentPosition = store.getPortfolio(userId).find((position) => position.symbol === symbol);
  if (side === "sell" && (!currentPosition || currentPosition.quantity < quantity)) {
    throw new Error(`Insufficient simulated ${symbol} shares to sell.`);
  }

  account.cash = side === "buy" ? account.cash - notional : account.cash + notional;
  account.buyingPower = account.cash;
  store.updateSimulatedAccount(userId, account);
  store.upsertPosition(userId, {
    symbol,
    market: settings.market,
    quantity: side === "buy" ? quantity : -quantity,
    price: executionPrice
  });

  return {
    provider: "Local simulator",
    mode: "paper",
    symbol,
    side,
    quantity,
    orderType,
    limitPrice: limitPrice || null,
    status: "filled",
    filledAvgPrice: executionPrice,
    notional,
    source: quote.source
  };
}

module.exports = {
  summarizeAccount,
  placeSimulatedOrder
};
