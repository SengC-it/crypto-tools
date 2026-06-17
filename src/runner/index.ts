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
// ============================================

import { getExchangeService } from '../services/exchange';
import { getDatabaseService } from '../services/database';
import { getNotificationService } from '../services/notification';
import { AggregatorEngine } from '../engines/aggregator';
import type { RunResult, StrategyConfig, Timeframe } from '../types';

export class Runner {
  /**
   * 执行一次完整的信号检测周期
   */
  async run(): Promise<RunResult> {
    const startTime = new Date().toISOString();
    const errors: string[] = [];
    let signalsGenerated = 0;
    let notificationsSent = 0;

    const details: RunResult['details'] = [];

    try {
      // 1. 初始化服务
      const exchange = getExchangeService();
      const db = getDatabaseService();
      const notifier = getNotificationService();

      // 2. 加载配置
      const [watchlist, strategyConfigs] = await Promise.all([
        db.getWatchlist().catch((err) => {
          errors.push(`Watchlist加载失败: ${err.message}`);
          return [];
        }),
        db.getStrategyConfigs().catch((err) => {
          errors.push(`策略配置加载失败: ${err.message}`);
          return [] as StrategyConfig[];
        }),
      ]);

      if (watchlist.length === 0) {
        errors.push('监控列表为空');
        return this.buildResult(startTime, 0, 0, errors, []);
      }

      if (strategyConfigs.length === 0) {
        errors.push('策略配置为空');
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

          // 5e. 冷却期检查
          const cooldownHours = parseInt(process.env.SIGNAL_COOLDOWN_HOURS ?? '4', 10);
          const inCooldown = await db.isSignalInCooldown(
            signal.symbol,
            signal.direction,
            cooldownHours,
          );

          if (inCooldown) {
            console.log(`[Runner] ${signal.symbol} ${signal.direction} 信号在冷却期内，跳过`);
            continue;
          }

          // 5f. 置信度检查
          const minConfidence = parseFloat(process.env.MIN_CONFIDENCE ?? '0.55');
          if (signal.confidence < minConfidence) {
            console.log(`[Runner] ${signal.symbol} 置信度${(signal.confidence * 100).toFixed(0)}%低于阈值${(minConfidence * 100).toFixed(0)}%，跳过`);
            continue;
          }

          // 5g. 保存信号
          const savedSignal = await db.saveSignal(signal);
          signalsGenerated++;

          // 5h. 发送Gmail通知
          const sent = await notifier.sendSignalEmail(signal);

          // 5i. 记录通知日志
          await db.logNotification({
            signal_id: savedSignal.id ?? '',
            channel: 'gmail',
            sent_at: new Date().toISOString(),
            status: sent ? 'sent' : 'failed',
            error: sent ? undefined : 'Gmail send failed',
          });

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
