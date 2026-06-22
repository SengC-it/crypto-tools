import { BinanceFuturesService } from './services/binance-api';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const service = new BinanceFuturesService();
  const diagnostics = await service.diagnoseConnectivity('BTC/USDT');

  assert(diagnostics.provider === 'binance_futures', 'provider should be binance_futures');
  assert(diagnostics.symbol === 'BTC/USDT', 'symbol should be preserved');
  assert(Array.isArray(diagnostics.checks), 'checks should be an array');
  assert(diagnostics.checks.length >= 5, 'should diagnose at least five Binance Futures endpoints');

  const names = diagnostics.checks.map(check => check.name).sort();
  for (const required of ['futures_ping', 'klines_4h', 'open_interest', 'open_interest_hist', 'premium_index']) {
    assert(names.includes(required), `missing ${required} diagnostic`);
  }

  for (const check of diagnostics.checks) {
    assert(typeof check.ok === 'boolean', `${check.name} ok should be boolean`);
    assert(typeof check.duration_ms === 'number', `${check.name} duration should be numeric`);
    assert(check.duration_ms >= 0, `${check.name} duration should be non-negative`);
    if (!check.ok) {
      assert(typeof check.error === 'string' && check.error.length > 0, `${check.name} failure should include error`);
    }
  }

  console.log('Exchange health diagnostics shape passed');
}

main().catch((err) => {
  console.error(`Exchange health diagnostics test failed: ${err.message}`);
  process.exit(1);
});
