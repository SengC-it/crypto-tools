// ============================================
// Runner - 信号检测编排器
//
// 完整流程:
// 1. 从Supabase读取监控列表和策略配置
// 2. 从CCXT获取行情数据和合约上下文
// 3. 运行Aggregator多引擎融合评估
// 4. 检查信号冷却期
// 5. 保存信号到Supabase
// 6. 通过Gmail发送通知
// 7. 记录通知日志
//
// 降级模式: 当 Supabase 不可用时,
// 使用本地硬编码的监控列表和策略配置继续运行
// ============================================

import { getExchangeService } from '../services/exchange';
import { getDatabaseService } from '../services/database';
import { getNotificationService } from '../services/notification';
import { AggregatorEngine } from '../engines/aggregator';
import type { RunResult, StrategyConfig, Timeframe, WatchlistItem } from '../types';

// ====== 降级模式: 本地默认配置 (V5优化: Trend-Only + TP16 + ADX + 移动止损) ======
const FALLBACK_WATCHLIST: WatchlistItem[] = [
  { symbol: 'BTC/USDT', timeframe: '4h', enabled: true },
  { symbol: 'ETH/USDT', timeframe: '4h', enabled: true },
  { symbol: 'SOL/USDT', timeframe: '4h', enabled: true },
  { symbol: 'XRP/USDT', timeframe: '4h', enabled: true },
  { symbol: 'DOGE/USDT', timeframe: '4h', enabled: true },
];

const FALLBACK_STRATEGY_CONFIGS: StrategyConfig[] = [
  {
    engine_type: 'trend',
    enabled: true,
    weight: 1.0,  // V5: Trend-Only, 权重100%
    params: {
      ema_fast: 8, ema_medium: 21, ema_slow: 55,
      rsi_period: 14, rsi_oversold: 30, rsi_overbought: 70,
      atr_period: 14, atr_sl_multiplier: 3.0, atr_tp_multiplier: 16.0,
      adx_period: 14, adx_threshold: 20,
      trailing_activation_pct: 1.5, trailing_callback_pct: 1.0,
    },
  },
  // V5: Grid+MM引擎已禁用 (回测证明净亏损: MM -62.19%, Grid -275.39%)
  // {
  //   engine_type: 'market_making',
  //   enabled: false,
  //   weight: 0.0,
  //   params: {},
  // },
  // {
  //   engine_type: 'grid_dca',
  //   enabled: false,
  //   weight: 0.0,
  //   params: {},
  // },
];

export interface RunOptions {
  timeframe?: Timeframe;
}

export function filterWatchlistByTimeframe(
  watchlist: WatchlistItem[],
  timeframe?: Timeframe,
): WatchlistItem[] {
  if (!timeframe) return watchlist;
  return watchlist.filter((item) => item.timeframe === timeframe);
}

/** 尝试初始化数据库服务, 失败则返回 null (降级模式) */
function tryInitDatabase(): { db: any; degraded: boolean } {
  try {
    const db = getDatabaseService();
    return { db, degraded: false };
  } catch (err: any) {
    console.warn(`[Runner] Database init failed (${err.message}), switching to degraded mode`);
    return { db: null, degraded: true };
  }
}

export class Runner {
  /**
   * 执行一次完整的信号检测周期
   */
  async run(options: RunOptions = {}): Promise<RunResult> {
    const startTime = new Date().toISOString();
    const errors: string[] = [];
    let signalsGenerated = 0;
    let notificationsSent = 0;
    let degradedMode = false;

    const details: RunResult['details'] = [];

    try {
      // 1. 初始化服务
      const exchange = getExchangeService();
      const { db, degraded } = tryInitDatabase();
      degradedMode = degraded;

      let notifier: ReturnType<typeof getNotificationService> | null = null;
      try {
        notifier = getNotificationService();
      } catch (err: any) {
        console.warn(`[Runner] Notification init failed (${err.message}), emails will be skipped`);
      }

      // 2. 加载配置 (降级模式使用本地默认)
      let watchlist: WatchlistItem[];
      let strategyConfigs: StrategyConfig[];

      if (degraded || !db) {
        console.warn('[Runner] Running in DEGRADED mode - using local fallback configs');
        watchlist = FALLBACK_WATCHLIST;
        strategyConfigs = FALLBACK_STRATEGY_CONFIGS;
      } else {
        const [wlResult, scResult] = await Promise.all([
          db.getWatchlist().catch((err: any) => {
            errors.push(`Watchlist加载失败: ${err.message}`);
            return [] as WatchlistItem[];
          }),
          db.getStrategyConfigs().catch((err: any) => {
            errors.push(`策略配置加载失败: ${err.message}`);
            return [] as StrategyConfig[];
          }),
        ]);
        watchlist = wlResult;
        strategyConfigs = scResult;

        // 如果DB返回空结果, 降级到本地默认
        if (watchlist.length === 0) {
          console.warn('[Runner] DB watchlist empty, falling back to local defaults');
          watchlist = FALLBACK_WATCHLIST;
        }
        if (strategyConfigs.length === 0) {
          console.warn('[Runner] DB strategy configs empty, falling back to local defaults');
          strategyConfigs = FALLBACK_STRATEGY_CONFIGS;
        }
      }

      if (watchlist.length === 0) {
        errors.push('监控列表为空');
        return this.buildResult(startTime, 0, 0, errors, []);
      }

      if (strategyConfigs.length === 0) {
        errors.push('策略配置为空');
        return this.buildResult(startTime, 0, 0, errors, []);
      }

      watchlist = filterWatchlistByTimeframe(watchlist, options.timeframe);

      if (watchlist.length === 0) {
        errors.push(options.timeframe
          ? `No enabled watchlist items for timeframe ${options.timeframe}`
          : '监控列表为空');
        return this.buildResult(startTime, 0, 0, errors, []);
      }

      // 3. 创建聚合引擎
      const aggregator = new AggregatorEngine(strategyConfigs);

      // 4. 按唯一symbol分组(去重相同symbol的不同timeframe场景)
      const symbolSet = new Set(watchlist.map(w => w.symbol));

      // 5. 遍历每个监控项
      for (const item of watchlist) {
        try {
          // 5a. 获取K线数据
          const candles = await exchange.fetchOHLCV(item.symbol, item.timeframe as Timeframe, 100);

          if (candles.length < 60) {
            details.push({
              symbol: item.symbol,
              timeframe: item.timeframe,
              engine_results: {},
              final_signal: null,
            });
            continue;
          }

          // 5b. 获取市场上下文(资金费率等)
          const marketContext = await exchange.fetchMarketContext(item.symbol);

          // 5c. 运行多引擎评估
          const result = await aggregator.evaluate(
            item.symbol,
            item.timeframe as Timeframe,
            candles,
            marketContext,
          );

          details.push({
            symbol: item.symbol,
            timeframe: item.timeframe,
            engine_results: result.allDetails,
            final_signal: result.finalSignal,
          });

          // 5d. 检查是否有有效信号
          if (!result.finalSignal) continue;

          const signal = result.finalSignal;

          // 5e. 冷却期检查 (降级模式下跳过)
          let inCooldown = false;
          if (db) {
            const cooldownHours = parseInt(process.env.SIGNAL_COOLDOWN_HOURS ?? '1', 10);
            inCooldown = await db.isSignalInCooldown(
              signal.symbol,
              signal.direction,
              cooldownHours,
            );
          }

          if (inCooldown) {
            console.log(`[Runner] ${signal.symbol} ${signal.direction} 信号在冷却期内，跳过`);
            continue;
          }

          // 5f. 置信度检查
          const minConfidence = parseFloat(process.env.MIN_CONFIDENCE ?? '0.40');
          if (signal.confidence < minConfidence) {
            console.log(`[Runner] ${signal.symbol} 置信度${(signal.confidence * 100).toFixed(0)}%低于阈值${(minConfidence * 100).toFixed(0)}%，跳过`);
            continue;
          }

          // 5g. 保存信号 (降级模式下跳过)
          let savedSignal: any = { id: `local-${Date.now()}` };
          if (db) {
            savedSignal = await db.saveSignal(signal);
          } else {
            console.log(`[Runner] DEGRADED: Signal not saved to DB - ${signal.symbol} ${signal.direction}`);
          }
          signalsGenerated++;

          // 5h. 发送Gmail通知 (如果可用)
          let sent = false;
          if (notifier) {
            sent = await notifier.sendSignalEmail(signal);
          } else {
            console.log(`[Runner] DEGRADED: No email notification - ${signal.symbol} ${signal.direction}`);
          }

          // 5i. 记录通知日志 (降级模式下跳过)
          if (db) {
            await db.logNotification({
              signal_id: savedSignal.id ?? '',
              channel: 'gmail',
              sent_at: new Date().toISOString(),
              status: sent ? 'sent' : 'failed',
              error: sent ? undefined : 'Gmail send failed',
            });
          }

          if (sent) {
            notificationsSent++;
            console.log(`[Runner] Signal sent: ${signal.symbol} ${signal.direction} confidence=${(signal.confidence * 100).toFixed(0)}%`);
          }

        } catch (err: any) {
          errors.push(`${item.symbol}(${item.timeframe}): ${err.message}`);
          console.error(`[Runner] Error processing ${item.symbol}:`, err.message);
        }
      }

    } catch (err: any) {
      errors.push(`Runner fatal error: ${err.message}`);
      console.error('[Runner] Fatal error:', err);
    }

    if (degradedMode) {
      errors.push('[DEGRADED] Supabase unavailable, using local fallback configs');
    }

    return this.buildResult(startTime, signalsGenerated, notificationsSent, errors, details);
  }

  /** 健康检查 */
  async healthCheck(): Promise<{
    exchange: boolean;
    database: boolean;
    gmail: boolean;
  }> {
    const results = { exchange: false, database: false, gmail: false };

    try {
      const exchange = getExchangeService();
      await exchange.fetchPrice('BTC/USDT');
      results.exchange = true;
    } catch { /* */ }

    try {
      const db = getDatabaseService();
      await db.getTodaySignalCount();
      results.database = true;
    } catch { /* */ }

    try {
      const notifier = getNotificationService();
      results.gmail = await notifier.verifyConnection();
    } catch { /* */ }

    return results;
  }

  private buildResult(
    timestamp: string,
    signalsGenerated: number,
    notificationsSent: number,
    errors: string[],
    details: RunResult['details'],
  ): RunResult {
    return { timestamp, signals_generated: signalsGenerated, notifications_sent: notificationsSent, errors, details };
  }
}
