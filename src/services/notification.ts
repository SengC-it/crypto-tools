// ============================================
// Notification Service - Gmail 邮件推送
//
// 支持 SOCKS5 代理 (SMTP_PROXY / HTTPS_PROXY)
// 在国内环境中 Gmail SMTP 端口 465 被 GFW 阻断,
// 可通过 SMTP_PROXY=socks5://127.0.0.1:10808 走代理
// ============================================

import nodemailer from 'nodemailer';
import type { Signal } from '../types';

// socks-proxy-agent 懒加载，仅在需要代理时引入（Vercel 不需要）
let SocksProxyAgent: any = null;

/** 从 SMTP_PROXY 或 HTTPS_PROXY 推导 SOCKS5 代理 URL */
function resolveSmtpProxy(): string | null {
  // 1. 优先使用 SMTP_PROXY
  const smtpProxy = process.env.SMTP_PROXY;
  if (smtpProxy) return smtpProxy;

  // 2. 从 HTTPS_PROXY 推导 (socks5 → 直接用, http → 尝试转换为同端口 socks5)
  const httpsProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!httpsProxy) return null;

  // 已经是 socks5 协议直接用
  if (httpsProxy.startsWith('socks5://') || httpsProxy.startsWith('socks5h://')) {
    return httpsProxy;
  }

  // http/https 代理无法直接用于 SMTP, 提示用户配置 SMTP_PROXY
  console.warn('[Notification] HTTPS_PROXY is HTTP protocol, cannot use for SMTP. Please set SMTP_PROXY=socks5://host:port');
  return null;
}

export class NotificationService {
  private transporter: nodemailer.Transporter;
  private fromEmail: string;
  private toEmail: string;

  constructor() {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    this.toEmail = process.env.NOTIFICATION_EMAIL || user || '';

    if (!user || !pass) {
      throw new Error('Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variables');
    }

    this.fromEmail = user;

    // 检测是否需要代理
    const proxyUrl = resolveSmtpProxy();
    let transportOptions: any = {
      service: 'gmail',
      auth: {
        type: 'login',
        user,
        pass,
      },
    };

    if (proxyUrl) {
      try {
        // 懒加载 socks-proxy-agent（仅在有代理时）
        if (!SocksProxyAgent) {
          try { SocksProxyAgent = require('socks-proxy-agent').SocksProxyAgent; } catch {}
        }
        if (!SocksProxyAgent) throw new Error('socks-proxy-agent not available');
        const agent = new SocksProxyAgent(proxyUrl);
        transportOptions = {
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            type: 'login',
            user,
            pass,
          },
          agent, // nodemailer 支持 agent 选项用于底层连接
        };
        console.log(`[Notification] Using SOCKS5 proxy: ${proxyUrl.replace(/\/\/[^@]+@/, '//***@')}`);
      } catch (err: any) {
        console.error(`[Notification] Failed to create SOCKS5 proxy agent: ${err.message}`);
        // 降级到直连
      }
    }

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  /** 发送交易信号邮件 */
  async sendSignalEmail(signal: Signal): Promise<boolean> {
    const directionEmoji = signal.direction === 'long' ? '🟢' : '🔴';
    const directionText = signal.direction === 'long' ? '做多' : '做空';

    const confidencePct = (signal.confidence * 100).toFixed(0);
    const slPct = this.calcPct(signal.entry_price, signal.stop_loss, signal.direction);
    const tpPct = this.calcPct(signal.entry_price, signal.take_profit, signal.direction);
    const rrRatio = (tpPct / slPct).toFixed(1);

    const fundingRateStr = signal.funding_rate !== undefined
      ? `${(signal.funding_rate * 100).toFixed(4)}%`
      : 'N/A';

    // 各引擎详情
    const engineLines = Object.entries(signal.engine_details)
      .map(([name, detail]) => {
        const emoji = detail.direction === signal.direction ? '✓' : '✗';
        return `${emoji} ${name}: ${detail.direction === 'long' ? '看多' : '看空'} (${(detail.confidence * 100).toFixed(0)}%) — ${detail.reason}`;
      })
      .join('\n');

    const subject = `${directionEmoji} [${directionText}信号] ${signal.symbol} | 置信度 ${confidencePct}% | ${signal.engine_count}引擎共识`;

    const html = `
      <div style="font-family: 'SF Mono', 'Consolas', monospace; max-width: 600px; margin: 0 auto; background: #1a1a2e; color: #e0e0e0; border-radius: 12px; overflow: hidden;">
        <div style="background: ${signal.direction === 'long' ? '#1b4332' : '#641220'}; padding: 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px;">${directionEmoji} ${directionText} ${signal.symbol}</h1>
          <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">${signal.timeframe} 时间框架</p>
        </div>

        <div style="padding: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
            <tr>
              <td style="padding: 8px 0; color: #aaa;">置信度</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; font-size: 20px; color: ${signal.confidence >= 0.8 ? '#00ff88' : signal.confidence >= 0.6 ? '#ffdd57' : '#ff6b6b'};">${confidencePct}%</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">引擎共识</td>
              <td style="padding: 8px 0; text-align: right;">${signal.engine_count} 个引擎确认</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">入场价</td>
              <td style="padding: 8px 0; text-align: right; color: #00ddff; font-weight: bold;">${this.formatPrice(signal.entry_price)}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">止损</td>
              <td style="padding: 8px 0; text-align: right; color: #ff6b6b;">${this.formatPrice(signal.stop_loss)} (${slPct.toFixed(1)}%)</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">止盈</td>
              <td style="padding: 8px 0; text-align: right; color: #00ff88;">${this.formatPrice(signal.take_profit)} (${tpPct.toFixed(1)}%)</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">盈亏比</td>
              <td style="padding: 8px 0; text-align: right; font-weight: bold; color: ${parseFloat(rrRatio) >= 2 ? '#00ff88' : '#ffdd57'};">1:${rrRatio}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">建议杠杆</td>
              <td style="padding: 8px 0; text-align: right;">${signal.leverage}x</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #aaa;">资金费率</td>
              <td style="padding: 8px 0; text-align: right;">${fundingRateStr}</td>
            </tr>
          </table>

          <div style="margin-top: 20px; padding: 16px; background: #16213e; border-radius: 8px;">
            <p style="margin: 0 0 10px; font-weight: bold; font-size: 14px; color: #aaa;">引擎详情</p>
            <pre style="margin: 0; font-size: 13px; line-height: 1.6; white-space: pre-wrap;">${engineLines}</pre>
          </div>

          <div style="margin-top: 16px; padding: 16px; background: #16213e; border-radius: 8px;">
            <p style="margin: 0 0 6px; font-weight: bold; font-size: 14px; color: #aaa;">信号原因</p>
            <p style="margin: 0; font-size: 14px; line-height: 1.6;">${signal.reason}</p>
          </div>

          <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #333; font-size: 12px; color: #666; text-align: center;">
            <p style="margin: 0;">信号时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
            <p style="margin: 4px 0 0;">策略: ${signal.strategy_name} | 本信号仅供参考，不构成投资建议</p>
          </div>
        </div>
      </div>
    `;

    try {
      const result = await this.transporter.sendMail({
        from: `"Crypto Tools" <${this.fromEmail}>`,
        to: this.toEmail,
        subject,
        html,
      });

      console.log(`[Notification] Email sent to ${this.toEmail}, messageId: ${result.messageId}`);
      return true;
    } catch (error: any) {
      console.error('[Notification] Failed to send email:', error.message);
      return false;
    }
  }

  /** 验证邮件连接 */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error: any) {
      console.error('[Notification] Gmail connection verification failed:', error.message);
      return false;
    }
  }

  // ===== 辅助方法 =====

  private calcPct(entry: number, target: number, direction: string): number {
    if (direction === 'long') {
      return ((target - entry) / entry) * 100;
    }
    return ((entry - target) / entry) * 100;
  }

  private formatPrice(price: number): string {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }
}

// 单例
let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = new NotificationService();
  }
  return instance;
}
