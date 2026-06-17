// ============================================
// 趋势跟踪引擎 (Freqtrade + Jesse 风格)
//
// 策略逻辑:
// - 做多: EMA8 > EMA21(趋势向上) + RSI从超卖区回升 + MACD金叉 + 成交量确认
// - 做空: EMA8 < EMA21(趋势向下) + RSI从超买区回落 + MACD死叉 + 成交量确认
// - 止损: ATR * 1.5 (避免正常波动被扫)
// - 止盈: ATR * 3.0 (追求稳定盈亏比 ≥ 2:1)
// ============================================

import { BaseEngine, type EngineInput, type EngineOutput } from './base';
import { IndicatorsService } from '../services/indicators';
import type { TrendParams, Direction, Signal, EngineDetail } from '../types';

export class TrendEngine extends BaseEngine {
  readonly name = 'trend';
  readonly description = '趋势跟踪引擎 (EMA+RSI+MACD+量能确认)';

  async evaluate(input: EngineInput): Promise<EngineOutput> {
    const { symbol, timeframe, candles, params: rawParams } = input;

    if (candles.length < 60) {
      return { signal: null, detail: null };
    }

    // 合并默认参数
    const p: TrendParams = {
      ema_fast: 8,
      ema_medium: 21,
      ema_slow: 55,
      rsi_period: 14,
      rsi_oversold: 30,
      rsi_overbought: 70,
      atr_period: 14,
      atr_sl_multiplier: 1.5,
      atr_tp_multiplier: 3.0,
      ...rawParams,
    };

    // 计算指标
    const { indicators, pivots, price } = IndicatorsService.latest(candles);
    const last = IndicatorsService.lastValue.bind(IndicatorsService);

    const emaFast = last(indicators.ema.fast);
    const emaMedium = last(indicators.ema.medium);
    const emaSlow = last(indicators.ema.slow);

    const rsi = last(indicators.rsi);
    const prevRsi = IndicatorsService.nthLast(indicators.rsi, 2);

    const macdHistogram = last(indicators.macd.histogram);
    const macdCross = IndicatorsService.detectMACDCross(indicators.macd.histogram);

    const atr = last(indicators.atr);
    const volumeRatio = indicators.volume.ratio;

    // 趋势判断
    const isUptrend = emaFast > emaMedium && emaMedium > emaSlow;
    const isDowntrend = emaFast < emaMedium && emaMedium < emaSlow;

    // ====== 做多信号评估 ======
    let longScore = 0;
    const longReasons: string[] = [];

    // 1. 趋势向上 (权重最高)
    if (isUptrend) {
      longScore += 0.35;
      longReasons.push('EMA多头排列');
    }

    // 2. RSI从超卖区回升
    if (prevRsi < p.rsi_oversold + 5 && rsi > p.rsi_oversold && rsi < 55) {
      longScore += 0.25;
      longReasons.push(`RSI回升(${rsi.toFixed(0)})`);
    }

    // 3. MACD金叉或柱线转正
    if (macdCross === 'golden') {
      longScore += 0.20;
      longReasons.push('MACD金叉');
    } else if (macdHistogram > 0) {
      longScore += 0.10;
      longReasons.push('MACD柱线>0');
    }

    // 4. 成交量确认
    if (volumeRatio > 1.3) {
      longScore += 0.10;
      longReasons.push(`放量(${volumeRatio.toFixed(1)}x)`);
    }

    // 5. 价格在支撑位附近(枢轴点S1/S2)
    if (price > pivots.s1 * 0.99 && price < pivots.s1 * 1.01) {
      longScore += 0.10;
      longReasons.push('接近S1支撑');
    }

    // ====== 做空信号评估 ======
    let shortScore = 0;
    const shortReasons: string[] = [];

    if (isDowntrend) {
      shortScore += 0.35;
      shortReasons.push('EMA空头排列');
    }

    if (prevRsi > p.rsi_overbought - 5 && rsi < p.rsi_overbought && rsi > 45) {
      shortScore += 0.25;
      shortReasons.push(`RSI回落(${rsi.toFixed(0)})`);
    }

    if (macdCross === 'death') {
      shortScore += 0.20;
      shortReasons.push('MACD死叉');
    } else if (macdHistogram < 0) {
      shortScore += 0.10;
      shortReasons.push('MACD柱线<0');
    }

    if (volumeRatio > 1.3) {
      shortScore += 0.10;
      shortReasons.push(`放量(${volumeRatio.toFixed(1)}x)`);
    }

    if (price > pivots.r1 * 0.99 && price < pivots.r1 * 1.01) {
      shortScore += 0.10;
      shortReasons.push('接近R1阻力');
    }

    // ====== 决策 ======
    const minScore = 0.45; // 至少两个条件满足
    let direction: Direction | null = null;
    let confidence = 0;
    let reasons: string[] = [];

    if (longScore >= minScore && longScore > shortScore) {
      direction = 'long';
      confidence = this.clamp(longScore, 0, 1);
      reasons = longReasons;
    } else if (shortScore >= minScore && shortScore > longScore) {
      direction = 'short';
      confidence = this.clamp(shortScore, 0, 1);
      reasons = shortReasons;
    }

    if (!direction || !atr || !price) {
      return {
        signal: null,
        detail: {
          direction: direction ?? 'long',
          confidence: confidence,
          reason: reasons.join(', ') || '无有效信号',
          indicators: {
            ema_fast: emaFast.toFixed(2),
            ema_medium: emaMedium.toFixed(2),
            ema_slow: emaSlow.toFixed(2),
            rsi: rsi.toFixed(1),
            macd_hist: macdHistogram.toFixed(4),
            atr: atr.toFixed(2),
            vol_ratio: volumeRatio.toFixed(2),
            trend: isUptrend ? 'bullish' : isDowntrend ? 'bearish' : 'neutral',
          },
        },
      };
    }

    // ====== 构建信号 ======
    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'long') {
      stopLoss = price - atr * p.atr_sl_multiplier;
      takeProfit = price + atr * p.atr_tp_multiplier;
    } else {
      stopLoss = price + atr * p.atr_sl_multiplier;
      takeProfit = price - atr * p.atr_tp_multiplier;
    }

    const signal = this.buildSignal(
      symbol,
      direction,
      confidence,
      price,
      stopLoss,
      takeProfit,
      timeframe,
      reasons.join(', '),
      3, // 趋势策略建议3倍杠杆
      input.marketContext.funding_rate,
    );

    const detail = this.buildDetail(direction, confidence, reasons.join(', '), {
      ema_fast: emaFast.toFixed(2),
      ema_medium: emaMedium.toFixed(2),
      rsi: rsi.toFixed(1),
      macd_cross: macdCross,
      atr: atr.toFixed(2),
      vol_ratio: volumeRatio.toFixed(2),
    });

    return { signal, detail };
  }
}
