function getAlpacaConfig(mode) {
  const live = mode === "live";
  return {
    keyId: live ? process.env.ALPACA_LIVE_KEY : process.env.ALPACA_PAPER_KEY,
    secretKey: live ? process.env.ALPACA_LIVE_SECRET : process.env.ALPACA_PAPER_SECRET,
    baseUrl: live
      ? process.env.ALPACA_LIVE_BASE_URL || "https://api.alpaca.markets"
      : process.env.ALPACA_PAPER_BASE_URL || "https://paper-api.alpaca.markets",
    paper: !live
  };
}

function hasAlpacaCredentials(mode) {
  const config = getAlpacaConfig(mode);
  return Boolean(config.keyId && config.secretKey);
}

function getHeaders(mode) {
  const config = getAlpacaConfig(mode);
  if (!config.keyId || !config.secretKey) return null;
  return {
    "APCA-API-KEY-ID": config.keyId,
    "APCA-API-SECRET-KEY": config.secretKey,
    "Content-Type": "application/json"
  };
}

async function alpacaRequest(mode, endpoint, options = {}) {
  const config = getAlpacaConfig(mode);
  const headers = getHeaders(mode);
  if (!headers) return null;

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v2${endpoint}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Alpaca request failed with ${response.status}`);
  }
  return payload;
}

async function getAlpacaAccount(mode) {
  const account = await alpacaRequest(mode, "/account");
  if (!account) return null;
  return {
    mode,
    provider: "Alpaca",
    cash: Number(account.cash || 0),
    buyingPower: Number(account.buying_power || account.buyingPower || 0),
    equity: Number(account.equity || 0),
    status: account.status,
    dayTradeCount: Number(account.daytrade_count || account.day_trade_count || 0),
    patternDayTrader: Boolean(account.pattern_day_trader),
    tradingBlocked: Boolean(account.trading_blocked),
    transfersBlocked: Boolean(account.transfers_blocked)
  };
}

async function getAlpacaPositions(mode) {
  const positions = await alpacaRequest(mode, "/positions");
  if (!positions) return [];
  return positions.map((position) => ({
    symbol: position.symbol,
    quantity: Number(position.qty || 0),
    avgEntryPrice: Number(position.avg_entry_price || 0),
    currentPrice: Number(position.current_price || 0),
    marketValue: Number(position.market_value || 0),
    unrealizedPl: Number(position.unrealized_pl || 0),
    unrealizedPlPercent: Number(position.unrealized_plpc || 0) * 100
  }));
}

async function placeAlpacaOrder({ mode, symbol, side, quantity, orderType, limitPrice }) {
  if (!hasAlpacaCredentials(mode)) {
    throw new Error(`Missing Alpaca ${mode} credentials.`);
  }

  const request = {
    symbol,
    qty: quantity,
    side,
    type: orderType,
    time_in_force: "day"
  };

  if (orderType === "limit") request.limit_price = limitPrice;

  const order = await alpacaRequest(mode, "/orders", {
    method: "POST",
    body: JSON.stringify(request)
  });
  return {
    brokerOrderId: order.id,
    provider: "Alpaca",
    mode,
    symbol,
    side,
    quantity,
    orderType,
    limitPrice: limitPrice || null,
    status: order.status || "submitted",
    filledAvgPrice: Number(order.filled_avg_price || 0)
  };
}

module.exports = {
  hasAlpacaCredentials,
  getAlpacaAccount,
  getAlpacaPositions,
  placeAlpacaOrder
};
