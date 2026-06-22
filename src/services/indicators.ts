// ============================================
// Technical Indicators Service
// 基于 technicalindicators 包的技术指标计算
// ============================================

import * as ti from 'technicalindicators';
import type { Candle } from '../types';

/** 指标计算结果集合 */
export interface IndicatorSet {
  ema: {
    fast: number[];   // EMA 8
    medium: number[];  // EMA 21
    slow: number[];    // EMA 55
  };
  rsi: number[];
  macd: {
    macd: number[];
    signal: number[];
    histogram: number[];
  };
  bollingerBands: {
    upper: number[];
    middle: number[];
    lower: number[];
  };
  atr: number[];
  adx: number[];      // V5: ADX (Average Directional Index)
  plusDi: number[];   // V5: +DI
  minusDi: number[];  // V5: -DI
  stochastic: {
    k: number[];
    d: number[];
  };
  volume: {
    sma: number[];
    current: number;
    ratio: number; // 当前成交量 / SMA成交量
  };
}

/** 支撑/阻力位(基于枢轴点) */
export interface PivotLevels {
  pp: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
}

export class IndicatorsService {
  /** 计算全部常用指标 */
  static calculate(candles: Candle[]): IndicatorSet {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // EMA
    const emaFast = ti.EMA.calculate({ values: closes, period: 8 });
    const emaMedium = ti.EMA.calculate({ values: closes, period: 21 });
    const emaSlow = ti.EMA.calculate({ values: closes, period: 55 });

    // RSI
    const rsi = ti.RSI.calculate({ values: closes, period: 14 });

    // MACD
    const macdResult = ti.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    // Bollinger Bands
    const bbResult = ti.BollingerBands.calculate({
      values: closes,
      period: 20,
      stdDev: 2,
    });

    // ATR
    const atr = ti.ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
    });

    // ADX (V5: 手动计算, technicalindicators不内置)
    const adxResult = IndicatorsService.calculateADX(highs, lows, closes, 14);

    // Stochastic
    const stochResult = ti.Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: 14,
      signalPeriod: 3,
    });

    // 成交量 SMA (SMA.calculate 直接返回 number[])
    const volumeSma = ti.SMA.calculate({ values: volumes, period: 20 }) as number[];
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumeSma[volumeSma.length - 1] ?? 1;

    return {
      ema: {
        // EMA.calculate 直接返回 number[] (technicalindicators v3)
        fast: emaFast as number[],
        medium: emaMedium as number[],
        slow: emaSlow as number[],
      },
      // RSI.calculate 直接返回 number[]
      rsi: rsi as number[],
      macd: {
        macd: macdResult.map(v => v.MACD ?? 0),
        signal: macdResult.map(v => v.signal ?? 0),
        histogram: macdResult.map(v => v.histogram ?? 0),
      },
      bollingerBands: {
        upper: bbResult.map(v => v.upper ?? 0),
        middle: bbResult.map(v => v.middle ?? 0),
        lower: bbResult.map(v => v.lower ?? 0),
      },
      // ATR.calculate 直接返回 number[]
      atr: atr as number[],
      // V5: ADX计算结果
      adx: adxResult.adx,
      plusDi: adxResult.plusDi,
      minusDi: adxResult.minusDi,
      stochastic: {
        k: stochResult.map(v => v.k ?? 0),
        d: stochResult.map(v => v.d ?? 0),
      },
      volume: {
        sma: volumeSma,
        current: currentVolume,
        ratio: currentVolume / avgVolume,
      },
    };
  }

  /** 计算枢轴点(支撑/阻力) */
  static pivotPoints(candles: Candle[]): PivotLevels {
    // 使用前一天的数据
    const prevCandle = candles[candles.length - 2] ?? candles[candles.length - 1];
    const h = prevCandle.high;
    const l = prevCandle.low;
    const c = prevCandle.close;

    const pp = (h + l + c) / 3;
    return {
      pp,
      r1: 2 * pp - l,
      s1: 2 * pp - h,
      r2: pp + (h - l),
      s2: pp - (h - l),
      r3: h + 2 * (pp - l),
      s3: l - 2 * (h - pp),
    };
  }

  /** 获取最新指标值(便捷方法) */
  static latest(candles: Candle[]): {
    indicators: IndicatorSet;
    pivots: PivotLevels;
    price: number;
  } {
    const indicators = IndicatorsService.calculate(candles);
    const pivots = IndicatorsService.pivotPoints(candles);
    const price = candles[candles.length - 1]?.close ?? 0;

    return { indicators, pivots, price };
  }

  /** 安全获取数组最后一个元素 */
  static lastValue(arr: number[], fallback: number = 0): number {
    return arr.length > 0 ? arr[arr.length - 1] : fallback;
  }

  /** 安全获取数组倒数第N个元素 */
  static nthLast(arr: number[], n: number, fallback: number = 0): number {
    return arr.length >= n ? arr[arr.length - n] : fallback;
  }

  /** 
   * 计算ADX (Average Directional Index) - V5新增
   * 
   * ADX衡量趋势强度, 不区分方向:
   *   ADX > 25: 强趋势
   *   ADX 20-25: 中等趋势
   *   ADX < 20: 震荡/无趋势 (应避免交易)
   */
  static calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14,
  ): { adx: number[]; plusDi: number[]; minusDi: number[] } {
    if (highs.length < period * 2) {
      return { adx: [], plusDi: [], minusDi: [] };
    }

    // Step 1: 计算 True Range 和 Directional Movement
    const trList: number[] = [];
    const plusDMList: number[] = [];
    const minusDMList: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const hDiff = highs[i] - highs[i - 1];
      const lDiff = lows[i - 1] - lows[i];

      const plusDM = hDiff > lDiff && hDiff > 0 ? hDiff : 0;
      const minusDM = lDiff > hDiff && lDiff > 0 ? lDiff : 0;

      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );

      trList.push(tr);
      plusDMList.push(plusDM);
      minusDMList.push(minusDM);
    }

    // Step 2: Wilder平滑 (首期用SMA, 之后用EMA: prev * (period-1)/period + curr * 1/period)
    function wilderSmooth(data: number[], p: number): number[] {
      const result: number[] = [];
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        if (i < p) {
          sum += data[i];
          if (i === p - 1) result.push(sum);
        } else {
          const smoothed = result[result.length - 1] * (p - 1) / p + data[i];
          result.push(smoothed);
        }
      }
      return result;
    }

    const smoothTR = wilderSmooth(trList, period);
    const smoothPlusDM = wilderSmooth(plusDMList, period);
    const smoothMinusDM = wilderSmooth(minusDMList, period);

    // Step 3: 计算 +DI 和 -DI
    const plusDi: number[] = [];
    const minusDi: number[] = [];
    const dx: number[] = [];

    for (let i = 0; i < smoothTR.length; i++) {
      const pdi = smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0;
      const mdi = smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0;

      plusDi.push(pdi);
      minusDi.push(mdi);

      const diSum = pdi + mdi;
      const dxVal = diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0;
      dx.push(dxVal);
    }

    // Step 4: ADX = Wilder平滑的DX
    const adx: number[] = [];
    if (dx.length >= period) {
      let adxSum = 0;
      for (let i = 0; i < period; i++) {
        adxSum += dx[i];
      }
      adx.push(adxSum / period);

      for (let i = period; i < dx.length; i++) {
        const adxVal = (adx[adx.length - 1] * (period - 1) + dx[i]) / period;
        adx.push(adxVal);
      }
    }

    return { adx, plusDi, minusDi };
  }

  /** 检测金叉/死叉 */
  static detectCross(fast: number[], slow: number[]): 'golden' | 'death' | 'none' {
    if (fast.length < 2 || slow.length < 2) return 'none';

    const currentFast = fast[fast.length - 1];
    const prevFast = fast[fast.length - 2];
    const currentSlow = slow[slow.length - 1];
    const prevSlow = slow[slow.length - 2];

    if (prevFast <= prevSlow && currentFast > currentSlow) return 'golden';
    if (prevFast >= prevSlow && currentFast < currentSlow) return 'death';
    return 'none';
  }

  /** MACD金叉/死叉检测 */
  static detectMACDCross(histogram: number[]): 'golden' | 'death' | 'none' {
    if (histogram.length < 2) return 'none';
    const curr = histogram[histogram.length - 1];
    const prev = histogram[histogram.length - 2];
    if (prev <= 0 && curr > 0) return 'golden';
    if (prev >= 0 && curr < 0) return 'death';
    return 'none';
  }
}
