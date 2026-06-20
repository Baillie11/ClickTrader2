const { toYahooSymbol } = require("./marketHours");

function lastNumber(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = Number(values[index]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function normalizeQuote(result, symbol, yahooSymbol) {
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const price = Number(meta.regularMarketPrice || lastNumber(quote.close) || 0);
  const previousClose = Number(meta.previousClose || meta.chartPreviousClose || 0);
  const volume = Number(lastNumber(quote.volume) || meta.regularMarketVolume || 0);
  const changePercent = previousClose && price ? ((price - previousClose) / previousClose) * 100 : 0;

  return {
    symbol,
    yahooSymbol,
    name: meta.shortName || meta.longName || symbol,
    price,
    bid: 0,
    ask: 0,
    previousClose,
    changePercent,
    volume,
    averageVolume: volume,
    spreadBps: 0,
    currency: meta.currency || "USD",
    source: "Yahoo Finance",
    updatedAt: new Date().toISOString()
  };
}

async function getQuote(symbol, market) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required.");

  const yahooSymbol = toYahooSymbol(clean, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m`;
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "ClickTrader2/1.0"
    }
  });
  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status}: ${payloadText.slice(0, 80)}`);
  }

  const payload = JSON.parse(payloadText);
  const result = payload.chart?.result?.[0];
  if (!result) {
    const message = payload.chart?.error?.description || `No Yahoo chart data found for ${clean}.`;
    throw new Error(message);
  }

  const quote = normalizeQuote(result, clean, yahooSymbol);
  if (!quote.price) throw new Error(`No usable price found for ${clean}.`);
  return quote;
}

async function getQuoteBatch(symbols, market) {
  const unique = [...new Set(symbols.map((symbol) => String(symbol || "").trim().toUpperCase()).filter(Boolean))];
  const results = {};

  await Promise.all(unique.map(async (symbol) => {
    try {
      results[symbol] = await getQuote(symbol, market);
    } catch (error) {
      results[symbol] = {
        symbol,
        price: 0,
        bid: 0,
        ask: 0,
        changePercent: 0,
        spreadBps: 0,
        volume: 0,
        source: "Unavailable",
        error: error.message,
        updatedAt: new Date().toISOString()
      };
    }
  }));

  return results;
}

module.exports = {
  getQuote,
  getQuoteBatch
};
