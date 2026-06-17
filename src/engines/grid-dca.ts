// ============================================
// 网格/DCA引擎 (OctoBot 风格)
//
// 核心逻辑:
// - 利用布林带判断价格位置(超买/超卖)
// - 结合枢轴点支撑/阻力位
// - 在关键支撑位附近发出DCA分批建仓信号
// - 在关键阻力位附近发出分批减仓信号
//
// 参考: OctoBot 的 Grid 和 DCA 策略
// ============================================

import { BaseEngine, type EngineInput, type EngineOutput } from './base';
import { IndicatorsService } from '../services/indicators';
import type { GridDCAParams, Direction } from '../types';

export class GridDCAEngine extends BaseEngine {
  readonly name = 'grid_dca';
  readonly description = '网格/DCA引擎 (布林带+支阻位+分批建仓)';

  async evaluate(input: EngineInput): Promise<EngineOutput> {
    const { symbol, timeframe, candles, params: rawParams } = input;

    if (candles.length < 30) {
      return { signal: null, detail: null };
    }

    // 合并默认参数
    const p: GridDCAParams = {
      bb_period: 20,
      bb_std: 2.0,
      dca_levels: 3,
      grid_spacing_pct: 2.0,
      ...rawParams,
    };

    const { indicators, pivots, price } = IndicatorsService.latest(candles);
    const last = IndicatorsService.lastValue.bind(IndicatorsService);

    const bbUpper = last(indicators.bollingerBands.upper);
    const bbMiddle = last(indicators.bollingerBands.middle);
    const bbLower = last(indicators.bollingerBands.lower);
    const rsi = last(indicators.rsi);
    const atr = last(indicators.atr);
    const stochK = last(indicators.stochastic.k);
    const stochD = last(indicators.stochastic.d);

    // ====== 计算价格在布林带中的位置 ======
    const bbWidth = bbUpper - bbLower;
    let bbPosition = 0.5; // 0=下轨, 0.5=中轨, 1=上轨
    if (bbWidth > 0) {
      bbPosition = (price - bbLower) / bbWidth;
    }

    // ====== 支撑/阻力接近度检测 ======
    const supportLevels = [pivots.s1, pivots.s2, pivots.s3];
    const resistanceLevels = [pivots.r1, pivots.r2, pivots.r3];

    const nearestSupport = this.findNearestLevel(price, supportLevels, 'below');
    const nearestResistance = this.findNearestLevel(price, resistanceLevels, 'above');

    const supportProximity = nearestSupport
      ? (price - nearestSupport) / price * 100 // 距离支撑的百分比
      : 999;
    const resistanceProximity = nearestResistance
      ? (nearestResistance - price) / price * 100
      : 999;

    // ====== 做多信号评估 ======
    let longScore = 0;
    const longReasons: string[] = [];

    // 1. 价格触及或跌破布林带下轨
    if (bbPosition <= 0.05) {
      longScore += 0.30;
      longReasons.push('触及BB下轨');
    } else if (bbPosition <= 0.15) {
      longScore += 0.15;
      longReasons.push('接近BB下轨');
    }

    // 2. 价格接近支撑位
    if (supportProximity <= 0.5) {
      longScore += 0.25;
      longReasons.push(`接近支撑(${nearestSupport?.toFixed(2)})`);
    } else if (supportProximity <= 1.5) {
      longScore += 0.10;
      longReasons.push('支撑附近');
    }

    // 3. RSI超卖 + Stochastic超卖(双重确认)
    if (rsi < 30 && stochK < 20) {
      longScore += 0.25;
      longReasons.push(`RSI+Stoch超卖(${rsi.toFixed(0)}/${stochK.toFixed(0)})`);
    } else if (rsi < 35) {
      longScore += 0.10;
      longReasons.push(`RSI偏低(${rsi.toFixed(0)})`);
    }

    // 4. 价格在中轨以下(整体偏低)
    if (bbPosition < 0.3) {
      longScore += 0.10;
      longReasons.push('价格在BB下半区');
    }

    // ====== 做空信号评估 ======
    let shortScore = 0;
    const shortReasons: string[] = [];

    if (bbPosition >= 0.95) {
      shortScore += 0.30;
      shortReasons.push('触及BB上轨');
    } else if (bbPosition >= 0.85) {
      shortScore += 0.15;
      shortReasons.push('接近BB上轨');
    }

    if (resistanceProximity <= 0.5) {
      shortScore += 0.25;
      shortReasons.push(`接近阻力(${nearestResistance?.toFixed(2)})`);
    } else if (resistanceProximity <= 1.5) {
      shortScore += 0.10;
      shortReasons.push('阻力附近');
    }

    if (rsi > 70 && stochK > 80) {
      shortScore += 0.25;
      shortReasons.push(`RSI+Stoch超买(${rsi.toFixed(0)}/${stochK.toFixed(0)})`);
    } else if (rsi > 65) {
      shortScore += 0.10;
      shortReasons.push(`RSI偏高(${rsi.toFixed(0)})`);
    }

    if (bbPosition > 0.7) {
      shortScore += 0.10;
      shortReasons.push('价格在BB上半区');
    }

    // ====== 决策 ======
    const minScore = 0.45;
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
          reason: reasons.join(', ') || '未到网格触发点',
          indicators: {
            bb_position: (bbPosition * 100).toFixed(1) + '%',
            rsi: rsi.toFixed(1),
            stoch_k: stochK.toFixed(1),
            nearest_support: nearestSupport?.toFixed(2) ?? 'N/A',
            nearest_resistance: nearestResistance?.toFixed(2) ?? 'N/A',
          },
        },
      };
    }

    // ====== 构建信号 ======
    // DCA策略: 计算分批建仓点位
    const gridSpacing = price * p.grid_spacing_pct / 100;
    let stopLoss: number;
    let takeProfit: number;
    let dcaPoints: number[] = [];

    if (direction === 'long') {
      // 止损设在支撑位下方
      stopLoss = (nearestSupport ?? price - atr * 2) - atr * 0.5;
      // 止盈回到布林带中轨
      takeProfit = bbMiddle;
      // DCA分批点位(价格越低越买)
      for (let i = 1; i <= p.dca_levels; i++) {
        dcaPoints.push(price - gridSpacing * i);
      }
    } else {
      stopLoss = (nearestResistance ?? price + atr * 2) + atr * 0.5;
      takeProfit = bbMiddle;
      for (let i = 1; i <= p.dca_levels; i++) {
        dcaPoints.push(price + gridSpacing * i);
      }
    }

    const reasonText = reasons.join(', ')
      + (dcaPoints.length > 0 ? ` | DCA点位: ${dcaPoints.map(p => this.formatPrice(p)).join('/')}` : '');

    const signal = this.buildSignal(
      symbol,
      direction,
      confidence,
      price,
      stopLoss,
      takeProfit,
      timeframe,
      reasonText,
      2, // 网格策略低杠杆
      input.marketContext.funding_rate,
    );

    const detail = this.buildDetail(direction, confidence, reasons.join(', '), {
      bb_position: (bbPosition * 100).toFixed(1) + '%',
      rsi: rsi.toFixed(1),
      stoch_k: stochK.toFixed(1),
      support: nearestSupport?.toFixed(2) ?? 'N/A',
      resistance: nearestResistance?.toFixed(2) ?? 'N/A',
      dca_levels: p.dca_levels,
    });

    return { signal, detail };
  }

  /** 找最近的一个支撑/阻力位 */
  private findNearestLevel(
    price: number,
    levels: number[],
    direction: 'above' | 'below'
  ): number | null {
    const filtered = levels.filter(l =>
      direction === 'below' ? l < price : l > price
    );
    if (filtered.length === 0) return null;
    return filtered.reduce((nearest, level) => {
      const dist = Math.abs(price - level);
      const nearestDist = Math.abs(price - nearest);
      return dist < nearestDist ? level : nearest;
    });
  }

  private formatPrice(price: number): string {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }
}
