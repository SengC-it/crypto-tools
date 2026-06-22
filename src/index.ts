// ============================================
// 本地开发入口 - 用于调试引擎逻辑
//
// 用法:
//   npx ts-node src/index.ts              # 完整 Runner 流程 (需要 Supabase)
//   npx ts-node src/index.ts --test-only  # 仅测试交易所数据+引擎 (无需 Supabase/Gmail)
// ============================================

import { loadEnv } from './services/env';
import { Runner } from './runner/index';
import { getExchangeService } from './services/exchange';
import { AggregatorEngine } from './engines/aggregator';
import type { StrategyConfig, Timeframe } from './types';

// 加载 .env (确保代理等环境变量在所有模式下均可用)
loadEnv();

const isTestOnly = process.argv.includes('--test-only');

async function testEnginesOnly() {
  console.log('=== 纯引擎测试模式 (无需 Supabase/Gmail) ===\n');

  const exchange = getExchangeService();
  const symbols = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT'];
  const timeframes: Timeframe[] = ['4h'];

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

  for (const symbol of symbols) {
    for (const tf of timeframes) {
      try {
        console.log(`\n--- ${symbol} @ ${tf} ---`);

        // 获取K线
        const candles = await exchange.fetchOHLCV(symbol, tf, 100);
        console.log(`  K线数量: ${candles.length}, 最新价: ${candles[candles.length - 1]?.close ?? 'N/A'}`);

        // 获取市场上下文
        const marketContext = await exchange.fetchMarketContext(symbol);
        console.log(`  资金费率: ${(marketContext.funding_rate * 100).toFixed(4)}%`);

        // 运行多引擎融合评估
        const result = await aggregator.evaluate(symbol, tf, candles, marketContext);

        // 打印各引擎结果
        for (const [name, detail] of Object.entries(result.allDetails)) {
          if (detail) {
            console.log(`  [${name}] 方向=${detail.direction} 置信度=${(detail.confidence * 100).toFixed(0)}% 原因=${detail.reason}`);
          } else {
            console.log(`  [${name}] 无结果`);
          }
        }

        // 打印融合信号
        if (result.finalSignal) {
          const s = result.finalSignal;
          console.log(`\n  *** 融合信号: ${s.direction.toUpperCase()} ${s.symbol} ***`);
          console.log(`  入场价: ${s.entry_price}`);
          console.log(`  止损:   ${s.stop_loss} (${((Math.abs(s.entry_price - s.stop_loss) / s.entry_price) * 100).toFixed(1)}%)`);
          console.log(`  止盈:   ${s.take_profit} (${((Math.abs(s.take_profit - s.entry_price) / s.entry_price) * 100).toFixed(1)}%)`);
          console.log(`  置信度: ${(s.confidence * 100).toFixed(0)}%`);
          console.log(`  杠杆:   ${s.leverage}x`);
          console.log(`  引擎数: ${s.engine_count}`);
          console.log(`  原因:   ${s.reason}`);
        } else {
          console.log(`\n  === 无融合信号 (未达阈值) ===`);
        }
      } catch (err: any) {
        console.error(`  错误: ${err.message}`);
      }
    }
  }

  console.log('\n=== 测试完成 ===');
}

async function runFull() {
  console.log('=== 完整 Runner 流程 ===\n');
  const runner = new Runner();
  const result = await runner.run();

  console.log(`\n--- 运行结果 ---`);
  console.log(`信号数: ${result.signals_generated}`);
  console.log(`通知数: ${result.notifications_sent}`);
  if (result.errors.length > 0) {
    console.log(`错误:`);
    result.errors.forEach(e => console.log(`  - ${e}`));
  }
}

// 主入口
(async () => {
  try {
    if (isTestOnly) {
      await testEnginesOnly();
    } else {
      await runFull();
    }
  } catch (err: any) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
  process.exit(0);
})();
