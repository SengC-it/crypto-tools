// ============================================
// Binance API - 轻量直连封装 (替代 CCXT)
//
// 优势:
// - 用 undici 做 HTTP 请求，原生支持代理
// - 只实现我们需要的只读接口 (K线/资金费率/价格)
// - 无 CCXT 依赖，包体积更小
// - Vercel 部署时无需代理 (海外直连)
// ============================================

// undici 仅在需要代理时懒加载（Vercel 不需要，避免 node:net 打包失败）
import type { Candle, MarketContext, Timeframe } from '../types';

// 初始化代理 (本地开发需要，Vercel 不需要)
let proxyInitialized = false;

function ensureProxy() {
  if (proxyInitialized) return;

  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;

  if (proxyUrl) {
    try {
      const { setGlobalDispatcher, ProxyAgent } = require('undici');
      setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }));
      console.log(`[Binance] Proxy: ${proxyUrl.replace(/\/\/.*@/, '//***@')}`);
    } catch (err: any) {
      console.warn(`[Binance] Proxy setup failed: ${err.message}`);
    }
  }

  proxyInitialized = true;
}

/** Binance API 基础 URL */
const FUTURES_BASE = 'https://fapi.binance.com';
const SPOT_BASE = 'https://api.binance.com';

/** 将通用 symbol 转为 Binance API 格式 (BTC/USDT → BTCUSDT, 1000PEPE/USDT → 1000PEPEUSDT) */
function toBinanceSymbol(symbol: string): string {
  return symbol.replace('/', '');
}

/** Binance 特殊 symbol 映射 (通用格式 → Binance 合约格式) */
const SYMBOL_ALIASES: Record<string, string> = {
  'PEPE/USDT': '1000PEPE/USDT',
};

function resolveSymbol(symbol: string): string {
  return SYMBOL_ALIASES[symbol] ?? symbol;
}
const TIMEFRAME_MAP: Record<Timeframe, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/** 简易请求缓存 */
interface CacheEntry<T> { data: T; ts: number; }
const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 30_000; // 30秒

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, ts: Date.now() });
}

/** GET 请求 */
async function get(url: string): Promise<any> {
  ensureProxy();
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(parseInt(process.env.EXCHANGE_TIMEOUT ?? '30000', 10)),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Binance API ${resp.status}: ${url} — ${text.slice(0, 200)}`);
  }

  return resp.json();
}

// ============================================
// BinanceFuturesService
// ============================================

export class BinanceFuturesService {
  /** 获取合约 K 线数据 */
  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe = '15m',
    limit: number = 100,
  ): Promise<Candle[]> {
    const resolvedSymbol = resolveSymbol(symbol);
    const binanceSymbol = toBinanceSymbol(resolvedSymbol);
    const cacheKey = `ohlcv_${symbol}_${timeframe}_${limit}`;
    const cached = getCached<Candle[]>(cacheKey);
    if (cached) return cached;

    const url = `${FUTURES_BASE}/fapi/v1/klines?symbol=${binanceSymbol}&interval=${TIMEFRAME_MAP[timeframe]}&limit=${limit}`;
    const raw: any[][] = await get(url);

    const candles: Candle[] = raw.map((bar) => ({
      timestamp: Number(bar[0]),
      open: Number(bar[1]),
      high: Number(bar[2]),
      low: Number(bar[3]),
      close: Number(bar[4]),
      volume: Number(bar[5]),
    }));

    setCache(cacheKey, candles);
    return candles;
  }

  /** 获取市场上下文 (资金费率 + 标记价格) */
  async fetchMarketContext(symbol: string): Promise<MarketContext> {
    const resolvedSymbol = resolveSymbol(symbol);
    const binanceSymbol = toBinanceSymbol(resolvedSymbol);
    const cacheKey = `ctx_${symbol}`;
    const cached = getCached<MarketContext>(cacheKey);
    if (cached) return cached;

    const context: MarketContext = { funding_rate: 0 };

    try {
      // 并行获取资金费率和标记价格
      const [premiumInfo, markPrice] = await Promise.all([
        get(`${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${binanceSymbol}`).catch(() => null),
        get(`${FUTURES_BASE}/fapi/v1/markPrice?symbol=${binanceSymbol}`).catch(() => null),
      ]);

      if (premiumInfo) {
        context.funding_rate = Number(premiumInfo.lastFundingRate ?? 0);
        context.next_funding_time = Number(premiumInfo.nextFundingTime ?? 0) || undefined;
        context.mark_price = Number(premiumInfo.markPrice ?? 0) || undefined;
      }

      if (markPrice) {
        context.mark_price = Number(markPrice.markPrice ?? 0) || context.mark_price;
        context.index_price = Number(markPrice.indexPrice ?? 0) || undefined;
      }
    } catch (err: any) {
      console.warn(`[Binance] fetchMarketContext partial failure for ${symbol}: ${err.message}`);
    }

    setCache(cacheKey, context);
    return context;
  }

  /** 获取当前价格 */
  async fetchPrice(symbol: string): Promise<number> {
    const resolvedSymbol = resolveSymbol(symbol);
    const binanceSymbol = toBinanceSymbol(resolvedSymbol);
    const url = `${FUTURES_BASE}/fapi/v1/ticker/price?symbol=${binanceSymbol}`;
    const data = await get(url);
    return Number(data.price ?? 0);
  }

  /** 获取 24h 行情概要 */
  async fetch24hrTicker(symbol: string): Promise<{
    priceChange: number;
    priceChangePercent: number;
    volume: number;
    quoteVolume: number;
  }> {
    const resolvedSymbol = resolveSymbol(symbol);
    const binanceSymbol = toBinanceSymbol(resolvedSymbol);
    const url = `${FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${binanceSymbol}`;
    const data = await get(url);
    return {
      priceChange: Number(data.priceChange ?? 0),
      priceChangePercent: Number(data.priceChangePercent ?? 0),
      volume: Number(data.volume ?? 0),
      quoteVolume: Number(data.quoteVolume ?? 0),
    };
  }

  /** 检查 Binance API 可用性 */
  async ping(): Promise<boolean> {
    try {
      await get(`${FUTURES_BASE}/fapi/v1/ping`);
      return true;
    } catch {
      return false;
    }
  }
}

// ===== 单例 =====
let instance: BinanceFuturesService | null = null;

export function getBinanceService(): BinanceFuturesService {
  if (!instance) {
    instance = new BinanceFuturesService();
  }
  return instance;
}
