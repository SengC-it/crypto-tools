import { filterWatchlistByTimeframe } from './runner/index';
import type { WatchlistItem } from './types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function item(symbol: string, timeframe: WatchlistItem['timeframe']): WatchlistItem {
  return { symbol, timeframe, enabled: true };
}

function testFiltersRequestedTimeframe() {
  const watchlist = [
    item('BTC/USDT', '15m'),
    item('BTC/USDT', '1h'),
    item('BTC/USDT', '4h'),
    item('ETH/USDT', '15m'),
  ];

  const filtered = filterWatchlistByTimeframe(watchlist, '15m');

  assert(filtered.length === 2, `expected 2 15m items, got ${filtered.length}`);
  assert(filtered.every((entry) => entry.timeframe === '15m'), 'all returned items should be 15m');
}

function testLeavesWatchlistUntouchedWithoutFilter() {
  const watchlist = [
    item('BTC/USDT', '15m'),
    item('BTC/USDT', '1h'),
    item('BTC/USDT', '4h'),
  ];

  const filtered = filterWatchlistByTimeframe(watchlist);

  assert(filtered.length === watchlist.length, 'missing timeframe filter should keep all items');
}

function testSupportsTwoHourTimeframe() {
  const watchlist = [
    item('BTC/USDT', '1h'),
    item('BTC/USDT', '2h'),
    item('BTC/USDT', '4h'),
    item('ETH/USDT', '2h'),
  ];

  const filtered = filterWatchlistByTimeframe(watchlist, '2h');

  assert(filtered.length === 2, `expected 2 2h items, got ${filtered.length}`);
  assert(filtered.every((entry) => entry.timeframe === '2h'), 'all returned items should be 2h');
}

function main() {
  testFiltersRequestedTimeframe();
  testLeavesWatchlistUntouchedWithoutFilter();
  testSupportsTwoHourTimeframe();
  console.log('Runner timeframe filter tests passed');
}

main();
