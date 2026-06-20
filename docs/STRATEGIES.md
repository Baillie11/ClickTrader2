# Click Trader Strategy Descriptions

Strategies are modular rule sets. Each one reviews the current watchlist, current positions, market data, and the user's risk controls.

The active strategy can be selected per market in `Settings`.

## Shared Controls

Strategies use the following controls from the dashboard:

- Target profit bps
- Stop loss bps
- Max spread bps
- Min volume
- Max allocation per trade
- Max open positions
- Cooldown seconds

## Low Margin Scalper

### Purpose

Designed for high-turnover, low-margin trades.

### Entry Logic

The strategy looks for stocks that:

- are in the active market watchlist
- are not already open positions
- have positive price movement
- meet minimum volume requirements
- are inside the maximum spread limit

### Exit Logic

The strategy suggests selling when:

- the position reaches the target profit basis points, or
- the position hits the stop loss basis points

### Best Fit

This strategy is best for:

- liquid stocks
- tight spreads
- small profit targets
- frequent paper testing

### Main Risks

- Small price moves can be eaten by brokerage fees in real trading.
- Poor liquidity can cause bad fills.
- Fast movement can reverse quickly.

## Opening Momentum

### Purpose

Designed to find stocks with strong early positive movement.

### Entry Logic

The strategy looks for stocks that:

- are in the active market watchlist
- are not already open positions
- have a strong positive percentage move
- meet minimum volume requirements
- are inside the maximum spread limit

### Exit Logic

The strategy uses:

- a slightly larger profit target than the scalper
- a slightly tighter stop loss than the default scalper

### Best Fit

This strategy is best for:

- early-session scans
- strong upward movers
- markets with clear momentum

### Main Risks

- Buying after a fast rise can mean entering late.
- Momentum can reverse sharply.
- Opening market data may be noisy.

## Mean Reversion

### Purpose

Designed to find stocks that have pulled back and may recover.

### Entry Logic

The strategy looks for stocks that:

- are in the active market watchlist
- are not already open positions
- have a meaningful negative intraday move
- meet minimum volume requirements
- are inside the maximum spread limit

### Exit Logic

The strategy uses:

- a smaller profit target than the scalper
- a slightly wider stop loss than the scalper

### Best Fit

This strategy is best for:

- liquid stocks that may bounce after a pullback
- disciplined paper testing
- markets where overreaction is common

### Main Risks

- A falling stock may keep falling.
- Pullbacks can signal real weakness.
- It requires strict stop-loss discipline.

## Manual Trading

Manual trades are still logged. If a manual trade is placed from a market desk, the log records the strategy selected for that market at the time of the trade.

## Adding Future Strategies

Strategies are registered in:

```text
src/strategyRegistry.js
```

A strategy should provide:

- id
- name
- description
- evaluate function

The evaluate function returns planned trade actions with:

- symbol
- side
- quantity
- reason
- quote
- score
