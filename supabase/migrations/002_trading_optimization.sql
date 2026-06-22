-- ============================================
-- Trading Optimization: watchlist, trend params, signal outcomes
-- ============================================

-- Keep the active universe aligned with the 8-month 4H backtest:
-- core: BTC/ETH/SOL/XRP, observation: AVAX, disabled negative contributors.
UPDATE watchlist
SET enabled = FALSE
WHERE symbol IN ('BNB/USDT', 'DOGE/USDT', 'ADA/USDT');

INSERT INTO watchlist (symbol, timeframe, enabled) VALUES
  ('BTC/USDT', '15m', TRUE),
  ('BTC/USDT', '4h', TRUE),
  ('ETH/USDT', '15m', TRUE),
  ('ETH/USDT', '4h', TRUE),
  ('SOL/USDT', '15m', TRUE),
  ('SOL/USDT', '4h', TRUE),
  ('XRP/USDT', '15m', TRUE),
  ('XRP/USDT', '4h', TRUE),
  ('AVAX/USDT', '4h', TRUE)
ON CONFLICT (symbol, timeframe)
DO UPDATE SET enabled = EXCLUDED.enabled;

UPDATE strategy_configs
SET
  weight = 0.60,
  params = '{"ema_fast": 8, "ema_medium": 21, "ema_slow": 55, "rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70, "atr_period": 14, "atr_sl_multiplier": 1.5, "atr_tp_multiplier": 3.0, "adx_period": 14, "adx_min": 20}',
  updated_at = NOW()
WHERE engine_type = 'trend';

UPDATE strategy_configs
SET weight = 0.15, params = '{"funding_rate_threshold": 0.0001, "oi_change_threshold": 5.0}', updated_at = NOW()
WHERE engine_type = 'market_making';

UPDATE strategy_configs
SET weight = 0.25, params = '{"bb_period": 20, "bb_std": 2.0, "dca_levels": 3, "grid_spacing_pct": 2.0}', updated_at = NOW()
WHERE engine_type = 'grid_dca';

CREATE TABLE IF NOT EXISTS signal_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('open', 'take_profit', 'stop_loss', 'expired', 'manual_close')),
  checked_until TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_price DECIMAL(20,8),
  exit_at TIMESTAMPTZ,
  max_favorable_excursion_pct DECIMAL(10,4),
  max_adverse_excursion_pct DECIMAL(10,4),
  r_multiple DECIMAL(10,4),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(signal_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_outcomes_status ON signal_outcomes(status);
CREATE INDEX IF NOT EXISTS idx_signal_outcomes_r_multiple ON signal_outcomes(r_multiple DESC);
