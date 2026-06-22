// ============================================
// API: /api/cron - 定时信号检测入口
//
// 由 Vercel Cron 每15分钟自动调用
// 也可手动 GET /api/cron 触发
// ============================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Runner } from '../../src/runner/index';
import type { Timeframe } from '../../src/types';

const SUPPORTED_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h', '2h', '4h', '1d'];

function parseTimeframe(value: unknown): Timeframe | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return SUPPORTED_TIMEFRAMES.includes(value as Timeframe)
    ? value as Timeframe
    : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只接受 GET 请求
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 安全校验: CRON_SECRET 环境变量验证
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const providedSecret = req.headers['x-cron-secret'] as string
      ?? req.query.secret as string;
    if (providedSecret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log(`[Cron] Signal check started at ${new Date().toISOString()}`);

  try {
    const timeframeParam = req.query.timeframe;
    const requestedTimeframe = parseTimeframe(Array.isArray(timeframeParam) ? timeframeParam[0] : timeframeParam);
    if (timeframeParam && !requestedTimeframe) {
      return res.status(400).json({
        success: false,
        error: `Unsupported timeframe: ${Array.isArray(timeframeParam) ? timeframeParam[0] : timeframeParam}`,
        supported_timeframes: SUPPORTED_TIMEFRAMES,
        timestamp: new Date().toISOString(),
      });
    }

    const runner = new Runner();
    const result = await runner.run({ timeframe: requestedTimeframe });

    const statusCode = result.errors.length > 0 && result.signals_generated === 0
      ? 500
      : 200;

    return res.status(statusCode).json({
      success: result.errors.length === 0 || result.signals_generated > 0,
      timestamp: result.timestamp,
      requested_timeframe: requestedTimeframe ?? null,
      signals_generated: result.signals_generated,
      notifications_sent: result.notifications_sent,
      errors: result.errors,
      summary: result.details.map(d => ({
        symbol: d.symbol,
        timeframe: d.timeframe,
        has_signal: d.final_signal !== null,
        direction: d.final_signal?.direction ?? null,
        confidence: d.final_signal?.confidence ?? null,
        engines: Object.fromEntries(
          Object.entries(d.engine_results).map(([k, v]) => [
            k,
            v ? { direction: v.direction, confidence: v.confidence } : null,
          ])
        ),
      })),
    });
  } catch (error: any) {
    console.error('[Cron] Fatal error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
