// ============================================
// 做市引擎 (Hummingbot 风格)
//
// 核心逻辑: 利用永续合约资金费率作为方向性信号
// - 做多: 资金费率极负(空方付费) → 空头拥挤 → 反弹概率高
// - 做空: 资金费率极正(多方付费) → 多头拥挤 → 回调概率高
// - 置信度与资金费率绝对值成正比
//
// 参考: Hummingbot 的 funding rate arbitrage 策略
// ============================================

import { BaseEngine, type EngineInput, type EngineOutput } from './base';
import { IndicatorsService } from '../services/indicators';
import type { MarketMakingParams, Direction } from '../types';

export class MarketMakingEngine extends BaseEngine {
  readonly name = 'market_making';
  readonly description = '做市引擎 (资金费率+持仓量+基差分析)';

  async evaluate(input: EngineInput): Promise<EngineOutput> {
    const { symbol, timeframe, candles, marketContext, params: rawParams } = input;

    if (candles.length < 30) {
      return { signal: null, detail: null };
    }

    // 合并默认参数
    // funding_rate_threshold 从0.0003降至0.0001(回测优化: 正常市况资金费率很少超0.03%)
    const p: MarketMakingParams = {
      funding_rate_threshold: 0.0001,
      oi_change_threshold: 5.0,
      ...rawParams,
    };

    const { indicators, price } = IndicatorsService.latest(candles);
    const last = IndicatorsService.lastValue.bind(IndicatorsService);

    const fundingRate = marketContext.funding_rate;
    const atr = last(indicators.atr);
    const emaFast = last(indicators.ema.fast);
    const emaMedium = last(indicators.ema.medium);

    // ====== 资金费率信号 ======
    const absFr = Math.abs(fundingRate);
    let frDirection: Direction | null = null;
    let frConfidence = 0;
    const frReasons: string[] = [];

    // 资金费率极负 → 空方付费 → 做多(逆向)
    if (fundingRate < -p.funding_rate_threshold) {
      frDirection = 'long';
      frConfidence = this.clamp(absFr / 0.001, 0.2, 0.6); // 0.03% → 0.2, 0.1% → 0.6
      frReasons.push(`资金费率${(fundingRate * 100).toFixed(4)}%(空方付费)`);
    }
    // 资金费率极正 → 多方付费 → 做空(逆向)
    else if (fundingRate > p.funding_rate_threshold) {
      frDirection = 'short';
      frConfidence = this.clamp(absFr / 0.001, 0.2, 0.6);
      frReasons.push(`资金费率${(fundingRate * 100).toFixed(4)}%(多方付费)`);
    }

    // ====== 持仓量变化信号 ======
    let oiBoost = 0;
    if (marketContext.open_interest_change !== undefined) {
      const oiChange = marketContext.open_interest_change;
      // 持仓量大幅增加 + 价格上涨 → 多头强势
      // 持仓量大幅增加 + 价格下跌 → 空头强势
      // 持仓量大幅减少 → 趋势可能结束
      if (Math.abs(oiChange) > p.oi_change_threshold) {
        oiBoost = 0.1;
        frReasons.push(`持仓量变化${oiChange > 0 ? '+' : ''}${oiChange.toFixed(1)}%`);
      }
    }

    // ====== 趋势一致性得分 ======
    let trendBoost = 0;
    const isUptrend = emaFast > emaMedium;

    // 资金费率方向与趋势方向一致时加分
    if (frDirection === 'long' && isUptrend) {
      trendBoost = 0.1;
      frReasons.push('趋势与费率方向一致');
    } else if (frDirection === 'short' && !isUptrend) {
      trendBoost = 0.1;
      frReasons.push('趋势与费率方向一致');
    }

    // ====== 综合决策 ======
    const totalConfidence = frConfidence + oiBoost + trendBoost;

    // 无有效方向 或 置信度过低
    if (!frDirection || totalConfidence < 0.25) {
      return {
        signal: null,
        detail: {
          direction: frDirection ?? 'long',
          confidence: totalConfidence,
          reason: frReasons.join(', ') || '资金费率在正常范围',
          indicators: {
            funding_rate: (fundingRate * 100).toFixed(4) + '%',
            fr_confidence: frConfidence.toFixed(2),
            oi_change: marketContext.open_interest_change != null
              ? marketContext.open_interest_change.toFixed(1) + '%'
              : 'N/A',
            trend: isUptrend ? 'bullish' : 'bearish',
          },
        },
      };
    }

    // ====== 构建信号 ======
    const clampedConfidence = this.clamp(totalConfidence, 0, 1);
    let stopLoss: number;
    let takeProfit: number;

    if (frDirection === 'long') {
      // 做市策略止损较宽(2x ATR)，因为资金费率套利周期较长
      stopLoss = price - atr * 2.0;
      takeProfit = price + atr * 4.0; // 盈亏比 2:1
    } else {
      stopLoss = price + atr * 2.0;
      takeProfit = price - atr * 4.0;
    }

    const signal = this.buildSignal(
      symbol,
      frDirection,
      clampedConfidence,
      price,
      stopLoss,
      takeProfit,
      timeframe,
      frReasons.join(', '),
      2, // 做市策略建议2倍杠杆(保守)
      fundingRate,
    );

    const detail = this.buildDetail(frDirection, clampedConfidence, frReasons.join(', '), {
      funding_rate: (fundingRate * 100).toFixed(4) + '%',
      fr_direction: frDirection,
      oi_change: marketContext.open_interest_change != null
        ? marketContext.open_interest_change.toFixed(1) + '%'
        : 'N/A',
      trend_alignment: trendBoost > 0 ? 'yes' : 'no',
    });

    return { signal, detail };
  }
}
