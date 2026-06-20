const MARKETS = {
  asx: {
    code: "asx",
    name: "ASX",
    timezone: "Australia/Sydney",
    open: "10:00",
    close: "16:00",
    yahooSuffix: ".AX",
    stocks: [
      { symbol: "CBA", name: "Commonwealth Bank" },
      { symbol: "BHP", name: "BHP Group" },
      { symbol: "NAB", name: "National Australia Bank" },
      { symbol: "WBC", name: "Westpac Banking Corp" },
      { symbol: "CSL", name: "CSL Limited" },
      { symbol: "WOW", name: "Woolworths Group" },
      { symbol: "TLS", name: "Telstra Group" },
      { symbol: "MQG", name: "Macquarie Group" }
    ]
  },
  nasdaq: {
    code: "nasdaq",
    name: "NASDAQ",
    timezone: "America/New_York",
    open: "09:30",
    close: "16:00",
    yahooSuffix: "",
    stocks: [
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "AMD", name: "Advanced Micro Devices" },
      { symbol: "META", name: "Meta Platforms" },
      { symbol: "AMZN", name: "Amazon" },
      { symbol: "GOOGL", name: "Alphabet" }
    ]
  },
  nyse: {
    code: "nyse",
    name: "NYSE",
    timezone: "America/New_York",
    open: "09:30",
    close: "16:00",
    yahooSuffix: "",
    stocks: [
      { symbol: "JPM", name: "JPMorgan Chase" },
      { symbol: "V", name: "Visa" },
      { symbol: "WMT", name: "Walmart" },
      { symbol: "MA", name: "Mastercard" },
      { symbol: "BAC", name: "Bank of America" },
      { symbol: "HD", name: "Home Depot" },
      { symbol: "KO", name: "Coca-Cola" },
      { symbol: "DIS", name: "Walt Disney" }
    ]
  },
  xetra: {
    code: "xetra",
    name: "Germany",
    exchangeName: "Xetra",
    timezone: "Europe/Berlin",
    open: "09:00",
    close: "17:30",
    yahooSuffix: ".DE",
    stocks: [
      { symbol: "SAP", name: "SAP" },
      { symbol: "SIE", name: "Siemens" },
      { symbol: "ALV", name: "Allianz" },
      { symbol: "DTE", name: "Deutsche Telekom" },
      { symbol: "MBG", name: "Mercedes-Benz Group" },
      { symbol: "BMW", name: "BMW" }
    ]
  },
  sse: {
    code: "sse",
    name: "China",
    exchangeName: "Shanghai Stock Exchange",
    timezone: "Asia/Shanghai",
    open: "09:30",
    close: "15:00",
    yahooSuffix: ".SS",
    stocks: [
      { symbol: "600519", name: "Kweichow Moutai" },
      { symbol: "601318", name: "Ping An Insurance" },
      { symbol: "600036", name: "China Merchants Bank" },
      { symbol: "601398", name: "Industrial and Commercial Bank of China" },
      { symbol: "601857", name: "PetroChina" },
      { symbol: "600276", name: "Hengrui Medicine" }
    ]
  },
  lse: {
    code: "lse",
    name: "England",
    exchangeName: "London Stock Exchange",
    timezone: "Europe/London",
    open: "08:00",
    close: "16:30",
    yahooSuffix: ".L",
    stocks: [
      { symbol: "HSBA", name: "HSBC Holdings" },
      { symbol: "BP", name: "BP" },
      { symbol: "SHEL", name: "Shell" },
      { symbol: "AZN", name: "AstraZeneca" },
      { symbol: "ULVR", name: "Unilever" },
      { symbol: "VOD", name: "Vodafone" }
    ]
  }
};

function getMarkets() {
  return Object.values(MARKETS);
}

function getMarket(code) {
  return MARKETS[code] || MARKETS.nasdaq;
}

function getStocksForMarket(code) {
  return getMarket(code).stocks;
}

function getZonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function minutesFromTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function getMarketStatus(code, displayTimezone = "Australia/Brisbane") {
  const market = getMarket(code);
  const now = new Date();
  const parts = getZonedParts(now, market.timezone);
  const weekdayClosed = parts.weekday === "Sat" || parts.weekday === "Sun";
  const openMinutes = minutesFromTime(market.open);
  const closeMinutes = minutesFromTime(market.close);
  const isOpen = !weekdayClosed && parts.minutes >= openMinutes && parts.minutes <= closeMinutes;

  return {
    ...market,
    isOpen,
    displayTimezone,
    localTime: new Intl.DateTimeFormat("en-AU", {
      timeZone: displayTimezone,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short"
    }).format(now),
    tradingHours: `${market.open} - ${market.close} ${market.timezone}`
  };
}

function toYahooSymbol(symbol, marketCode) {
  const clean = String(symbol || "").trim().toUpperCase();
  const market = getMarket(marketCode);
  if (!clean || clean.includes(".") || !market.yahooSuffix) return clean;
  return `${clean}${market.yahooSuffix}`;
}

module.exports = {
  getMarkets,
  getMarket,
  getStocksForMarket,
  getMarketStatus,
  toYahooSymbol
};
