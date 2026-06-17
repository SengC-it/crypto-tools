// ============================================
// Database Service - Supabase 数据库操作
// ============================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Signal, WatchlistItem, StrategyConfig, NotificationLog } from '../types';

export class DatabaseService {
  private client: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
    }

    // Node.js < 22 需要显式提供 ws 作为 WebSocket transport
    let realtimeOptions: Record<string, any> = {};
    try {
      const ws = require('ws');
      realtimeOptions = { transport: ws };
    } catch { /* 浏览器环境或已有原生 WebSocket */ }

    this.client = createClient(url, key, {
      auth: { persistSession: false },
      realtime: realtimeOptions,
    });
  }

  // ===== 信号 =====

  /** 保存信号 */
  async saveSignal(signal: Signal): Promise<Signal> {
    const { data, error } = await this.client
      .from('signals')
      .insert({
        symbol: signal.symbol,
        direction: signal.direction,
        confidence: signal.confidence,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
        take_profit: signal.take_profit,
        strategy_name: signal.strategy_name,
        reason: signal.reason,
        timeframe: signal.timeframe,
        funding_rate: signal.funding_rate ?? null,
        leverage: signal.leverage,
        engine_count: signal.engine_count,
        engine_details: signal.engine_details,
      })
      .select()
      .single();

    if (error) {
      console.error('[DB] saveSignal error:', error.message);
      throw new Error(`Failed to save signal: ${error.message}`);
    }

    return data as Signal;
  }

  /** 查询信号历史 */
  async getSignals(options: {
    symbol?: string;
    direction?: string;
    limit?: number;
    offset?: number;
    since?: string;
  } = {}): Promise<{ data: Signal[]; total: number }> {
    const { symbol, direction, limit = 50, offset = 0, since } = options;

    let query = this.client
      .from('signals')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (symbol) query = query.eq('symbol', symbol);
    if (direction) query = query.eq('direction', direction);
    if (since) query = query.gte('created_at', since);

    const { data, error, count } = await query;

    if (error) {
      console.error('[DB] getSignals error:', error.message);
      throw new Error(`Failed to query signals: ${error.message}`);
    }

    return { data: data as Signal[], total: count ?? 0 };
  }

  /** 检查冷却期(同一symbol+direction在N小时内不重复发信号) */
  async isSignalInCooldown(symbol: string, direction: string, cooldownHours: number = 4): Promise<boolean> {
    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.client
      .from('signals')
      .select('id')
      .eq('symbol', symbol)
      .eq('direction', direction)
      .gte('created_at', cutoff)
      .limit(1);

    if (error) {
      console.error('[DB] isSignalInCooldown error:', error.message);
      return false; // 查询失败时允许发送
    }

    return (data?.length ?? 0) > 0;
  }

  // ===== 监控列表 =====

  /** 获取启用的监控列表 */
  async getWatchlist(): Promise<WatchlistItem[]> {
    const { data, error } = await this.client
      .from('watchlist')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[DB] getWatchlist error:', error.message);
      throw new Error(`Failed to get watchlist: ${error.message}`);
    }

    return data as WatchlistItem[];
  }

  /** 添加监控 */
  async addToWatchlist(item: Omit<WatchlistItem, 'id' | 'created_at'>): Promise<WatchlistItem> {
    const { data, error } = await this.client
      .from('watchlist')
      .insert(item)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add to watchlist: ${error.message}`);
    }

    return data as WatchlistItem;
  }

  /** 删除监控 */
  async removeFromWatchlist(id: string): Promise<void> {
    const { error } = await this.client
      .from('watchlist')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to remove from watchlist: ${error.message}`);
    }
  }

  // ===== 策略配置 =====

  /** 获取所有策略配置 */
  async getStrategyConfigs(): Promise<StrategyConfig[]> {
    const { data, error } = await this.client
      .from('strategy_configs')
      .select('*');

    if (error) {
      console.error('[DB] getStrategyConfigs error:', error.message);
      throw new Error(`Failed to get strategy configs: ${error.message}`);
    }

    return data as StrategyConfig[];
  }

  /** 更新策略配置 */
  async updateStrategyConfig(engineType: string, updates: Partial<StrategyConfig>): Promise<StrategyConfig> {
    const { data, error } = await this.client
      .from('strategy_configs')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('engine_type', engineType)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update strategy config: ${error.message}`);
    }

    return data as StrategyConfig;
  }

  // ===== 通知日志 =====

  /** 记录通知发送 */
  async logNotification(log: Omit<NotificationLog, 'id'>): Promise<void> {
    const { error } = await this.client
      .from('notification_log')
      .insert(log);

    if (error) {
      console.error('[DB] logNotification error:', error.message);
    }
  }

  /** 统计今日信号数 */
  async getTodaySignalCount(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, error } = await this.client
      .from('signals')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    if (error) return 0;
    return count ?? 0;
  }
}

// 单例
let instance: DatabaseService | null = null;

export function getDatabaseService(): DatabaseService {
  if (!instance) {
    instance = new DatabaseService();
  }
  return instance;
}
