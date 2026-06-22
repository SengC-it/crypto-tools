// ============================================
// API: /api/test-notification - protected mock email notification
// ============================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function buildMockEmailHtml(): string {
  const signal = {
    symbol: 'BTC/USDT',
    timeframe: '4h',
    confidence: 55,
    entry: 64206.8,
    stopLoss: 62280.6,
    takeProfit: 74480.0,
    leverage: 3,
    fundingRate: '0.0016%',
  };

  return `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;max-width:640px;margin:0 auto;background:#111827;color:#e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#92400e;padding:14px 22px;text-align:center;font-weight:700;">
        模拟测试邮件 - 不是真实交易信号
      </div>
      <div style="background:#14532d;padding:24px;text-align:center;">
        <h1 style="margin:0;font-size:28px;">做多 ${signal.symbol}</h1>
        <p style="margin:8px 0 0;color:#bbf7d0;">${signal.timeframe} 时间框架 | V5 Trend-Only</p>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:15px;">
          <tr><td style="padding:8px;color:#9ca3af;">置信度</td><td style="padding:8px;text-align:right;color:#fde68a;font-size:20px;font-weight:700;">${signal.confidence}%</td></tr>
          <tr><td style="padding:8px;color:#9ca3af;">入场价</td><td style="padding:8px;text-align:right;color:#67e8f9;font-weight:700;">${formatPrice(signal.entry)}</td></tr>
          <tr><td style="padding:8px;color:#9ca3af;">止损</td><td style="padding:8px;text-align:right;color:#fca5a5;">${formatPrice(signal.stopLoss)}</td></tr>
          <tr><td style="padding:8px;color:#9ca3af;">止盈</td><td style="padding:8px;text-align:right;color:#86efac;">${formatPrice(signal.takeProfit)}</td></tr>
          <tr><td style="padding:8px;color:#9ca3af;">建议杠杆</td><td style="padding:8px;text-align:right;">${signal.leverage}x</td></tr>
          <tr><td style="padding:8px;color:#9ca3af;">资金费率</td><td style="padding:8px;text-align:right;">${signal.fundingRate}</td></tr>
        </table>
        <div style="margin-top:18px;padding:16px;background:#1f2937;border-radius:8px;border-left:4px solid #f59e0b;">
          <strong>信号原因</strong>
          <p style="margin:8px 0 0;line-height:1.6;">模拟测试邮件：V5 Trend-Only + ADX 过滤 + 移动止损格式预览。不是实盘信号。</p>
        </div>
        <div style="margin-top:18px;padding:16px;background:#1f2937;border-radius:8px;">
          <strong>需要你重点看</strong>
          <ul style="line-height:1.8;margin-bottom:0;">
            <li>主题是否醒目，是否容易和真实信号区分</li>
            <li>入场/止损/止盈/杠杆是否足够清楚</li>
            <li>是否还要加入 ADX、移动止损、当前价格、下一根K线收盘时间</li>
          </ul>
        </div>
        <p style="margin-top:20px;color:#6b7280;font-size:12px;text-align:center;">发送时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
      </div>
    </div>
  `;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const providedSecret = req.headers['x-cron-secret'] as string
      ?? req.query.secret as string;
    if (providedSecret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFICATION_EMAIL || user;

  if (!user || !pass || !to) {
    return res.status(500).json({
      success: false,
      error: 'Missing GMAIL_USER, GMAIL_APP_PASSWORD, or NOTIFICATION_EMAIL',
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { type: 'login', user, pass },
    });

    await transporter.verify();
    const result = await transporter.sendMail({
      from: `"Crypto Tools" <${user}>`,
      to,
      subject: '[模拟测试] BTC/USDT 4H 做多信号邮件格式预览 - 非实盘',
      html: buildMockEmailHtml(),
    });

    return res.status(200).json({
      success: true,
      to,
      message_id: result.messageId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
