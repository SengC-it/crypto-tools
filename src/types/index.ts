// ============================================
// Core Type Definitions
// ============================================

/** 信号方向 */
export type Direction = 'long' | 'short' | 'close';

/** 支持的时间框架 */
export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';

/** K线数据结构 */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 交易信号 */
export interface Signal {
  id?: string;
  symbol: string;
  direction: Direction;
  confidence: number;       // 0.0 ~ 1.0
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  strategy_name: string;
  reason: string;
  timeframe: Timeframe;
  funding_rate?: number;
  leverage: number;
  engine_count: number;
  engine_details: Record<string, EngineDetail>;
  created_at?: string;
  // V5: ADX趋势过滤
  adx?: number;             // 当前ADX值
  trend_strength?: 'strong' | 'moderate' | 'weak' | 'ranging'; // 趋势强度
  // V5: 移动止损(Trailing Stop)
  trailing_stop?: TrailingStopConfig;
}

/** 单个引擎的详细信息 */
export interface EngineDetail {
  direction: Direction;
  confidence: number;
  reason: string;
  indicators: Record<string, number | string>;
}

/** 市场上下文(合约特有数据) */
export interface MarketContext {
  funding_rate: number;
  next_funding_time?: number;
  mark_price?: number;
  index_price?: number;
  open_interest?: number;
  open_interest_change?: number; // 百分比变化
}

/** 监控列表项 */
export interface WatchlistItem {
  id?: string;
  symbol: string;
  timeframe: Timeframe;
  enabled: boolean;
  created_at?: string;
}

/** 策略配置 */
export interface StrategyConfig {
  id?: string;
  engine_type: string;
  enabled: boolean;
  weight: number;
  params: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

/** 通知发送记录 */
export interface NotificationLog {
  id?: string;
  signal_id: string;
  channel: string;
  sent_at: string;
  status: 'sent' | 'failed';
  error?: string;
}

/** 各引擎参数 */

/** 趋势引擎参数 (Freqtrade + Jesse 风格, V5优化: ADX过滤+移动止损) */
export interface TrendParams {
  ema_fast: number;          // 快线周期 (默认8)
  ema_medium: number;        // 中线周期 (默认21)
  ema_slow: number;          // 慢线周期 (默认55)
  rsi_period: number;        // RSI周期 (默认14)
  rsi_oversold: number;      // RSI超卖阈值 (默认30)
  rsi_overbought: number;    // RSI超买阈值 (默认70)
  atr_period: number;        // ATR周期 (默认14)
  atr_sl_multiplier: number; // 止损ATR倍数 (默认3.0)
  atr_tp_multiplier: number; // 止盈ATR倍数 (默认16.0, V5从12.0提升)
  adx_period: number;        // ADX周期 (默认14)
  adx_threshold: number;     // ADX趋势过滤阈值 (默认20, 低于此为震荡市)
  trailing_activation_pct: number;  // 移动止损激活% (默认2.0)
  trailing_callback_pct: number;    // 移动止损回调% (默认1.5)
}

/** 做市引擎参数 (Hummingbot 风格) */
export interface MarketMakingParams {
  funding_rate_threshold: number;   // 资金费率阈值 (默认0.0003)
  oi_change_threshold: number;     // 持仓量变化阈值% (默认5.0)
}

/** 网格/DCA引擎参数 (OctoBot 风格) */
export interface GridDCAParams {
  bb_period: number;         // 布林带周期 (默认20)
  bb_std: number;            // 布林带标准差 (默认2.0)
  dca_levels: number;        // DCA分批次数 (默认3)
  grid_spacing_pct: number;  // 网格间距% (默认2.0)
}

/** 移动止损配置 (V5) */
export interface TrailingStopConfig {
  activation_pct: number;   // 激活条件: 价格朝有利方向移动百分比 (默认2.0%)
  callback_pct: number;     // 回调幅度: 从最高/低价回调百分比时触发止损 (默认1.5%)
  current_trail?: number;   // 当前移动止损价位 (运行时计算)
}

/** 运行结果 */
export interface RunResult {
  timestamp: string;
  signals_generated: number;
  notifications_sent: number;
  errors: string[];
  details: {
    symbol: string;
    timeframe: string;
    engine_results: Record<string, EngineDetail | null>;
    final_signal: Signal | null;
  }[];
}
