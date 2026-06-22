-- Add 2h monitoring for the active production universe.
INSERT INTO watchlist (symbol, timeframe, enabled) VALUES
  ('BTC/USDT', '2h', TRUE),
  ('ETH/USDT', '2h', TRUE),
  ('SOL/USDT', '2h', TRUE),
  ('XRP/USDT', '2h', TRUE),
  ('AVAX/USDT', '2h', TRUE),
  ('LINK/USDT', '2h', TRUE),
  ('PEPE/USDT', '2h', TRUE),
  ('WIF/USDT', '2h', TRUE),
  ('SUI/USDT', '2h', TRUE),
  ('NEAR/USDT', '2h', TRUE),
  ('INJ/USDT', '2h', TRUE),
  ('TIA/USDT', '2h', TRUE),
  ('OP/USDT', '2h', TRUE),
  ('ARB/USDT', '2h', TRUE)
ON CONFLICT (symbol, timeframe)
DO UPDATE SET enabled = EXCLUDED.enabled;
