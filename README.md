# Click Trader

Click Trader is a Node.js rebuild of the original Flask ClickTrader app. It keeps the original intent: Alpaca trading, Yahoo Finance market data, paper/live modes, market hours, watchlists, and portfolio tracking. The first screen is now a day-trading cockpit built around quick low-margin, high-volume trades.

## Stack

- Node.js 18+
- Express
- EJS server-rendered views
- File-backed JSON persistence for shared hosting simplicity
- Alpaca API for paper/live orders
- IBKR Client Portal adapter for guarded Australian live order routing
- Yahoo Finance for quotes and fallback data
- Bootstrap-free custom CSS so the app has no frontend build step

## Trading Modes

- `paper`: uses Alpaca paper credentials when present.
- `paper` without credentials: uses the local simulated ledger in `data/store.json`.
- `live`: uses Alpaca live credentials and requires explicit confirmation in the UI.

Live trading is disabled unless `ALPACA_LIVE_KEY` and `ALPACA_LIVE_SECRET` are configured.
Automatic strategy execution is enabled for simulated/paper trading by default with `AUTO_PAPER_TRADING=true`. It never auto-places live orders.

## Day Trading Focus

The dashboard includes:

- fast buy/sell order tickets
- target profit and stop loss in basis points
- max allocation per trade
- max open positions
- cooldown seconds between strategy runs
- spread/volume aware scan output
- automatic simulated/paper strategy execution while the app is awake
- strategy previews and manual order controls for testing

This is not financial advice. Test with paper mode first and review Alpaca's rules for pattern day trading, margin, shorting, and market data entitlements before using live mode.

## Local Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:3000`.

## VentraIP Shared Hosting Notes

1. Upload the project folder to your hosting account.
2. In cPanel, create a Node.js app.
3. Set the startup file to `server.js`.
4. Run `npm install` from cPanel's Node.js app screen or terminal.
5. Add environment variables from `.env.example`.
6. Start or restart the Node.js app.

Because shared hosting may sleep or restart Node processes, automatic paper trading runs only while the Node app is awake. The dashboard's scan/run buttons remain available whenever you want to test a strategy immediately.
