const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const DEFAULT_SETTINGS = {
  tradeMode: process.env.DEFAULT_TRADE_MODE || "paper",
  market: process.env.DEFAULT_MARKET || "nasdaq",
  usMarket: "nasdaq",
  timezone: "Australia/Brisbane",
  enabledMarkets: ["asx", "nasdaq"],
  watchlist: ["SOFI", "PLTR", "F", "SNAP", "MARA", "SQQQ", "TQQQ"],
  usWatchlist: ["SOFI", "PLTR", "F", "SNAP", "MARA", "SQQQ", "TQQQ"],
  ausWatchlist: ["CBA", "BHP", "NAB", "WBC", "FMG", "PLS"],
  marketWatchlists: {
    asx: ["CBA", "BHP", "NAB", "WBC", "FMG", "PLS"],
    nasdaq: ["SOFI", "PLTR", "F", "SNAP", "MARA", "SQQQ", "TQQQ"],
    xetra: ["SAP", "SIE", "ALV", "DTE", "MBG", "BMW"],
    sse: ["600519", "601318", "600036", "601398", "601857", "600276"],
    lse: ["HSBA", "BP", "SHEL", "AZN", "ULVR", "VOD"]
  },
  brokerAccounts: {},
  activeStrategies: {
    asx: "small-account-day-trader",
    nasdaq: "small-account-day-trader",
    xetra: "small-account-day-trader",
    sse: "small-account-day-trader",
    lse: "small-account-day-trader"
  },
  personalization: {
    defaultDesk: "aus",
    currency: "AUD",
    riskProfile: "balanced",
    dailyLossLimit: 20,
    maxTradesPerDay: 10,
    compactMode: false,
    notes: ""
  },
  requireMarketOpen: true,
  allowLiveTrading: false,
  paperPhaseStartedAt: null
};

const DEFAULT_STRATEGY = {
  targetProfitBps: 150,
  stopLossBps: 75,
  maxSpreadBps: 50,
  maxAllocationPerTrade: 25,
  maxOpenPositions: 3,
  cooldownSeconds: 60,
  minVolume: 100000,
  lastRunAt: null
};

function nowIso() {
  return new Date().toISOString();
}

function ensureStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    const startingCash = Number(process.env.SIMULATED_STARTING_CASH || 100);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        users: [],
        passwordResets: {},
        settings: {},
        strategies: {},
        portfolios: {},
        orders: {},
        trades: {},
        tradeLogs: {},
        scans: {},
        simulatedAccounts: {
          default: {
            cash: startingCash,
            buyingPower: startingCash,
            equity: startingCash,
            positions: []
          }
        }
      }, null, 2)
    );
  }
}

function createStore(filePath) {
  ensureStore(filePath);

  function read() {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function write(data) {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
  }

  function mutate(callback) {
    const data = read();
    const result = callback(data);
    write(data);
    return result;
  }

  function ensureUserBuckets(data, userId) {
    data.settings[userId] = { ...DEFAULT_SETTINGS, ...(data.settings[userId] || {}) };
    if (data.settings[userId].paperPhaseStartedAt === undefined) {
      data.settings[userId].paperPhaseStartedAt = null;
    }
    data.settings[userId].usWatchlist = data.settings[userId].usWatchlist || data.settings[userId].watchlist || DEFAULT_SETTINGS.usWatchlist;
    data.settings[userId].ausWatchlist = data.settings[userId].ausWatchlist || DEFAULT_SETTINGS.ausWatchlist;
    data.settings[userId].usMarket = data.settings[userId].usMarket || (data.settings[userId].market === "asx" ? "nasdaq" : data.settings[userId].market) || "nasdaq";
    data.settings[userId].enabledMarkets = data.settings[userId].enabledMarkets || DEFAULT_SETTINGS.enabledMarkets;
    data.settings[userId].marketWatchlists = {
      ...DEFAULT_SETTINGS.marketWatchlists,
      ...(data.settings[userId].marketWatchlists || {}),
      asx: data.settings[userId].ausWatchlist || data.settings[userId].marketWatchlists?.asx || DEFAULT_SETTINGS.marketWatchlists.asx,
      nasdaq: data.settings[userId].usWatchlist || data.settings[userId].marketWatchlists?.nasdaq || DEFAULT_SETTINGS.marketWatchlists.nasdaq
    };
    data.settings[userId].brokerAccounts = { ...(data.settings[userId].brokerAccounts || {}) };
    data.settings[userId].activeStrategies = {
      ...DEFAULT_SETTINGS.activeStrategies,
      ...(data.settings[userId].activeStrategies || {})
    };
    data.settings[userId].personalization = {
      ...DEFAULT_SETTINGS.personalization,
      ...(data.settings[userId].personalization || {})
    };
    data.strategies[userId] = { ...DEFAULT_STRATEGY, ...(data.strategies[userId] || {}) };
    data.portfolios[userId] = data.portfolios[userId] || [];
    data.orders[userId] = data.orders[userId] || [];
    data.trades[userId] = data.trades[userId] || [];
    data.tradeLogs = data.tradeLogs || {};
    data.tradeLogs[userId] = data.tradeLogs[userId] || [];
    data.scans[userId] = data.scans[userId] || null;
    data.simulatedAccounts[userId] = data.simulatedAccounts[userId] || {
      cash: Number(process.env.SIMULATED_STARTING_CASH || 100),
      buyingPower: Number(process.env.SIMULATED_STARTING_CASH || 100),
      equity: Number(process.env.SIMULATED_STARTING_CASH || 100),
      positions: []
    };
  }

  return {
    getUserById(userId) {
      const data = read();
      const user = data.users.find((item) => item.id === userId);
      if (user) ensureUserBuckets(data, user.id);
      return user || null;
    },

    getUserByEmail(email) {
      const normalized = String(email || "").trim().toLowerCase();
      const data = read();
      return data.users.find((item) => item.email === normalized) || null;
    },

    updateUserPassword(userId, passwordHash) {
      return mutate((data) => {
        const user = data.users.find((item) => item.id === userId);
        if (!user) return null;
        user.passwordHash = passwordHash;
        user.updatedAt = nowIso();
        return user;
      });
    },

    createUser({ email, displayName, passwordHash }) {
      return mutate((data) => {
        const user = {
          id: randomUUID(),
          email: String(email).trim().toLowerCase(),
          displayName: String(displayName || email).trim(),
          passwordHash,
          createdAt: nowIso()
        };
        data.users.push(user);
        ensureUserBuckets(data, user.id);
        return user;
      });
    },

    createPasswordReset(email) {
      return mutate((data) => {
        data.passwordResets = data.passwordResets || {};
        const user = data.users.find((item) => item.email === String(email || "").trim().toLowerCase());
        if (!user) return null;
        const token = randomUUID();
        data.passwordResets[token] = {
          userId: user.id,
          email: user.email,
          createdAt: nowIso(),
          expiresAt: Date.now() + 1000 * 60 * 30,
          usedAt: null
        };
        return { token, user };
      });
    },

    getPasswordReset(token) {
      const data = read();
      const reset = (data.passwordResets || {})[token];
      if (!reset || reset.usedAt || Date.now() > reset.expiresAt) return null;
      return reset;
    },

    consumePasswordReset(token, passwordHash) {
      return mutate((data) => {
        data.passwordResets = data.passwordResets || {};
        const reset = data.passwordResets[token];
        if (!reset || reset.usedAt || Date.now() > reset.expiresAt) return null;
        const user = data.users.find((item) => item.id === reset.userId);
        if (!user) return null;
        user.passwordHash = passwordHash;
        user.updatedAt = nowIso();
        reset.usedAt = nowIso();
        return user;
      });
    },

    getSettings(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.settings[userId];
    },

    updateSettings(userId, settings) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        data.settings[userId] = { ...data.settings[userId], ...settings, updatedAt: nowIso() };
        return data.settings[userId];
      });
    },

    getStrategy(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.strategies[userId];
    },

    updateStrategy(userId, strategy) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        data.strategies[userId] = { ...data.strategies[userId], ...strategy, updatedAt: nowIso() };
        return data.strategies[userId];
      });
    },

    markStrategyRun(userId) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        data.strategies[userId].lastRunAt = nowIso();
      });
    },

    getPortfolio(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.portfolios[userId];
    },

    upsertPosition(userId, position) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        const positions = data.portfolios[userId];
        const existing = positions.find((item) => item.symbol === position.symbol && (item.market || null) === (position.market || null));
        if (!existing) {
          positions.push({
            id: randomUUID(),
            symbol: position.symbol,
            market: position.market || null,
            quantity: position.quantity,
            avgEntryPrice: position.price,
            lastPrice: position.price,
            openedAt: nowIso(),
            updatedAt: nowIso()
          });
          return;
        }

        const nextQuantity = existing.quantity + position.quantity;
        if (nextQuantity <= 0) {
          data.portfolios[userId] = positions.filter((item) => item.id !== existing.id);
          return;
        }

        const oldCost = existing.quantity * existing.avgEntryPrice;
        const newCost = position.quantity > 0 ? position.quantity * position.price : 0;
        existing.quantity = nextQuantity;
        existing.market = position.market || existing.market || null;
        existing.avgEntryPrice = position.quantity > 0 ? (oldCost + newCost) / nextQuantity : existing.avgEntryPrice;
        existing.lastPrice = position.price;
        existing.updatedAt = nowIso();
      });
    },

    replacePortfolio(userId, positions) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        data.portfolios[userId] = positions.map((position) => ({
          id: position.id || randomUUID(),
          symbol: position.symbol,
          market: position.market || null,
          quantity: Number(position.quantity || position.qty || 0),
          avgEntryPrice: Number(position.avgEntryPrice || position.avg_entry_price || 0),
          lastPrice: Number(position.currentPrice || position.current_price || position.lastPrice || 0),
          openedAt: position.openedAt || nowIso(),
          updatedAt: nowIso()
        })).filter((position) => position.quantity > 0);
      });
    },

    addOrder(userId, order) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        const saved = { id: randomUUID(), createdAt: nowIso(), ...order };
        data.orders[userId].unshift(saved);
        data.orders[userId] = data.orders[userId].slice(0, 200);
        return saved;
      });
    },

    getOrders(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.orders[userId];
    },

    addTrade(userId, trade) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        const saved = { id: randomUUID(), createdAt: nowIso(), ...trade };
        data.trades[userId].unshift(saved);
        data.trades[userId] = data.trades[userId].slice(0, 500);
        return saved;
      });
    },

    addTradeLog(userId, log) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        const saved = { id: randomUUID(), loggedAt: nowIso(), ...log };
        data.tradeLogs[userId].unshift(saved);
        data.tradeLogs[userId] = data.tradeLogs[userId].slice(0, 2000);

        const logDir = path.join(path.dirname(filePath), "logs");
        fs.mkdirSync(logDir, { recursive: true });
        const csvPath = path.join(logDir, `trade-log-${userId}.csv`);
        const headers = [
          "loggedAt",
          "tradeDate",
          "market",
          "symbol",
          "side",
          "quantity",
          "price",
          "notional",
          "strategyId",
          "strategyName",
          "provider",
          "mode",
          "status",
          "profitLoss",
          "profitLossPercent",
          "reason",
          "orderType",
          "brokerOrderId"
        ];
        const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
        if (!fs.existsSync(csvPath)) {
          fs.writeFileSync(csvPath, `${headers.join(",")}\n`);
        }
        fs.appendFileSync(csvPath, `${headers.map((header) => escapeCell(saved[header])).join(",")}\n`);
        return saved;
      });
    },

    getTrades(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.trades[userId];
    },

    getTradeLogs(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.tradeLogs[userId];
    },

    getSimulatedAccount(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.simulatedAccounts[userId];
    },

    updateSimulatedAccount(userId, account) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        data.simulatedAccounts[userId] = account;
        return account;
      });
    },

    saveScan(userId, scan) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        data.scans[userId] = { ...scan, savedAt: nowIso() };
      });
    },

    getLastScan(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      return data.scans[userId];
    },

    recordPaperPhaseStart(userId) {
      return mutate((data) => {
        ensureUserBuckets(data, userId);
        if (!data.settings[userId].paperPhaseStartedAt) {
          data.settings[userId].paperPhaseStartedAt = nowIso();
        }
      });
    },

    getPaperPhase(userId) {
      const data = read();
      ensureUserBuckets(data, userId);
      const startedAt = data.settings[userId].paperPhaseStartedAt;
      const daysRequired = 30;
      if (!startedAt) {
        return { startedAt: null, daysComplete: 0, daysRequired, graduated: false };
      }
      const msElapsed = Date.now() - new Date(startedAt).getTime();
      const daysComplete = Math.min(Math.floor(msElapsed / (1000 * 60 * 60 * 24)), daysRequired);
      return { startedAt, daysComplete, daysRequired, graduated: daysComplete >= daysRequired };
    }
  };
}

module.exports = { createStore };
