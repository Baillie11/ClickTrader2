require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const flash = require("connect-flash");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const { createStore } = require("./src/dataStore");
const { FileSessionStore } = require("./src/fileSessionStore");
const { getMarkets, getMarket, getStocksForMarket, getMarketStatus } = require("./src/marketHours");
const { getQuote, getQuoteBatch } = require("./src/marketData");
const { createTradingService } = require("./src/trading/tradingService");
const { getStrategies, getStrategyById } = require("./src/strategyRegistry");

const app = express();
const store = createStore(path.join(__dirname, "data", "store.json"));
const tradingService = createTradingService({ store });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);

const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/$/, "");

function withBasePath(target) {
  if (!BASE_PATH || !target || typeof target !== "string") return target;
  if (!target.startsWith("/") || target.startsWith("//")) return target;
  if (target === BASE_PATH || target.startsWith(`${BASE_PATH}/`)) return target;
  return `${BASE_PATH}${target}`;
}

app.use((req, res, next) => {
  if (BASE_PATH) {
    if (req.url === BASE_PATH) {
      req.url = "/";
    } else if (req.url.startsWith(`${BASE_PATH}/`)) {
      req.url = req.url.slice(BASE_PATH.length) || "/";
    }
  }

  res.locals.basePath = BASE_PATH;
  res.locals.url = withBasePath;

  const originalRedirect = res.redirect.bind(res);
  res.redirect = (statusOrUrl, maybeUrl) => {
    if (typeof statusOrUrl === "number") {
      return originalRedirect(statusOrUrl, withBasePath(maybeUrl));
    }
    return originalRedirect(withBasePath(statusOrUrl));
  };

  next();
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 240 }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-clicktrader2-change-me",
    store: new FileSessionStore({
      filePath: path.join(__dirname, "data", "sessions.json")
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true"
    }
  })
);
app.use(flash());

app.use((req, res, next) => {
  const user = req.session.userId ? store.getUserById(req.session.userId) : null;
  res.locals.currentUser = user;
  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error"),
    warning: req.flash("warning")
  };
  next();
});

function requireUser(req, res, next) {
  if (!req.session.userId) {
    req.flash("warning", "Please log in to access Click Trader.");
    return res.redirect("/login");
  }
  return next();
}

function numberFromBody(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arrayFromBody(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function symbolsFromText(value) {
  return String(value || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
}

function markdownToHtml(markdown) {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split(/\r?\n/);
  let html = "";
  let inList = false;
  let inCode = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html += "</code></pre>";
        inCode = false;
      } else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        html += "<pre><code>";
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html += `${line}\n`;
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h1>${line.slice(2)}</h1>`;
    } else if (line.startsWith("## ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h2>${line.slice(3)}</h2>`;
    } else if (line.startsWith("### ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h3>${line.slice(4)}</h3>`;
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${line.slice(2)}</li>`;
    } else if (!line.trim()) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p>${line.replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`;
    }
  }

  if (inList) html += "</ul>";
  if (inCode) html += "</code></pre>";
  return html;
}

function renderDocPage(res, fileName, pageTitle) {
  const filePath = path.join(__dirname, "docs", fileName);
  const markdown = fs.readFileSync(filePath, "utf8");
  res.render("doc-page", {
    pageTitle,
    contentHtml: markdownToHtml(markdown)
  });
}

const DESKS = [
  { key: "aus", market: "asx", label: "AUS Trade", liveEnabled: true },
  { key: "us", market: "nasdaq", label: "U.S. Trade", liveEnabled: true },
  { key: "germany", market: "xetra", label: "Germany Trade", liveEnabled: false },
  { key: "china", market: "sse", label: "China Trade", liveEnabled: false },
  { key: "england", market: "lse", label: "England Trade", liveEnabled: false }
];

function getDeskConfig(value) {
  return DESKS.find((desk) => desk.key === value) || DESKS[0];
}

function getEnabledDesks(settings) {
  const enabled = settings.enabledMarkets || ["asx", "nasdaq"];
  return DESKS.filter((desk) => enabled.includes(desk.market));
}

function getDefaultDeskPath(settings) {
  const defaultKey = settings.personalization?.defaultDesk || "aus";
  const enabledDesks = getEnabledDesks(settings);
  return `/trade/${enabledDesks.find((desk) => desk.key === defaultKey)?.key || enabledDesks[0]?.key || "aus"}`;
}

function getDeskKey(value) {
  return getDeskConfig(value).key;
}

function getDeskSettings(baseSettings, deskKey) {
  const desk = getDeskConfig(deskKey);
  const market = desk.key === "us" ? (baseSettings.usMarket || "nasdaq") : desk.market;
  const marketWatchlists = baseSettings.marketWatchlists || {};
  const watchlist = marketWatchlists[market]
    || (market === "asx" ? baseSettings.ausWatchlist : null)
    || (market === "nasdaq" ? baseSettings.usWatchlist || baseSettings.watchlist : null)
    || getStocksForMarket(market).map((stock) => stock.symbol);
  const strategyId = baseSettings.activeStrategies?.[market] || "low-margin-scalp";

  return {
    ...baseSettings,
    deskKey: desk.key,
    deskLabel: desk.label,
    deskLiveEnabled: desk.liveEnabled,
    market,
    tradeMode: desk.liveEnabled ? baseSettings.tradeMode : "paper",
    allowLiveTrading: desk.liveEnabled ? baseSettings.allowLiveTrading : false,
    watchlist,
    strategyId,
    strategyDefinition: getStrategyById(strategyId),
    brokerAccount: baseSettings.brokerAccounts?.[market] || {},
    note: market === "asx"
      ? "AUS live trading is supported through an authenticated IBKR Client Portal Gateway. Without IBKR live settings, AUS trades stay on the local paper simulator."
      : desk.liveEnabled
        ? null
        : `${desk.label} uses Yahoo Finance market data and the local paper simulator until a live broker adapter is connected for ${getMarket(market).exchangeName || getMarket(market).name}.`
  };
}

function deskPath(req) {
  return `/trade/${getDeskKey(req.params.desk)}`;
}

async function renderTradeDesk(req, res, next) {
  try {
    const user = store.getUserById(req.session.userId);
    const deskKey = getDeskKey(req.params.desk);
    const baseSettings = store.getSettings(user.id);
    const settings = getDeskSettings(baseSettings, deskKey);
    const marketStatus = getMarketStatus(settings.market, settings.timezone);
    const portfolio = store.getPortfolio(user.id).filter((item) => {
      return item.market === settings.market || (!item.market && settings.watchlist.includes(item.symbol));
    });
    const strategy = store.getStrategy(user.id);
    const trades = store.getTrades(user.id).slice(0, 12);
    const orders = store.getOrders(user.id).slice(0, 12);
    const account = await tradingService.getAccount({ user, settings });

    const symbols = [...new Set([
      ...settings.watchlist,
      ...portfolio.map((item) => item.symbol)
    ])];
    const quotes = await getQuoteBatch(symbols, settings.market);

    res.render("dashboard", {
      pageTitle: settings.deskLabel,
      markets: getMarkets().filter((market) => deskKey === "us" ? ["nasdaq", "nyse"].includes(market.code) : market.code === settings.market),
      enabledDesks: getEnabledDesks(baseSettings),
      desk: {
        key: deskKey,
        label: settings.deskLabel,
        paths: {
          dashboard: `/trade/${deskKey}`,
          settings: `/trade/${deskKey}/settings`,
          strategy: `/trade/${deskKey}/strategy`,
          trade: `/trade/${deskKey}/trade`,
          runStrategy: `/trade/${deskKey}/strategy/run`,
          priceCheck: `/trade/${deskKey}/price-check`
        }
      },
      stocks: getStocksForMarket(settings.market),
      settings,
      strategy,
      strategyDefinition: settings.strategyDefinition,
      strategies: getStrategies(),
      marketStatus,
      portfolio,
      quotes,
      account,
      trades,
      orders
    });
  } catch (error) {
    next(error);
  }
}

app.get("/", requireUser, (req, res) => {
  const user = store.getUserById(req.session.userId);
  res.redirect(getDefaultDeskPath(store.getSettings(user.id)));
});

app.get("/trade/:desk", requireUser, renderTradeDesk);

app.get("/login", (req, res) => {
  res.render("login", { pageTitle: "Login" });
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = store.getUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    req.flash("error", "Invalid email or password.");
    return res.redirect("/login");
  }

  req.session.userId = user.id;
  req.flash("success", "Logged in.");
  return res.redirect(getDefaultDeskPath(store.getSettings(user.id)));
});

app.get("/register", (req, res) => {
  res.render("register", { pageTitle: "Register" });
});

app.post("/register", async (req, res) => {
  const { email, displayName, password } = req.body;
  if (store.getUserByEmail(email)) {
    req.flash("error", "That email is already registered.");
    return res.redirect("/register");
  }

  const user = store.createUser({
    email,
    displayName,
    passwordHash: await bcrypt.hash(password, 10)
  });
  req.session.userId = user.id;
  req.flash("success", "Account created. Paper trading is selected by default.");
  return res.redirect(getDefaultDeskPath(store.getSettings(user.id)));
});

app.get("/forgot-password", (req, res) => {
  res.render("forgot-password", {
    pageTitle: "Forgot Password",
    resetLink: null
  });
});

app.post("/forgot-password", (req, res) => {
  const reset = store.createPasswordReset(req.body.email);
  if (!reset) {
    req.flash("warning", "If that email exists, a reset link will be available.");
    return res.redirect("/forgot-password");
  }

  const resetLink = `${req.protocol}://${req.get("host")}${withBasePath(`/reset-password/${reset.token}`)}`;
  res.render("forgot-password", {
    pageTitle: "Forgot Password",
    resetLink
  });
});

app.get("/reset-password/:token", (req, res) => {
  const reset = store.getPasswordReset(req.params.token);
  if (!reset) {
    req.flash("error", "That reset link is invalid or has expired.");
    return res.redirect("/forgot-password");
  }

  res.render("reset-password", {
    pageTitle: "Reset Password",
    token: req.params.token,
    email: reset.email
  });
});

app.post("/reset-password/:token", async (req, res) => {
  const { password, confirmPassword } = req.body;
  if (!password || password.length < 8) {
    req.flash("error", "Password must be at least 8 characters.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }
  if (password !== confirmPassword) {
    req.flash("error", "Passwords do not match.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  const user = store.consumePasswordReset(req.params.token, await bcrypt.hash(password, 10));
  if (!user) {
    req.flash("error", "That reset link is invalid or has expired.");
    return res.redirect("/forgot-password");
  }

  req.flash("success", "Password reset. You can log in now.");
  res.redirect("/login");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.post("/trade/:desk/settings", requireUser, (req, res) => {
  const user = store.getUserById(req.session.userId);
  const deskKey = getDeskKey(req.params.desk);
  const currentSettings = store.getSettings(user.id);
  const deskSettings = getDeskSettings(currentSettings, deskKey);
  const watchlist = String(req.body.watchlist || "")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  const update = {
    tradeMode: deskSettings.deskLiveEnabled && req.body.tradeMode === "live" ? "live" : "paper",
    timezone: req.body.timezone || "Australia/Brisbane",
    requireMarketOpen: req.body.requireMarketOpen === "on",
    allowLiveTrading: deskSettings.deskLiveEnabled && req.body.allowLiveTrading === "on"
  };
  update.marketWatchlists = {
    ...(currentSettings.marketWatchlists || {}),
    [deskSettings.market]: watchlist
  };
  update.activeStrategies = {
    ...(currentSettings.activeStrategies || {}),
    [deskSettings.market]: req.body.activeStrategy || currentSettings.activeStrategies?.[deskSettings.market] || "low-margin-scalp"
  };

  if (deskKey === "aus") {
    update.ausWatchlist = watchlist;
  } else if (deskKey === "us") {
    update.market = req.body.market || "nasdaq";
    update.usMarket = req.body.market || "nasdaq";
    update.watchlist = watchlist;
    update.usWatchlist = watchlist;
  }

  store.updateSettings(user.id, update);

  req.flash("success", "Trading settings saved.");
  res.redirect(deskPath(req));
});

app.get("/settings", requireUser, (req, res) => {
  const user = store.getUserById(req.session.userId);
  const settings = store.getSettings(user.id);
  res.render("settings", {
    pageTitle: "Settings",
    settings,
    markets: getMarkets().filter((market) => ["asx", "nasdaq", "xetra", "sse", "lse"].includes(market.code)),
    desks: DESKS,
    strategies: getStrategies()
  });
});

app.get("/settings/logs", requireUser, (req, res) => {
  const user = store.getUserById(req.session.userId);
  const settings = store.getSettings(user.id);
  const logs = store.getTradeLogs(user.id);
  res.render("logs", {
    pageTitle: "Trade Logs",
    logs,
    settings,
    csvPath: `data/logs/trade-log-${user.id}.csv`
  });
});

app.get("/help", requireUser, (req, res) => {
  renderDocPage(res, "HELP_GUIDE.md", "Help Guide");
});

app.get("/manual", requireUser, (req, res) => {
  renderDocPage(res, "USER_MANUAL.md", "User Manual");
});

app.get("/strategies", requireUser, (req, res) => {
  renderDocPage(res, "STRATEGIES.md", "Strategies");
});

app.post("/settings", requireUser, (req, res) => {
  const user = store.getUserById(req.session.userId);
  const currentSettings = store.getSettings(user.id);
  const markets = getMarkets().filter((market) => ["asx", "nasdaq", "xetra", "sse", "lse"].includes(market.code));
  const enabledMarkets = arrayFromBody(req.body.enabledMarkets);
  const marketWatchlists = { ...(currentSettings.marketWatchlists || {}) };
  const brokerAccounts = { ...(currentSettings.brokerAccounts || {}) };
  const activeStrategies = { ...(currentSettings.activeStrategies || {}) };

  for (const market of markets) {
    marketWatchlists[market.code] = symbolsFromText(req.body[`watchlist_${market.code}`]);
    activeStrategies[market.code] = req.body[`strategy_${market.code}`] || "low-margin-scalp";
    brokerAccounts[market.code] = {
      brokerName: String(req.body[`brokerName_${market.code}`] || "").trim(),
      accountLabel: String(req.body[`accountLabel_${market.code}`] || "").trim(),
      mode: req.body[`brokerMode_${market.code}`] === "live" ? "live" : "paper",
      apiKey: String(req.body[`apiKey_${market.code}`] || "").trim(),
      apiSecret: String(req.body[`apiSecret_${market.code}`] || "").trim(),
      endpoint: String(req.body[`endpoint_${market.code}`] || "").trim(),
      conidMap: String(req.body[`conidMap_${market.code}`] || "").trim(),
      notes: String(req.body[`brokerNotes_${market.code}`] || "").trim()
    };
  }

  const defaultDesk = req.body.defaultDesk || "aus";
  store.updateSettings(user.id, {
    enabledMarkets: enabledMarkets.length ? enabledMarkets : ["asx"],
    marketWatchlists,
    brokerAccounts,
    activeStrategies,
    ausWatchlist: marketWatchlists.asx,
    usWatchlist: marketWatchlists.nasdaq,
    watchlist: marketWatchlists.nasdaq,
    tradeMode: req.body.globalTradeMode === "live" ? "live" : "paper",
    timezone: req.body.timezone || "Australia/Brisbane",
    requireMarketOpen: req.body.requireMarketOpen === "on",
    allowLiveTrading: req.body.allowLiveTrading === "on",
    personalization: {
      ...(currentSettings.personalization || {}),
      defaultDesk,
      currency: req.body.currency || "AUD",
      riskProfile: req.body.riskProfile || "balanced",
      dailyLossLimit: numberFromBody(req.body.dailyLossLimit, 250),
      maxTradesPerDay: numberFromBody(req.body.maxTradesPerDay, 20),
      compactMode: req.body.compactMode === "on",
      notes: String(req.body.personalNotes || "").trim()
    }
  });

  req.flash("success", "Settings saved.");
  res.redirect("/settings");
});

app.post("/trade/:desk/strategy", requireUser, (req, res) => {
  const user = store.getUserById(req.session.userId);
  const currentSettings = store.getSettings(user.id);
  const settings = getDeskSettings(currentSettings, getDeskKey(req.params.desk));
  store.updateSettings(user.id, {
    activeStrategies: {
      ...(currentSettings.activeStrategies || {}),
      [settings.market]: req.body.activeStrategy || "low-margin-scalp"
    }
  });
  store.updateStrategy(user.id, {
    targetProfitBps: numberFromBody(req.body.targetProfitBps, 35),
    stopLossBps: numberFromBody(req.body.stopLossBps, 25),
    maxSpreadBps: numberFromBody(req.body.maxSpreadBps, 20),
    maxAllocationPerTrade: numberFromBody(req.body.maxAllocationPerTrade, 500),
    maxOpenPositions: numberFromBody(req.body.maxOpenPositions, 6),
    cooldownSeconds: numberFromBody(req.body.cooldownSeconds, 60),
    minVolume: numberFromBody(req.body.minVolume, 1000000)
  });

  req.flash("success", "Strategy controls saved.");
  res.redirect(deskPath(req));
});

app.post("/strategy", requireUser, (req, res) => {
  res.redirect("/trade/aus");
});

app.post("/trade/:desk/trade", requireUser, async (req, res) => {
  const user = store.getUserById(req.session.userId);
  const settings = getDeskSettings(store.getSettings(user.id), getDeskKey(req.params.desk));

  try {
    const order = await tradingService.placeOrder({
      user,
      settings,
      symbol: String(req.body.symbol || "").trim().toUpperCase(),
      side: req.body.side,
      quantity: numberFromBody(req.body.quantity, 0),
      orderType: req.body.orderType || "market",
      limitPrice: numberFromBody(req.body.limitPrice, null),
      confirmLive: req.body.confirmLive === "on"
    });

    req.flash("success", `${order.mode.toUpperCase()} ${order.side} order accepted for ${order.quantity} ${order.symbol}.`);
  } catch (error) {
    req.flash("error", error.message);
  }

  res.redirect(deskPath(req));
});

app.post("/trade", requireUser, (req, res) => {
  res.redirect("/trade/aus");
});

app.post("/trade/:desk/strategy/run", requireUser, async (req, res) => {
  const user = store.getUserById(req.session.userId);
  const settings = getDeskSettings(store.getSettings(user.id), getDeskKey(req.params.desk));
  const strategy = store.getStrategy(user.id);

  try {
    const result = await tradingService.runStrategy({
      user,
      settings,
      strategy,
      execute: req.body.execute === "on",
      confirmLive: req.body.confirmLive === "on"
    });

    store.saveScan(user.id, result);
    req.flash("success", result.message);
  } catch (error) {
    req.flash("error", error.message);
  }

  res.redirect(deskPath(req));
});

app.post("/strategy/run", requireUser, (req, res) => {
  res.redirect("/trade/aus");
});

app.get("/trade/:desk/price/:symbol", requireUser, async (req, res) => {
  try {
    const user = store.getUserById(req.session.userId);
    const settings = getDeskSettings(store.getSettings(user.id), getDeskKey(req.params.desk));
    const quote = await getQuote(req.params.symbol.toUpperCase(), settings.market);
    res.json(quote);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get("/price/:symbol", requireUser, async (req, res) => {
  res.redirect(`/trade/aus/price/${req.params.symbol}`);
});

app.get("/trade/:desk/price-check", requireUser, async (req, res, next) => {
  try {
    const user = store.getUserById(req.session.userId);
    const settings = getDeskSettings(store.getSettings(user.id), getDeskKey(req.params.desk));
    const stocks = getStocksForMarket(settings.market);
    const quotes = await getQuoteBatch(stocks.map((stock) => stock.symbol), settings.market);
    res.render("price-check", {
      pageTitle: "Price Check",
      settings,
      desk: {
        key: getDeskKey(req.params.desk),
        label: settings.deskLabel,
        paths: {
          dashboard: deskPath(req),
          priceCheck: `${deskPath(req)}/price-check`
        }
      },
      stocks,
      quotes
    });
  } catch (error) {
    next(error);
  }
});

app.get("/price-check", requireUser, (req, res) => {
  res.redirect("/trade/aus/price-check");
});

app.use((req, res) => {
  res.status(404).render("error", {
    pageTitle: "Not Found",
    message: "That page was not found."
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).render("error", {
    pageTitle: "Error",
    message: error.message || "Something went wrong."
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Click Trader running on port ${port}`);
  console.log(`Local app: http://localhost:${port}`);
});
