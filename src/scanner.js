const { getQuoteBatch } = require("./marketData");

// ---------------------------------------------------------------------------
// Expanded universe per market
// All symbols are checked live; only those that pass price/volume filters and
// have a usable quote from Yahoo Finance will appear as candidates.
// ---------------------------------------------------------------------------
const UNIVERSE = {
  nasdaq: [
    // Large-cap tech — high liquidity, often affordable in quantity
    "AAPL", "MSFT", "NVDA", "AMD", "INTC", "AMZN", "META", "GOOGL", "TSLA",
    // Mid-cap / popular day-trade names
    "SOFI", "PLTR", "RIVN", "LCID", "SNAP", "HOOD", "UPST", "MARA", "RIOT",
    "SNDL", "FFIE", "MULN", "NKLA", "WKHS", "CLOV", "SPCE", "OPEN", "LMND",
    "WISH", "EXPR", "KOSS", "NAKD", "BBBY", "AMC", "GME",
    // ETFs — very liquid, excellent for day trading
    "SQQQ", "TQQQ", "SPXS", "SPXL", "UVXY", "SVXY", "QQQ", "SPY", "IWM",
    "LABD", "LABU", "TECL", "TECS", "SOXS", "SOXL", "FNGU", "FNGD",
    // Additional liquid names
    "F", "NIO", "XPEV", "LI", "PLUG", "FCEL", "BE", "RUN", "NOVA",
    "DKNG", "PENN", "MGAM", "EVGO", "CHPT", "BLNK", "NRGU", "NRGD",
    "VALE", "FCX", "CLF", "X", "MT", "GOLD", "NEM", "AG", "PAAS"
  ],
  nyse: [
    "JPM", "BAC", "C", "WFC", "GS", "MS", "T", "VZ", "GM", "F",
    "AAL", "UAL", "DAL", "CCL", "RCL", "NCLH", "MRO", "DVN", "OXY",
    "SLB", "HAL", "FCX", "X", "CLF", "AA", "NEM", "KGC", "GOLD",
    "BTG", "AUY", "PAAS", "AG", "WPM", "KO", "PFE", "ABBV", "BMY"
  ],
  asx: [
    // Large caps
    "CBA", "BHP", "NAB", "WBC", "ANZ", "CSL", "WOW", "WES", "TLS", "MQG",
    // Mid-caps and popular day trades
    "RIO", "FMG", "NCM", "NST", "EVN", "OZL", "AWC", "ILU", "MIN",
    "S32", "BSL", "BLD", "JHX", "AGL", "ORG", "WPL", "STO", "VEA",
    "ALL", "CWN", "TAH", "SKC", "QAN", "REH", "SGR", "ALX", "ASX",
    // Smaller / more volatile
    "PLS", "LTR", "IGO", "AKE", "SFR", "29M", "GMD", "WR1", "LPI",
    "CXO", "NVX", "FFX", "ARU", "PNN", "AVZ", "LKE", "SYA", "GL1"
  ],
  xetra: [
    "SAP", "SIE", "ALV", "DTE", "MBG", "BMW", "VOW3", "RWE", "BAS", "BAYN"
  ],
  sse: [
    "600519", "601318", "600036", "601398", "601857", "600276"
  ],
  lse: [
    "HSBA", "BP", "SHEL", "AZN", "ULVR", "VOD", "LLOY", "BARC", "GSK", "REL"
  ]
};

// ---------------------------------------------------------------------------
// Try Yahoo Finance predefined screeners (day_gainers, most_actives)
// Returns an array of ticker symbols. Falls back to [] on any error.
// ---------------------------------------------------------------------------
async function fetchScreenerSymbols(scrId, market) {
  // Only NASDAQ/NYSE have reliable Yahoo screener coverage
  if (!["nasdaq", "nyse"].includes(market)) return [];
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=${scrId}&count=25&start=0`;
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "ClickTrader2/1.0"
      }
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const quotes = payload?.finance?.result?.[0]?.quotes || [];
    return quotes.map((q) => String(q.symbol || "").trim().toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Score a quote for day trading suitability
// Higher score = better candidate
// ---------------------------------------------------------------------------
function scoreCandiate(quote, budget) {
  const changeAbs = Math.abs(quote.changePercent || 0);
  const volumeScore = Math.log10(Math.max(quote.volume || 1, 10)) * 8;
  const momentumScore = changeAbs * 40;

  // Reward stocks where we can buy at least 3 shares within budget
  const sharesAffordable = budget / (quote.price || 1);
  const affordabilityBonus = sharesAffordable >= 5 ? 20 : sharesAffordable >= 3 ? 10 : sharesAffordable >= 1 ? 2 : 0;

  return momentumScore + volumeScore + affordabilityBonus;
}

function candidateReason(quote, budget) {
  const parts = [];
  const changeAbs = Math.abs(quote.changePercent || 0);
  if (changeAbs >= 5) parts.push(`strong move ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}%`);
  else if (changeAbs >= 2) parts.push(`solid move ${quote.changePercent > 0 ? "+" : ""}${quote.changePercent.toFixed(1)}%`);
  else if (changeAbs >= 0.5) parts.push(`${quote.changePercent > 0 ? "positive" : "negative"} momentum ${quote.changePercent.toFixed(1)}%`);
  else parts.push("active ticker");

  if ((quote.volume || 0) >= 5000000) parts.push("very high volume");
  else if ((quote.volume || 0) >= 1000000) parts.push("high volume");
  else if ((quote.volume || 0) >= 100000) parts.push("adequate volume");

  const shares = Math.floor(budget / (quote.price || 1));
  if (shares >= 1) parts.push(`~${shares} share${shares !== 1 ? "s" : ""} per $${budget} slot`);

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Main export: scan for day trade candidates
// Options:
//   minPrice     – minimum stock price (default 0.50)
//   maxPrice     – maximum stock price (default 50)
//   minVolume    – minimum daily volume (default 50000)
//   topN         – how many candidates to return (default 12)
//   budget       – per-trade budget in dollars (default 25)
// ---------------------------------------------------------------------------
async function scanDayTradeCandidates(market, options = {}) {
  const {
    minPrice = 0.50,
    maxPrice = 50,
    minVolume = 50000,
    topN = 12,
    budget = 25
  } = options;

  // 1. Start with the static universe for this market
  const base = [...(UNIVERSE[market] || UNIVERSE.nasdaq)];

  // 2. Try to pull bonus symbols from Yahoo screeners (US markets only)
  const [gainers, actives] = await Promise.all([
    fetchScreenerSymbols("day_gainers", market),
    fetchScreenerSymbols("most_actives", market)
  ]);
  const bonusSymbols = [...new Set([...gainers, ...actives])];

  // 3. Combine and deduplicate
  const allSymbols = [...new Set([...bonusSymbols, ...base])];

  // 4. Fetch live quotes in batch
  const quotes = await getQuoteBatch(allSymbols, market);

  // 5. Filter, score, rank
  const candidates = [];
  for (const symbol of allSymbols) {
    const quote = quotes[symbol];
    if (!quote || quote.error || !quote.price) continue;
    if (quote.price < minPrice || quote.price > maxPrice) continue;
    if ((quote.volume || 0) < minVolume) continue;

    const score = scoreCandiate(quote, budget);
    candidates.push({
      symbol,
      name: quote.name || symbol,
      price: quote.price,
      changePercent: quote.changePercent || 0,
      volume: quote.volume || 0,
      score,
      reason: candidateReason(quote, budget),
      sharesPerSlot: Math.max(1, Math.floor(budget / quote.price)),
      fromScreener: bonusSymbols.includes(symbol)
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    market,
    candidates: candidates.slice(0, topN),
    totalEvaluated: candidates.length,
    scannedAt: new Date().toISOString(),
    screenerSymbolsFound: bonusSymbols.length
  };
}

module.exports = { scanDayTradeCandidates };
