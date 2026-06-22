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
  '2h': '2h',
  '4h': '4h',
  '1d': '1d',
};

export interface ExchangeHealthCheck {
  name: string;
  ok: boolean;
  duration_ms: number;
  error?: string;
  sample?: Record<string, number | string | boolean>;
}

export interface ExchangeHealthDiagnostics {
  provider: 'binance_futures';
  symbol: string;
  ok: boolean;
  region?: string;
  checked_at: string;
  checks: ExchangeHealthCheck[];
}

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

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function retryDelayMs(attempt: number): number {
  return Math.min(250 * attempt, 1_000);
}

export async function requestWithRetry(
  url: string,
  fetcher: Fetcher = fetch,
  maxAttempts: number = parseInt(process.env.EXCHANGE_RETRIES ?? '3', 10),
): Promise<any> {
  ensureProxy();
  const attempts = Math.max(1, maxAttempts);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await fetcher(url, {
        signal: AbortSignal.timeout(parseInt(process.env.EXCHANGE_TIMEOUT ?? '30000', 10)),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Binance API ${resp.status}: ${url} — ${text.slice(0, 200)}`);
      }

      return resp.json();
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= attempts) break;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }

  throw lastError ?? new Error(`Binance API request failed: ${url}`);
}

/** GET 请求 */
async function get(url: string): Promise<any> {
  return requestWithRetry(url);
}

// ============================================
// BinanceFuturesService
// ============================================

export class BinanceFuturesService {
  async diagnoseConnectivity(symbol: string = 'BTC/USDT'): Promise<ExchangeHealthDiagnostics> {
    const resolvedSymbol = resolveSymbol(symbol);
    const binanceSymbol = toBinanceSymbol(resolvedSymbol);

    const endpoints: { name: string; url: string; sample: (data: any) => Record<string, number | string | boolean> }[] = [
      {
        name: 'futures_ping',
        url: `${FUTURES_BASE}/fapi/v1/ping`,
        sample: () => ({ reachable: true }),
      },
      {
        name: 'klines_4h',
        url: `${FUTURES_BASE}/fapi/v1/klines?symbol=${binanceSymbol}&interval=4h&limit=2`,
        sample: (data) => ({
          bars: Array.isArray(data) ? data.length : 0,
          last_close: Array.isArray(data) && data.length > 0 ? Number(data[data.length - 1][4]) : 0,
        }),
      },
      {
        name: 'premium_index',
        url: `${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${binanceSymbol}`,
        sample: (data) => ({
          funding_rate: Number(data?.lastFundingRate ?? 0),
          mark_price: Number(data?.markPrice ?? 0),
        }),
      },
      {
        name: 'open_interest',
        url: `${FUTURES_BASE}/fapi/v1/openInterest?symbol=${binanceSymbol}`,
        sample: (data) => ({
          open_interest: Number(data?.openInterest ?? 0),
        }),
      },
      {
        name: 'open_interest_hist',
        url: `${FUTURES_BASE}/futures/data/openInterestHist?symbol=${binanceSymbol}&period=4h&limit=2`,
        sample: (data) => ({
          rows: Array.isArray(data) ? data.length : 0,
        }),
      },
    ];

    const checks = await Promise.all(endpoints.map(async (endpoint): Promise<ExchangeHealthCheck> => {
      const started = Date.now();
      try {
        const data = await requestWithRetry(endpoint.url);
        return {
          name: endpoint.name,
          ok: true,
          duration_ms: Date.now() - started,
          sample: endpoint.sample(data),
        };
      } catch (err: any) {
        return {
          name: endpoint.name,
          ok: false,
          duration_ms: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }));

    return {
      provider: 'binance_futures',
      symbol,
      ok: checks.every(check => check.ok),
      region: process.env.VERCEL_REGION,
      checked_at: new Date().toISOString(),
      checks,
    };
  }

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
      // 并行获取资金费率、标记价格和持仓量
      const [premiumInfo, markPrice, openInterest, openInterestHist] = await Promise.all([
        get(`${FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${binanceSymbol}`).catch(() => null),
        get(`${FUTURES_BASE}/fapi/v1/markPrice?symbol=${binanceSymbol}`).catch(() => null),
        get(`${FUTURES_BASE}/fapi/v1/openInterest?symbol=${binanceSymbol}`).catch(() => null),
        get(`${FUTURES_BASE}/futures/data/openInterestHist?symbol=${binanceSymbol}&period=4h&limit=2`).catch(() => null),
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

      if (openInterest) {
        context.open_interest = Number(openInterest.openInterest ?? 0) || undefined;
      }

      if (Array.isArray(openInterestHist) && openInterestHist.length >= 2) {
        const previous = Number(openInterestHist[openInterestHist.length - 2]?.sumOpenInterest ?? 0);
        const current = Number(openInterestHist[openInterestHist.length - 1]?.sumOpenInterest ?? 0);
        if (previous > 0 && current > 0) {
          context.open_interest_change = (current - previous) / previous * 100;
        }
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
