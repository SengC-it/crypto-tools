# Trading Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve strategy profitability using measured symbol performance, trend-strength filtering, exchange retry reliability, and outcome tracking.

**Architecture:** Keep the existing engine structure. Add ADX to the shared indicator service, consume it in the trend engine, harden the Binance request helper, and update Supabase migrations for the optimized trading universe and signal result loop.

**Tech Stack:** TypeScript, technicalindicators, Supabase SQL, Binance Futures REST.

---

### Task 1: Optimization Regression Test

**Files:**
- Create: `src/test-optimization.ts`
- Modify: `package.json`

- [x] Write a test script that checks backtest-derived symbol tiers, ADX availability, and retry behavior.
- [x] Run `npm.cmd run test:optimization` and verify it fails before production changes.

### Task 2: Indicators and Trend Filter

**Files:**
- Modify: `src/services/indicators.ts`
- Modify: `src/types/index.ts`
- Modify: `src/engines/trend.ts`

- [x] Add ADX calculation to `IndicatorsService.calculate`.
- [x] Add `adx_period` and `adx_min` to trend parameters.
- [x] Suppress trend signals when ADX is below the configured minimum.

### Task 3: Exchange Retry Reliability

**Files:**
- Modify: `src/services/binance-api.ts`

- [x] Export a retryable request helper.
- [x] Use `EXCHANGE_RETRIES` with a conservative default.
- [x] Preserve existing response parsing and error messages.

### Task 4: Data and Runtime Defaults

**Files:**
- Modify: `src/runner/index.ts`
- Modify: `.env.example`
- Modify: `supabase/migrations/001_initial.sql`
- Create: `supabase/migrations/002_trading_optimization.sql`

- [x] Align default `MIN_CONFIDENCE` with the optimized fusion threshold.
- [x] Add XRP to the active watchlist and remove negative-contributor symbols by default.
- [x] Add `signal_outcomes` for realized signal performance.

### Task 5: Verification

**Files:**
- No production edits.

- [x] Run `npm.cmd run test:optimization`.
- [x] Run `npm.cmd run test:mock`.
- [x] Run `npm.cmd run build`.
- [x] Run `npm.cmd run test:engines` with network access and report any market-data failures.
