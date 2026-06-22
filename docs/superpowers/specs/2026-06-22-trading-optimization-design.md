# Trading Optimization Design

## Goal

Improve profitability without blindly increasing signal count. The first iteration optimizes the project around the strongest measured symbols, adds a trend-strength filter, hardens market-data access, and creates a result-tracking schema so future tuning can be driven by realized outcomes.

## Data Basis

The existing 8-month 4H backtest shows the best risk-adjusted performers are BTC/USDT, XRP/USDT, SOL/USDT, and ETH/USDT. BTC returned +32.82% with -14.11% max drawdown. XRP returned +25.13% with -12.02% max drawdown. SOL returned +25.06% with -13.68% max drawdown. ETH returned +30.63% with -23.69% max drawdown. BNB, DOGE, and ADA were negative contributors.

## Approach

1. Use the backtest data to define a tiered watchlist: core symbols get 4H and 15m coverage, AVAX remains 4H-only as an observation symbol, and the negative contributors are disabled by default.
2. Add ADX to the indicator set and use it in the trend engine to avoid taking trend signals when the market lacks trend strength.
3. Add retry behavior to Binance requests so transient fetch failures do not immediately skip a scan cycle.
4. Lower the default runtime notification threshold to match the optimized fusion threshold, while retaining cooldown protection.
5. Add a database table for signal outcomes so future iterations can measure MFE, MAE, R multiple, and exit reason.

## Success Criteria

- The optimization test can derive the recommended symbol tiers from `.temp/backtest-final.json`.
- The indicator service exposes ADX values.
- The exchange request helper retries transient failures.
- TypeScript build and existing mock engine test still pass.
- The migration reflects the optimized watchlist and outcome table.

