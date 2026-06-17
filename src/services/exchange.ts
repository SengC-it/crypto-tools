// ============================================
// Exchange Service - 统一数据接入层
//
// 默认使用轻量 Binance 直连封装 (undici + 代理)
// 可通过 EXCHANGE_PROVIDER=ccxt 切回 CCXT
// ============================================

import type { Candle, MarketContext, Timeframe } from '../types';
import { getBinanceService, BinanceFuturesService } from './binance-api';

export type ExchangeProvider = 'binance' | 'ccxt';

export class ExchangeService {
  private provider: ExchangeProvider;
  private binance: BinanceFuturesService;

  constructor(provider: ExchangeProvider = 'binance') {
    this.provider = provider;
    this.binance = getBinanceService();
  }

  /** 获取K线数据 */
  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe = '15m',
    limit: number = 100,
  ): Promise<Candle[]> {
    if (this.provider === 'binance') {
      return this.binance.fetchOHLCV(symbol, timeframe, limit);
    }
    throw new Error(`Provider ${this.provider} not implemented. Use 'binance'.`);
  }

  /** 获取多个时间框架的K线 */
  async fetchMultiTimeframe(
    symbol: string,
    timeframes: Timeframe[],
    limit: number = 100,
  ): Promise<Record<string, Candle[]>> {
    const results: Record<string, Candle[]> = {};
    await Promise.all(
      timeframes.map(async (tf) => {
        results[tf] = await this.fetchOHLCV(symbol, tf, limit);
      }),
    );
    return results;
  }

  /** 获取市场上下文(合约特有数据) */
  async fetchMarketContext(symbol: string): Promise<MarketContext> {
    if (this.provider === 'binance') {
      return this.binance.fetchMarketContext(symbol);
    }
    return { funding_rate: 0 };
  }

  /** 获取当前价格 */
  async fetchPrice(symbol: string): Promise<number> {
    if (this.provider === 'binance') {
      return this.binance.fetchPrice(symbol);
    }
    return 0;
  }

  /** 检查交易所连通性 */
  async ping(): Promise<boolean> {
    if (this.provider === 'binance') {
      return this.binance.ping();
    }
    return false;
  }
}

// ===== 单例 =====
let instance: ExchangeService | null = null;

export function getExchangeService(): ExchangeService {
  if (!instance) {
    const provider = (process.env.EXCHANGE_PROVIDER ?? 'binance') as ExchangeProvider;
    instance = new ExchangeService(provider);
  }
  return instance;
}
