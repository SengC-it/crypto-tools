// ============================================
// 模拟数据端到端测试 - 无需网络连接
//
// 验证: 指标计算 → 引擎评估 → 多引擎融合 → 信号生成
//
// 用法: npx ts-node -T src/test-mock.ts
// ============================================

import { IndicatorsService } from './services/indicators';
import { AggregatorEngine } from './engines/aggregator';
import type { Candle, StrategyConfig, MarketContext, Timeframe } from './types';

// ====== 生成模拟K线数据 (更真实的价格走势) ======
// 添加均值回归机制，限制单根K线变化幅度，防止 RSI 极值 (0.0 / 100.0)
function generateMockCandles(
  basePrice: number,
  count: number,
  trend: 'up' | 'down' | 'range'
): Candle[] {
  const candles: Candle[] = [];
  let price = basePrice;
  const now = Date.now();
  const interval = 15 * 60 * 1000; // 15分钟

  // 均值回归参数
  const meanReversionStrength = 0.003; // 向基准价回归的力度
  const maxSingleChange = 0.008; // 单根K线最大变化 ±0.8%
  const driftPerCandle = trend === 'up' ? 0.0008 : trend === 'down' ? -0.0008 : 0;

  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * interval;

    // 趋势偏移 + 随机噪声 + 均值回归
    const noise = (Math.random() - 0.5) * 0.004; // ±0.2% 随机波动
    const deviation = (price - basePrice) / basePrice;
    const meanReversion = -deviation * meanReversionStrength * (trend === 'range' ? 3 : 1);
    let change = driftPerCandle + noise + meanReversion;

    // 限制单根K线变化幅度
    change = Math.max(-maxSingleChange, Math.min(maxSingleChange, change));

    const open = price;
    const close = price * (1 + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.003);
    const low = Math.min(open, close) * (1 - Math.random() * 0.003);
    const volume = 10000 + Math.random() * 50000;

    candles.push({ timestamp, open, high, low, close, volume });
    price = close;

    // 均值回归重置：价格偏离基准超过5%时，向基准方向修正
    if (Math.abs(price - basePrice) / basePrice > 0.05) {
      price = price * 0.95 + basePrice * 0.05;
    }
  }

  return candles;
}

// ====== 主测试 ======
async function runTest() {
  console.log('========================================');
  console.log('  模拟数据端到端测试');
  console.log('========================================\n');

  // V5策略配置 (Trend-Only + TP16 + ADX + 移动止损)
  const strategyConfigs: StrategyConfig[] = [
    {
      engine_type: 'trend',
      enabled: true,
      weight: 1.0,
      params: {
        ema_fast: 8, ema_medium: 21, ema_slow: 55,
        rsi_period: 14, rsi_oversold: 30, rsi_overbought: 70,
        atr_period: 14, atr_sl_multiplier: 3.0, atr_tp_multiplier: 16.0,
        adx_period: 14, adx_threshold: 20,
        trailing_activation_pct: 1.5, trailing_callback_pct: 1.0,
      },
    },
  ];

  const aggregator = new AggregatorEngine(strategyConfigs);

  // 测试场景
  const scenarios = [
    { name: 'BTC强上升趋势+负资金费率', symbol: 'BTC/USDT', price: 65000, trend: 'up' as const, fundingRate: -0.0008 },
    { name: 'ETH强下降趋势+正资金费率', symbol: 'ETH/USDT', price: 3200, trend: 'down' as const, fundingRate: 0.001 },
    { name: 'SOL震荡', symbol: 'SOL/USDT', price: 145, trend: 'range' as const, fundingRate: 0.0001 },
  ];

  let totalSignals = 0;
  let totalNoSignal = 0;

  for (const scenario of scenarios) {
    console.log(`\n--- 场景: ${scenario.name} (${scenario.trend}) ---`);

    const candles = generateMockCandles(scenario.price, 100, scenario.trend);
    console.log(`  K线: ${candles.length}根, 最新价: ${candles[candles.length - 1].close.toFixed(2)}`);

    // 指标计算验证
    try {
      const { indicators, pivots, price } = IndicatorsService.latest(candles);
      const last = IndicatorsService.lastValue.bind(IndicatorsService);
      console.log(`  指标: EMA快=${last(indicators.ema.fast).toFixed(2)} RSI=${last(indicators.rsi).toFixed(1)} ATR=${last(indicators.atr).toFixed(2)}`);
      console.log(`  枢轴: PP=${pivots.pp.toFixed(2)} S1=${pivots.s1.toFixed(2)} R1=${pivots.r1.toFixed(2)}`);
    } catch (err: any) {
      console.error(`  指标计算失败: ${err.message}`);
      continue;
    }

    // 市场上下文
    const marketContext: MarketContext = {
      funding_rate: scenario.fundingRate,
    };

    // 多引擎融合评估
    try {
      const result = await aggregator.evaluate(
        scenario.symbol,
        '4h' as Timeframe,
        candles,
        marketContext,
      );

      // 打印各引擎结果
      for (const [name, detail] of Object.entries(result.allDetails)) {
        if (detail) {
          console.log(`  [${name}] 方向=${detail.direction} 置信度=${(detail.confidence * 100).toFixed(0)}% 原因=${detail.reason}`);
        }
      }

      if (result.finalSignal) {
        const s = result.finalSignal;
        console.log(`\n  >>> 融合信号: ${s.direction.toUpperCase()} ${s.symbol} <<<`);
        console.log(`      入场: ${s.entry_price.toFixed(2)}`);
        console.log(`      止损: ${s.stop_loss.toFixed(2)}`);
        console.log(`      止盈: ${s.take_profit.toFixed(2)}`);
        console.log(`      置信度: ${(s.confidence * 100).toFixed(0)}%`);
        console.log(`      杠杆: ${s.leverage}x`);
        console.log(`      引擎数: ${s.engine_count}`);
        console.log(`      原因: ${s.reason}`);
        totalSignals++;
      } else {
        console.log(`\n  === 无融合信号 ===`);
        totalNoSignal++;
      }
    } catch (err: any) {
      console.error(`  引擎评估失败: ${err.message}`);
    }
  }

  // ====== 验证结果 ======
  console.log('\n========================================');
  console.log('  测试总结');
  console.log('========================================');
  console.log(`  生成信号: ${totalSignals}`);
  console.log(`  无信号:   ${totalNoSignal}`);
  console.log(`  总场景:   ${totalSignals + totalNoSignal}`);

  if (totalSignals + totalNoSignal === scenarios.length) {
    console.log('\n  ★ 所有场景测试通过 - 引擎流水线正常工作');
  } else {
    console.log('\n  ✗ 部分场景出现异常');
  }
}

// 运行
(async () => {
  try {
    await runTest();
  } catch (err: any) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
