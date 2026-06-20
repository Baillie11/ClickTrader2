function bpsMove(from, to) {
  if (!from || !to) return 0;
  return ((to - from) / from) * 10000;
}

function isLiquid(quote, controls) {
  return quote.volume >= controls.minVolume || quote.averageVolume >= controls.minVolume;
}

function spreadOk(quote, controls) {
  return !quote.spreadBps || quote.spreadBps <= controls.maxSpreadBps;
}

function quantityFor(quote, controls) {
  return Math.max(1, Math.floor(controls.maxAllocationPerTrade / quote.price));
}

function exitsForPortfolio({ portfolio, quotes, controls, targetMultiplier = 1, stopMultiplier = 1 }) {
  return portfolio
    .map((position) => {
      const quote = quotes[position.symbol];
      if (!quote || !quote.price) return null;
      const moveBps = bpsMove(position.avgEntryPrice, quote.price);
      const targetBps = controls.targetProfitBps * targetMultiplier;
      const stopBps = controls.stopLossBps * stopMultiplier;
      if (moveBps >= targetBps || moveBps <= -stopBps) {
        return {
          symbol: position.symbol,
          side: "sell",
          quantity: position.quantity,
          reason: moveBps >= targetBps ? "target profit" : "stop loss",
          moveBps,
          quote,
          score: Math.abs(moveBps)
        };
      }
      return null;
    })
    .filter(Boolean);
}

function evaluateLowMarginScalp(context) {
  const { settings, portfolio, quotes, controls } = context;
  const openSymbols = new Set(portfolio.map((position) => position.symbol));
  const exits = exitsForPortfolio({ portfolio, quotes, controls });
  const openSlots = Math.max(0, controls.maxOpenPositions - portfolio.length);
  const entries = [];

  for (const symbol of settings.watchlist) {
    const quote = quotes[symbol];
    if (!quote || !quote.price || openSymbols.has(symbol)) continue;
    if (isLiquid(quote, controls) && spreadOk(quote, controls) && quote.changePercent > 0) {
      entries.push({
        symbol,
        side: "buy",
        quantity: quantityFor(quote, controls),
        reason: "liquid positive mover inside spread limit",
        score: quote.changePercent * 10 - quote.spreadBps,
        quote
      });
    }
  }

  entries.sort((a, b) => b.score - a.score);
  return [...exits, ...entries.slice(0, openSlots)];
}

function evaluateOpeningMomentum(context) {
  const { settings, portfolio, quotes, controls } = context;
  const openSymbols = new Set(portfolio.map((position) => position.symbol));
  const exits = exitsForPortfolio({ portfolio, quotes, controls, targetMultiplier: 1.2, stopMultiplier: 0.9 });
  const openSlots = Math.max(0, controls.maxOpenPositions - portfolio.length);
  const entries = [];

  for (const symbol of settings.watchlist) {
    const quote = quotes[symbol];
    if (!quote || !quote.price || openSymbols.has(symbol)) continue;
    const strongMove = quote.changePercent >= 0.45;
    if (strongMove && isLiquid(quote, controls) && spreadOk(quote, controls)) {
      entries.push({
        symbol,
        side: "buy",
        quantity: quantityFor(quote, controls),
        reason: "opening momentum: strong positive move with volume",
        score: quote.changePercent * 20 + Math.log10(Math.max(quote.volume, 1)) - quote.spreadBps,
        quote
      });
    }
  }

  entries.sort((a, b) => b.score - a.score);
  return [...exits, ...entries.slice(0, openSlots)];
}

function evaluateMeanReversion(context) {
  const { settings, portfolio, quotes, controls } = context;
  const openSymbols = new Set(portfolio.map((position) => position.symbol));
  const exits = exitsForPortfolio({ portfolio, quotes, controls, targetMultiplier: 0.65, stopMultiplier: 1.15 });
  const openSlots = Math.max(0, controls.maxOpenPositions - portfolio.length);
  const entries = [];

  for (const symbol of settings.watchlist) {
    const quote = quotes[symbol];
    if (!quote || !quote.price || openSymbols.has(symbol)) continue;
    const oversoldIntraday = quote.changePercent <= -0.35;
    if (oversoldIntraday && isLiquid(quote, controls) && spreadOk(quote, controls)) {
      entries.push({
        symbol,
        side: "buy",
        quantity: quantityFor(quote, controls),
        reason: "mean reversion: intraday pullback inside liquidity/spread limits",
        score: Math.abs(quote.changePercent) * 15 - quote.spreadBps,
        quote
      });
    }
  }

  entries.sort((a, b) => b.score - a.score);
  return [...exits, ...entries.slice(0, openSlots)];
}

const STRATEGIES = [
  {
    id: "low-margin-scalp",
    name: "Low Margin Scalper",
    description: "Default high-turnover strategy using spread, volume, target profit, and stop loss controls.",
    evaluate: evaluateLowMarginScalp
  },
  {
    id: "opening-momentum",
    name: "Opening Momentum",
    description: "Looks for strong positive movers with enough liquidity and acceptable spread.",
    evaluate: evaluateOpeningMomentum
  },
  {
    id: "mean-reversion",
    name: "Mean Reversion",
    description: "Looks for liquid intraday pullbacks that may snap back toward the prior price.",
    evaluate: evaluateMeanReversion
  }
];

function getStrategies() {
  return STRATEGIES;
}

function getStrategyById(id) {
  return STRATEGIES.find((strategy) => strategy.id === id) || STRATEGIES[0];
}

module.exports = {
  getStrategies,
  getStrategyById
};
