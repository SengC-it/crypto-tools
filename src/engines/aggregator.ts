// ============================================
// 信号融合引擎 (Aggregator)
//
// 核心逻辑: 多引擎投票 + 加权融合
// - 各引擎按配置权重计算加权置信度
// - 最低2个引擎方向一致才产生最终信号
// - 反向信号需更高置信度才通过(保守原则)
// - 信号冷却期避免重复通知
//
// 这是最关键的一层——单引擎看多可能是噪音，
// 多引擎同时看多才有价值
// ============================================

import type { Signal, EngineDetail, Direction, Timeframe, MarketContext, StrategyConfig } from '../types';
import type { BaseEngine, EngineOutput } from './base';
import { TrendEngine } from './trend';
import { MarketMakingEngine } from './market-making';
import { GridDCAEngine } from './grid-dca';

/** 引擎注册表 */
const ENGINE_REGISTRY: Record<string, new () => BaseEngine> = {
  trend: TrendEngine,
  market_making: MarketMakingEngine,
  grid_dca: GridDCAEngine,
};

/** 融合结果 */
export interface AggregationResult {
  finalSignal: Signal | null;
  allDetails: Record<string, EngineDetail | null>;
  rawSignals: Record<string, Signal | null>;
}

export class AggregatorEngine {
  private engines: Map<string, { engine: BaseEngine; weight: number; enabled: boolean; params: Record<string, any> }>;

  constructor(strategyConfigs: StrategyConfig[]) {
    this.engines = new Map();

    for (const config of strategyConfigs) {
      const EngineClass = ENGINE_REGISTRY[config.engine_type];
      if (!EngineClass) {
        console.warn(`[Aggregator] Unknown engine type: ${config.engine_type}, skipping`);
        continue;
      }

      this.engines.set(config.engine_type, {
        engine: new EngineClass(),
        weight: config.weight,
        enabled: config.enabled,
        params: config.params,
      });
    }

    console.log(`[Aggregator] Loaded ${this.engines.size} engines: ${[...this.engines.keys()].join(', ')}`);
  }

  /**
   * 执行多引擎融合评估
   */
  async evaluate(
    symbol: string,
    timeframe: Timeframe,
    candles: any[],
    marketContext: MarketContext,
  ): Promise<AggregationResult> {
    const allDetails: Record<string, EngineDetail | null> = {};
    const rawSignals: Record<string, Signal | null> = {};

    // 1. 并行运行所有启用的引擎
    const enginePromises = [...this.engines.entries()]
      .filter(([, config]) => config.enabled)
      .map(async ([name, config]) => {
        try {
          const output = await config.engine.evaluate({
            symbol,
            timeframe,
            candles,
            marketContext,
            params: config.params,
          });
          return { name, output, weight: config.weight };
        } catch (error: any) {
          console.error(`[Aggregator] Engine ${name} error:`, error.message);
          return {
            name,
            output: { signal: null, detail: null } as EngineOutput,
            weight: config.weight,
          };
        }
      });

    const results = await Promise.all(enginePromises);

    // 2. 收集所有引擎的结果
    for (const { name, output } of results) {
      allDetails[name] = output.detail;
      rawSignals[name] = output.signal;
    }

    // 3. 加权投票
    const longVotes: { engineName: string; confidence: number; weight: number; signal: Signal }[] = [];
    const shortVotes: { engineName: string; confidence: number; weight: number; signal: Signal }[] = [];

    for (const { name, output, weight } of results) {
      if (!output.signal) continue;

      const vote = {
        engineName: name,
        confidence: output.signal.confidence,
        weight,
        signal: output.signal,
      };

      if (output.signal.direction === 'long') {
        longVotes.push(vote);
      } else if (output.signal.direction === 'short') {
        shortVotes.push(vote);
      }
    }

    // 4. 计算加权置信度
    const longWeightedConfidence = longVotes.reduce((sum, v) => sum + v.confidence * v.weight, 0);
    const shortWeightedConfidence = shortVotes.reduce((sum, v) => sum + v.confidence * v.weight, 0);

    const longCount = longVotes.length;
    const shortCount = shortVotes.length;
    const totalEngines = results.length;

    // 5. 决策规则(回测优化后调整)
    // 原配置(2引擎0.55)在8个月回测中0笔交易 → 放宽阈值
    const minEngineCount = 1;                       // 单引擎即可入场(趋势优先)
    const minWeightedConfidence = 0.20;             // 最低加权置信度
    const minConfidenceForFinal = 0.35;             // 最终信号最低置信度

    let finalDirection: Direction | null = null;
    let finalConfidence = 0;
    let winningVotes: typeof longVotes = [];

    if (longCount >= minEngineCount && longWeightedConfidence > shortWeightedConfidence) {
      finalDirection = 'long';
      finalConfidence = longWeightedConfidence;
      winningVotes = longVotes;
    } else if (shortCount >= minEngineCount && shortWeightedConfidence > longWeightedConfidence) {
      finalDirection = 'short';
      finalConfidence = shortWeightedConfidence;
      winningVotes = shortVotes;
    } else if (longCount === 1 && longWeightedConfidence >= 0.6 && shortCount === 0) {
      // 唯一引擎但置信度极高，降低最终置信度
      finalDirection = 'long';
      finalConfidence = longWeightedConfidence * 0.8;
      winningVotes = longVotes;
    } else if (shortCount === 1 && shortWeightedConfidence >= 0.6 && longCount === 0) {
      finalDirection = 'short';
      finalConfidence = shortWeightedConfidence * 0.8;
      winningVotes = shortVotes;
    }

    // 6. 最终置信度不足 → 无信号
    if (!finalDirection || finalConfidence < minConfidenceForFinal) {
      return {
        finalSignal: null,
        allDetails,
        rawSignals,
      };
    }

    // 7. 构建最终信号
    const price = candles[candles.length - 1]?.close ?? 0;
    const atr = this.calcATR(candles);

    // 综合各引擎的止损止盈(取最保守的)
    const stopLosses = winningVotes.map(v => v.signal.stop_loss);
    const takeProfits = winningVotes.map(v => v.signal.take_profit);
    const leverages = winningVotes.map(v => v.signal.leverage);

    let stopLoss: number;
    let takeProfit: number;

    if (finalDirection === 'long') {
      // 做多取最宽止损(最低值)和最近止盈(最低值) → 更保守
      stopLoss = Math.min(...stopLosses);
      takeProfit = Math.min(...takeProfits);
    } else {
      stopLoss = Math.max(...stopLosses);
      takeProfit = Math.max(...takeProfits);
    }

    // 杠杆取最低
    const leverage = Math.min(...leverages);

    // 合并engine_details
    const engineDetails: Record<string, EngineDetail> = {};
    for (const { name, output } of results) {
      if (output.detail) {
        engineDetails[name] = output.detail;
      }
    }

    const reasonParts = winningVotes.map(v =>
      `${v.engineName}(${(v.confidence * 100).toFixed(0)}%)`
    );
    const reason = `${winningVotes.length}/${totalEngines}引擎看${finalDirection === 'long' ? '多' : '空'}: ${reasonParts.join(' + ')}`;

    const finalSignal: Signal = {
      symbol,
      direction: finalDirection,
      confidence: this.clamp(finalConfidence, 0, 1),
      entry_price: price,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      strategy_name: 'multi_engine_fusion',
      reason,
      timeframe,
      funding_rate: marketContext.funding_rate,
      leverage,
      engine_count: winningVotes.length,
      engine_details: engineDetails,
      created_at: new Date().toISOString(),
    };

    return {
      finalSignal,
      allDetails,
      rawSignals,
    };
  }

  /** 简易ATR计算(备用) */
  private calcATR(candles: any[], period: number = 14): number {
    if (candles.length < period + 1) return 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const prevClose = candles[i - 1]?.close ?? candles[i].low;
      const prevClose2 = candles[i - 1]?.close ?? candles[i].high;
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prevClose),
        Math.abs(candles[i].low - prevClose2),
      );
      sum += tr;
    }
    return sum / period;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
