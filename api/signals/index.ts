// ============================================
// API: /api/signals - 信号历史查询
//
// GET /api/signals          - 查询信号列表
// GET /api/signals?symbol=BTC/USDT&direction=long&limit=20
// ============================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDatabaseService } from '../../src/services/database';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getDatabaseService();

    const symbol = req.query.symbol as string | undefined;
    const direction = req.query.direction as string | undefined;
    const limit = parseInt(req.query.limit as string ?? '50', 10);
    const offset = parseInt(req.query.offset as string ?? '0', 10);
    const since = req.query.since as string | undefined;

    const result = await db.getSignals({
      symbol,
      direction,
      limit: Math.min(limit, 200),
      offset,
      since,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      total: result.total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[API] /signals error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
