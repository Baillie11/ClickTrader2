# Click Trader User Manual

Click Trader is a trading cockpit for paper trading, strategy testing, and controlled broker-connected trading as the platform grows.

This manual is written for users who are not stock-market experts. It explains what each area does and how to use the app safely.

## Important Safety Notes

- Click Trader does not guarantee profitable trades.
- Paper trading uses simulated money and is the safest way to learn.
- Live trading can lose real money.
- Do not enable live trading until you understand the broker, market rules, fees, taxes, and the strategy you are using.
- The non-U.S. markets currently use Yahoo Finance market data and the local paper simulator unless a real broker adapter is added later.

## Getting Started

1. Start the app:

```powershell
npm start
```

2. Open the local link shown in the terminal.
3. Create an account.
4. Go to `Settings`.
5. Choose the markets you want to see.
6. Use paper trading first.

## Main Navigation

### Prices

Shows current watchlist prices for the active market using Yahoo Finance data.

### Settings

Where each user controls:

- enabled markets
- watchlists
- broker account details
- active strategy per market
- risk preferences
- default landing desk
- logs

### Logout

Ends your current session.

## Trading Desks

Trading desks appear as tabs below the page heading. The tabs shown depend on the markets enabled in `Settings`.

Available market desks:

- AUS Trade: ASX paper trading
- U.S. Trade: NASDAQ/NYSE paper or broker-connected trading
- Germany Trade: Xetra paper trading
- China Trade: Shanghai paper trading
- England Trade: London paper trading

## Paper Trading

Paper trading is simulated trading. It lets you practise without using real money.

In Click Trader, paper trades:

- use your watchlist
- fetch market prices from Yahoo Finance
- update the simulated portfolio
- create trade logs
- calculate realised profit/loss when a simulated sell closes a position

## Live Trading

Live trading is only available where a broker adapter exists and credentials are configured.

Current safe behaviour:

- AUS, Germany, China, and England desks are paper-only.
- U.S. Trade can use Alpaca where credentials are available.
- Live trading also requires explicit confirmation in the UI.

## Dashboard Sections

### Account Summary

Shows:

- trading mode
- provider
- cash
- equity

For local simulator mode, provider is `Local simulator`.

### Quick Order

Use this to manually place a paper or broker order.

Fields:

- Symbol: stock ticker, for example `CBA` or `AAPL`
- Side: buy or sell
- Quantity: number of shares
- Order type: market or limit
- Limit price: required only for limit orders
- Confirm live order: required for live mode

### Strategy Runner

Runs the selected strategy for the active market.

Options:

- Scan Strategy: previews candidate trades.
- Execute orders from this run: places trades from the strategy plan.
- Confirm live strategy execution: required for live mode.

### Trading Settings

Fast settings for the current desk:

- paper/live mode where supported
- market
- timezone
- watchlist
- market-hours guard
- live trading toggle where supported

### Scalping Rules

These controls are shared by the current strategy engine:

- Target profit bps: profit target in basis points
- Stop loss bps: loss limit in basis points
- Max spread bps: maximum allowed bid/ask spread
- Min volume: minimum trading volume
- Max allocation: maximum money per trade
- Max positions: maximum open positions
- Cooldown seconds: time between strategy runs

Basis points help describe small percentage moves:

- 100 bps = 1%
- 50 bps = 0.5%
- 10 bps = 0.1%

## Settings Page

### Personal Defaults

Controls global user preferences:

- Default desk
- Timezone
- Display currency
- Risk profile
- Daily loss limit
- Max trades per day
- Global trade mode
- Market-hours guard
- Live trading enable switch
- Compact dashboard mode
- Personal notes

### Markets

Each market card lets the user configure:

- whether the market is enabled
- active strategy
- watchlist
- broker details
- paper/live broker mode
- API credentials
- broker notes

### Strategy Library

Shows the available strategy modules and explains what each one is designed to do.

## Logs

Open logs from:

```text
Settings > Logs
```

Logs track:

- trade date and time
- market
- stock symbol
- buy/sell side
- quantity
- price
- notional value
- strategy used
- provider
- paper/live mode
- status
- profit/loss in dollars
- profit/loss percentage
- trade reason
- order type
- broker order ID where available

CSV files are also written under:

```text
data/logs/
```

## A Safe First Workflow

1. Start in paper mode.
2. Use AUS Trade or U.S. Trade.
3. Keep market-hours guard enabled.
4. Use a small max allocation.
5. Run `Scan Strategy` without executing.
6. Read the suggested actions.
7. Place one small manual paper buy.
8. Place one small manual paper sell.
9. Review `Settings > Logs`.
10. Only consider live trading after consistent paper testing.

## Common Problems

### I logged in but went back to login

Check `.env` contains:

```env
COOKIE_SECURE=false
```

For localhost, secure cookies must be disabled.

### A market is closed

The market-hours guard blocks trades outside market hours. This is intentional. You can disable it in Settings for paper testing.

### A price does not load

Yahoo Finance may not return data for every ticker. Check the symbol and market suffix assumptions.

### AUS live trading does not work

Correct. AUS is currently paper simulation only until an ASX-capable broker adapter is added.
