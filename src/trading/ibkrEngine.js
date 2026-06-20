function cleanBaseUrl(endpoint) {
  return String(endpoint || "https://localhost:5000/v1/api").replace(/\/$/, "");
}

function parseConidMap(value) {
  const map = {};
  String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [symbol, conid] = part.split(":").map((item) => item.trim());
      if (symbol && conid) map[symbol.toUpperCase()] = Number(conid);
    });
  return map;
}

function isIbkrAccount(settings) {
  const broker = settings.brokerAccount || {};
  return String(broker.brokerName || "").trim().toLowerCase().includes("ibkr")
    || String(broker.brokerName || "").trim().toLowerCase().includes("interactive brokers");
}

function getIbkrConfig(settings) {
  const broker = settings.brokerAccount || {};
  return {
    accountId: String(broker.accountLabel || "").trim(),
    endpoint: cleanBaseUrl(broker.endpoint || process.env.IBKR_CLIENT_PORTAL_DEFAULT),
    conidMap: parseConidMap(broker.conidMap || broker.notes),
    mode: broker.mode === "live" ? "live" : "paper"
  };
}

function hasIbkrConfig(settings) {
  const config = getIbkrConfig(settings);
  return Boolean(isIbkrAccount(settings) && config.accountId && config.endpoint);
}

async function ibkrRequest(config, path, options = {}) {
  const response = await fetch(`${config.endpoint}${path}`, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `IBKR request failed with ${response.status}`);
  }
  return payload;
}

async function getIbkrAccount(settings) {
  const config = getIbkrConfig(settings);
  if (!hasIbkrConfig(settings)) return null;

  const auth = await ibkrRequest(config, "/iserver/auth/status");
  const accounts = await ibkrRequest(config, "/iserver/accounts");
  const selectedAccount = config.accountId || accounts.selectedAccount || accounts.accounts?.[0];

  return {
    mode: config.mode,
    provider: "IBKR Client Portal",
    cash: 0,
    buyingPower: 0,
    equity: 0,
    status: auth.authenticated ? "AUTHENTICATED" : "AUTH_REQUIRED",
    accountId: selectedAccount,
    tradingBlocked: !auth.authenticated
  };
}

function scoreContract(contract, symbol) {
  const description = `${contract.description || ""} ${contract.companyName || ""} ${contract.listingExchange || ""}`;
  let score = 0;
  if (String(contract.symbol || "").toUpperCase() === symbol) score += 10;
  if (String(contract.secType || "").includes("STK")) score += 5;
  if (/ASX|ASXCEN|AUSTRALIA/i.test(description)) score += 8;
  return score;
}

async function findConid({ config, symbol }) {
  const mapped = config.conidMap[symbol];
  if (mapped) return mapped;

  const results = await ibkrRequest(
    config,
    `/iserver/secdef/search?symbol=${encodeURIComponent(symbol)}&secType=STK`
  );
  const contracts = Array.isArray(results) ? results : [];
  const best = contracts
    .map((contract) => ({ contract, score: scoreContract(contract, symbol) }))
    .sort((a, b) => b.score - a.score)[0]?.contract;

  if (!best?.conid) {
    throw new Error(`IBKR could not find an ASX stock contract for ${symbol}. Add a conid map in Settings, e.g. ${symbol}:123456.`);
  }
  return Number(best.conid);
}

async function placeIbkrOrder({ settings, symbol, side, quantity, orderType, limitPrice }) {
  const config = getIbkrConfig(settings);
  if (!hasIbkrConfig(settings)) {
    throw new Error("IBKR broker name, account ID, and Client Portal endpoint are required for AUS live trading.");
  }

  const auth = await ibkrRequest(config, "/iserver/auth/status");
  if (!auth.authenticated) {
    throw new Error("IBKR Client Portal Gateway is not authenticated. Log in to IBKR Gateway, then try again.");
  }

  const conid = await findConid({ config, symbol });
  const order = {
    acctId: config.accountId,
    conid,
    orderType: orderType === "limit" ? "LMT" : "MKT",
    side: side.toUpperCase(),
    ticker: symbol,
    tif: "DAY",
    quantity
  };
  if (order.orderType === "LMT") order.price = limitPrice;

  const payload = await ibkrRequest(config, `/iserver/account/${encodeURIComponent(config.accountId)}/orders`, {
    method: "POST",
    body: JSON.stringify({ orders: [order] })
  });

  const first = Array.isArray(payload) ? payload[0] : payload;
  return {
    brokerOrderId: first?.order_id || first?.id || first?.local_order_id || "",
    provider: "IBKR Client Portal",
    mode: config.mode,
    symbol,
    side,
    quantity,
    orderType,
    limitPrice: limitPrice || null,
    status: first?.order_status || first?.status || (first?.id ? "pending_broker_confirmation" : "submitted"),
    filledAvgPrice: 0,
    raw: first
  };
}

module.exports = {
  hasIbkrConfig,
  getIbkrAccount,
  placeIbkrOrder
};
