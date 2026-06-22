// ============================================
// 本地定时运行入口
//
// 用法:
//   npx ts-node -T src/local-runner.ts
//
// 功能:
// - 自动加载 .env
// - 每 15 分钟执行一次信号检测
// - Ctrl+C 停止
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { loadEnv } from './services/env';
import { Runner } from './runner/index';

// 主循环
async function main() {
  loadEnv();

  const intervalMinutes = parseInt(process.env.LOCAL_INTERVAL_MIN ?? '15', 10);
  console.log('========================================');
  console.log('  加密信号本地定时运行');
  console.log('========================================');
  console.log(`  交易所:  ${process.env.EXCHANGE_PROVIDER ?? 'binance'}`);
  console.log(`  代理:    ${process.env.HTTPS_PROXY ?? '无 (直连)'}`);
  console.log(`  间隔:    每 ${intervalMinutes} 分钟`);
  console.log(`  接收邮箱: ${process.env.NOTIFICATION_EMAIL ?? '未设置'}`);
  console.log('========================================\n');

  const runner = new Runner();

  // 立即执行一次
  await runOnce(runner);

  // 定时循环
  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`\n[Scheduler] 下次检测: ${intervalMinutes} 分钟后 (Ctrl+C 停止)\n`);

  setInterval(async () => {
    await runOnce(runner);
    console.log(`\n[Scheduler] 下次检测: ${intervalMinutes} 分钟后\n`);
  }, intervalMs);
}

async function runOnce(runner: Runner) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`[${now}] 信号检测开始...`);

  try {
    const result = await runner.run();

    console.log(`  信号: ${result.signals_generated} | 通知: ${result.notifications_sent} | 错误: ${result.errors.length}`);

    // 打印每个币种的摘要
    for (const d of result.details) {
      if (d.final_signal) {
        const s = d.final_signal;
        const dir = s.direction === 'long' ? '做多' : '做空';
        console.log(`  >>> ${s.symbol} ${dir} @ ${s.entry_price.toFixed(2)} 置信度${(s.confidence * 100).toFixed(0)}%`);
      }
    }

    if (result.errors.length > 0) {
      result.errors.forEach(e => console.log(`  [ERR] ${e}`));
    }
  } catch (err: any) {
    console.error(`  [FATAL] ${err.message}`);
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n[SIGINT] 正在停止...');
  process.exit(0);
});

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
