// ============================================
// API: /api/exchange-health - Binance Futures connectivity diagnostics
// ============================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBinanceService } from '../src/services/binance-api';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTC/USDT';

  try {
    const diagnostics = await getBinanceService().diagnoseConnectivity(symbol);
    return res.status(diagnostics.ok ? 200 : 502).json({
      success: diagnostics.ok,
      data: diagnostics,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
