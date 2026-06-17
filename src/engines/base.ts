// ============================================
// 策略引擎基类 - 所有引擎必须实现此接口
// ============================================

import type { Signal, EngineDetail, Direction, Timeframe, MarketContext, Candle } from '../types';

/** 引擎评估所需的全部输入 */
export interface EngineInput {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  marketContext: MarketContext;
  /** 引擎专属参数(从数据库读取) */
  params: Record<string, any>;
}

/** 引擎评估输出 */
export interface EngineOutput {
  signal: Signal | null;
  detail: EngineDetail | null;
}

export abstract class BaseEngine {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * 执行策略评估
   * @returns 信号(或null) + 引擎详情
   */
  abstract evaluate(input: EngineInput): Promise<EngineOutput>;

  /** 构建Signal对象的辅助方法 */
  protected buildSignal(
    symbol: string,
    direction: Direction,
    confidence: number,
    entryPrice: number,
    stopLoss: number,
    takeProfit: number,
    timeframe: Timeframe,
    reason: string,
    leverage: number = 3,
    fundingRate?: number,
  ): Signal {
    return {
      symbol,
      direction,
      confidence,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      strategy_name: this.name,
      reason,
      timeframe,
      funding_rate: fundingRate,
      leverage,
      engine_count: 1,
      engine_details: {},
      created_at: new Date().toISOString(),
    };
  }

  /** 构建EngineDetail的辅助方法 */
  protected buildDetail(
    direction: Direction,
    confidence: number,
    reason: string,
    indicators: Record<string, number | string>,
  ): EngineDetail {
    return { direction, confidence, reason, indicators };
  }

  /** 确保值在有效范围内 */
  protected clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /** 安全获取数组最后N个值 */
  protected lastN(arr: number[], n: number): number[] {
    return arr.slice(-n);
  }

  /** 安全获取最后一个值 */
  protected lastOf(arr: number[], fallback: number = 0): number {
    return arr.length > 0 ? arr[arr.length - 1] : fallback;
  }
}
