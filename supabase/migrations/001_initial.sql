-- ============================================
-- Crypto Signal Alert - Database Schema
-- Supabase / PostgreSQL Migration
-- ============================================

-- 信号记录表
CREATE TABLE IF NOT EXISTS signals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('long', 'short', 'close')),
  confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  entry_price DECIMAL(20,8) NOT NULL,
  stop_loss DECIMAL(20,8) NOT NULL,
  take_profit DECIMAL(20,8) NOT NULL,
  strategy_name TEXT NOT NULL,
  reason TEXT,
  timeframe TEXT NOT NULL DEFAULT '15m',
  funding_rate DECIMAL(12,8),
  leverage INTEGER DEFAULT 3,
  engine_count INTEGER DEFAULT 1,
  engine_details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 监控列表
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '15m',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, timeframe)
);

-- 策略配置表
CREATE TABLE IF NOT EXISTS strategy_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  engine_type TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT TRUE,
  weight DECIMAL(5,4) DEFAULT 0.33,
  params JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 通知发送日志
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID REFERENCES signals(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'gmail',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT
);

-- ===== 索引 =====
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_created_at ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_direction ON signals(direction);
CREATE INDEX IF NOT EXISTS idx_signals_confidence ON signals(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_signal_id ON notification_log(signal_id);

-- ===== 默认监控列表 (V4优化: 仅4h时间框架, 增加5币种) =====
INSERT INTO watchlist (symbol, timeframe) VALUES
  ('BTC/USDT', '4h'),
  ('ETH/USDT', '4h'),
  ('SOL/USDT', '4h'),
  ('XRP/USDT', '4h'),
  ('DOGE/USDT', '4h');

-- ===== 默认策略配置 (V5优化: Trend-Only + TP16 + ADX过滤 + 移动止损) =====
INSERT INTO strategy_configs (engine_type, enabled, weight, params) VALUES
  ('trend', TRUE, 1.0, '{"ema_fast": 8, "ema_medium": 21, "ema_slow": 55, "rsi_period": 14, "rsi_oversold": 30, "rsi_overbought": 70, "atr_period": 14, "atr_sl_multiplier": 3.0, "atr_tp_multiplier": 16.0, "adx_period": 14, "adx_threshold": 20, "trailing_activation_pct": 2.0, "trailing_callback_pct": 1.5}');
