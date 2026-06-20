# Click Trader Help Guide

This guide explains the app in plain English.

## What Is Click Trader?

Click Trader is a tool for practising and managing share trades. It helps users:

- watch markets
- paper trade with simulated money
- test trading strategies
- record trades and results
- prepare for broker-connected trading later

## What Is a Share?

A share is a small ownership unit in a company. If you buy shares in a company and the price rises, you may be able to sell for a profit. If the price falls, you may lose money.

## What Is a Market?

A market is where shares are traded.

Examples:

- ASX: Australia
- NASDAQ: United States
- Xetra: Germany
- Shanghai: China
- London Stock Exchange: England

## What Is a Ticker Symbol?

A ticker symbol is the short code for a company.

Examples:

- `CBA`: Commonwealth Bank
- `BHP`: BHP Group
- `AAPL`: Apple
- `MSFT`: Microsoft

## What Is Paper Trading?

Paper trading means simulated trading. No real money is used.

Paper trading is useful because it lets you:

- learn the app
- test strategies
- make mistakes safely
- practise before connecting a broker

## What Is a Broker?

A broker is the company that places real trades on the market for you.

Examples include Alpaca, Interactive Brokers, CMC, CommSec, and others.

Click Trader stores broker account details in Settings, but not every broker is connected yet.

## What Is a Strategy?

A strategy is a set of rules that decides when a trade may be worth considering.

Click Trader currently includes:

- Low Margin Scalper
- Opening Momentum
- Mean Reversion

Strategies do not guarantee profit. They are structured decision rules.

## How To Make a Simple Paper Trade

1. Open the app.
2. Select a market tab, for example `AUS Trade`.
3. In Quick Order, enter a symbol such as `CBA`.
4. Choose `Buy`.
5. Enter quantity `1`.
6. Choose `Market`.
7. Click `Place Order`.
8. Check the Open Positions table.
9. To close the trade, place a `Sell` order for the same symbol and quantity.
10. Open `Settings > Logs` to review the result.

## What Is Profit/Loss?

Profit/loss shows whether a trade made or lost money.

Example:

- Buy 1 share at $100
- Sell 1 share at $101
- Profit = $1
- Profit % = 1%

If you sell lower than you bought, it is a loss.

## What Is a Watchlist?

A watchlist is the list of stocks you want to monitor.

Each market has its own watchlist in Settings.

## What Is a Market Order?

A market order buys or sells at the best available price.

It is fast, but the final price can be different from what you expected.

## What Is a Limit Order?

A limit order sets the maximum price you are willing to pay when buying, or the minimum price you are willing to accept when selling.

Limit orders give more control, but may not fill.

## What Are Basis Points?

Basis points are a way to describe small percentage moves.

- 100 bps = 1%
- 50 bps = 0.5%
- 10 bps = 0.1%

Day-trading strategies often look for small moves, so basis points are useful.

## Recommended Beginner Setup

For a new user:

- Use paper trading only.
- Keep live trading disabled.
- Start with AUS Trade or U.S. Trade.
- Use a small watchlist.
- Keep max allocation low.
- Run strategy scans before executing.
- Review logs after every trade.

## What The App Cannot Do

Click Trader cannot:

- promise profitable trades
- remove market risk
- replace financial advice
- guarantee Yahoo Finance data availability
- guarantee broker order execution

## When To Stop Trading

Stop trading if:

- you do not understand why a trade is being placed
- you hit your daily loss limit
- market data looks wrong
- the broker/API behaves unexpectedly
- you feel rushed or emotional

Good trading is controlled, patient, and logged.
