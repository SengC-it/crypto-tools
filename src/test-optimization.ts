import * as fs from 'fs';
import * as path from 'path';
import { IndicatorsService } from './services/indicators';
import { requestWithRetry } from './services/binance-api';
import type { Candle } from './types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function generateTrendingCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price * 1.01;
    candles.push({
      timestamp: Date.now() + i * 60_000,
      open,
      high: close * 1.004,
      low: open * 0.996,
      close,
      volume: 10_000 + i * 100,
    });
    price = close;
  }
  return candles;
}

async function testBacktestDrivenUniverse() {
  const file = path.resolve(process.cwd(), '.temp/backtest-final.json');
  const report = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const rows = report.results
    .filter((row: any) => row.config === '优化A: 趋势优先1引擎0.35')
    .map((row: any) => ({
      symbol: row.symbol,
      pnl: row.totalPnl,
      maxDrawdown: row.maxDrawdown,
      score: row.totalPnl / (row.maxDrawdown || 1),
    }));

  const core = rows
    .filter((row: any) => row.pnl >= 20 && row.score >= 1)
    .map((row: any) => row.symbol)
    .sort();

  assert(
    JSON.stringify(core) === JSON.stringify(['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'].sort()),
    `expected core symbols BTC/ETH/SOL/XRP, got ${core.join(', ')}`,
  );

  for (const weak of ['BNB/USDT', 'DOGE/USDT', 'ADA/USDT']) {
    const row = rows.find((item: any) => item.symbol === weak);
    assert(row && row.pnl < 0, `${weak} should remain a negative-contributor symbol`);
  }
}

async function testAdxIndicatorExists() {
  const indicators = IndicatorsService.calculate(generateTrendingCandles(80));
  const adx = (indicators as any).adx;
  assert(Array.isArray(adx), 'ADX should be exposed as an array');
  assert(adx.length > 0, 'ADX should contain values for sufficient candles');
  assert(Number.isFinite(adx[adx.length - 1]), 'latest ADX should be finite');
}

async function testRequestRetry() {
  let attempts = 0;
  const result = await requestWithRetry(
    'https://example.test/retry',
    async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('temporary fetch failure');
      }
      return {
        ok: true,
        json: async () => ({ ok: true }),
        text: async () => '',
      } as Response;
    },
    3,
  );

  assert(result.ok === true, 'retry helper should return parsed JSON after transient failures');
  assert(attempts === 3, `expected 3 attempts, got ${attempts}`);
}

async function main() {
  await testBacktestDrivenUniverse();
  await testAdxIndicatorExists();
  await testRequestRetry();
  console.log('Optimization regression tests passed');
}

main().catch((err) => {
  console.error(`Optimization regression test failed: ${err.message}`);
  process.exit(1);
});
