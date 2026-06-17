// ============================================
// API: /api/config - 策略配置与监控列表管理
//
// GET    /api/config           - 获取所有配置
// GET    /api/config?type=watchlist   - 获取监控列表
// GET    /api/config?type=strategies  - 获取策略配置
// POST   /api/config/watchlist - 添加监控项
// DELETE /api/config/watchlist?id=xxx - 删除监控项
// PATCH  /api/config/strategy  - 更新策略配置
// GET    /api/config?type=health - 健康检查
// ============================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDatabaseService } from '../../src/services/database';
import { Runner } from '../../src/runner/index';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const db = getDatabaseService();

    // ===== GET: 查询配置 =====
    if (req.method === 'GET') {
      const type = req.query.type as string;

      if (type === 'watchlist') {
        const data = await db.getWatchlist();
        return res.status(200).json({ success: true, data });
      }

      if (type === 'strategies') {
        const data = await db.getStrategyConfigs();
        return res.status(200).json({ success: true, data });
      }

      if (type === 'health') {
        const runner = new Runner();
        const health = await runner.healthCheck();
        return res.status(200).json({ success: true, data: health });
      }

      // 默认: 返回全部
      const [watchlist, strategies, todayCount] = await Promise.all([
        db.getWatchlist(),
        db.getStrategyConfigs(),
        db.getTodaySignalCount(),
      ]);

      return res.status(200).json({
        success: true,
        data: { watchlist, strategies, today_signal_count: todayCount },
      });
    }

    // ===== POST: 添加监控项 =====
    if (req.method === 'POST') {
      const { action } = req.body;

      if (action === 'add_watchlist') {
        const { symbol, timeframe } = req.body;
        if (!symbol) {
          return res.status(400).json({ error: 'Missing symbol' });
        }
        const item = await db.addToWatchlist({
          symbol: symbol.toUpperCase(),
          timeframe: timeframe || '15m',
          enabled: true,
        });
        return res.status(201).json({ success: true, data: item });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // ===== DELETE: 删除监控项 =====
    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) {
        return res.status(400).json({ error: 'Missing id' });
      }
      await db.removeFromWatchlist(id);
      return res.status(200).json({ success: true });
    }

    // ===== PATCH: 更新策略配置 =====
    if (req.method === 'PATCH') {
      const { engine_type, enabled, params, weight } = req.body;
      if (!engine_type) {
        return res.status(400).json({ error: 'Missing engine_type' });
      }

      const updates: Record<string, any> = {};
      if (enabled !== undefined) updates.enabled = enabled;
      if (params !== undefined) updates.params = params;
      if (weight !== undefined) updates.weight = weight;

      const updated = await db.updateStrategyConfig(engine_type, updates);
      return res.status(200).json({ success: true, data: updated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('[API] /config error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
