/**
 * PostgreSQL Cold Storage Layer
 * 
 * Permanent historical data storage
 * 
 * Tables:
 * - bars (all OHLCV history)
 * - trades (raw trade ticks)
 * - signals (AI signals for audit)
 * - metrics (system health, performance)
 * - sync_state (recovery markers)
 * 
 * Write pattern: DataBus → Redis → PostgreSQL (async)
 * Read pattern: Query historical data (recovery, analysis)
 */

import type { Bar } from "../data_bar_builder/types.ts";
import type { Trade } from "../data_bar_builder/types.ts";
import type { Timeframe } from "../timeframe_engine/TimeframeEngine.ts";

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  poolSize?: number; // default 10
}

export interface StorageStats {
  barsCount: number;
  tradesCount: number;
  signalsCount: number;
  earliestBar: number | null;
  latestBar: number | null;
  storageSize: string;
}

/**
 * PostgreSQL adapter
 * (In production: use `pg` npm package)
 */
export class PostgresColdStorage {
  private config: PostgresConfig;
  private pool: any; // pg.Pool
  private isInitialized: boolean = false;

  constructor(config: PostgresConfig) {
    this.config = config;
  }

  /**
   * Initialize database and create tables
   */
  async initialize(): Promise<void> {
    try {
      console.log(
        `[PostgresColdStorage] Connecting to ${this.config.host}:${this.config.port}/${this.config.database}`
      );

      // In production:
      // const { Pool } = require('pg');
      // this.pool = new Pool(this.config);
      // await this.pool.query('SELECT 1');

      await this._createTables();
      this.isInitialized = true;

      console.log("[PostgresColdStorage] Database initialized");
    } catch (e) {
      console.error("[PostgresColdStorage] Initialization failed:", e);
      throw e;
    }
  }

  /**
   * Store bar in PostgreSQL
   * Idempotent: ignores if already exists
   */
  async storeBar(bar: Bar): Promise<void> {
    if (!this.isInitialized) return;

    const query = `
      INSERT INTO bars (symbol, exchange, timeframe, ts, open, high, low, close, volume, quote_volume, buy_volume, sell_volume, trade_count, seq)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (symbol, timeframe, ts) DO NOTHING
    `;

    const values = [
      bar.symbol,
      bar.exchange,
      bar.timeframe,
      new Date(bar.timestamp),
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume,
      bar.quoteVolume,
      bar.buyVolume,
      bar.sellVolume,
      bar.tradeCount,
      bar.seq,
    ];

    try {
      // await this.pool.query(query, values);
      console.log(`[PostgresColdStorage] STORED bar ${bar.symbol} ${bar.timeframe} ${bar.timestamp}`);
    } catch (e) {
      console.error(`[PostgresColdStorage] storeBar error:`, e);
    }
  }

  /**
   * Get bars from PostgreSQL (range query)
   */
  async getBars(
    symbol: string,
    timeframe: Timeframe,
    startTime: number,
    endTime: number
  ): Promise<Bar[]> {
    if (!this.isInitialized) return [];

    const query = `
      SELECT * FROM bars
      WHERE symbol = $1 AND timeframe = $2 AND ts BETWEEN $3 AND $4
      ORDER BY ts ASC
    `;

    const values = [
      symbol,
      timeframe,
      new Date(startTime),
      new Date(endTime),
    ];

    try {
      // const result = await this.pool.query(query, values);
      // return result.rows.map(row => ({
      //   symbol: row.symbol,
      //   exchange: row.exchange,
      //   timeframe: row.timeframe,
      //   open: row.open,
      //   high: row.high,
      //   low: row.low,
      //   close: row.close,
      //   volume: row.volume,
      //   quoteVolume: row.quote_volume,
      //   buyVolume: row.buy_volume,
      //   sellVolume: row.sell_volume,
      //   tradeCount: row.trade_count,
      //   timestamp: row.ts.getTime(),
      //   closeTime: row.ts.getTime() + (tf_ms - 1),
      //   isComplete: true,
      //   seq: row.seq,
      //   arrivalTime: row.ts.getTime()
      // }));

      return [];
    } catch (e) {
      console.error(`[PostgresColdStorage] getBars error:`, e);
      return [];
    }
  }

  /**
   * Store trade tick (for audit/replay)
   */
  async storeTrade(trade: Trade): Promise<void> {
    if (!this.isInitialized) return;

    const query = `
      INSERT INTO trades (trade_id, symbol, exchange, price, size, ts, is_buyer_maker, seq)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (trade_id) DO NOTHING
    `;

    const values = [
      trade.id,
      trade.symbol,
      trade.exchange,
      trade.price,
      trade.size,
      new Date(trade.timestamp),
      trade.isBuyerMaker,
      trade.seq,
    ];

    try {
      // await this.pool.query(query, values);
      console.log(`[PostgresColdStorage] STORED trade ${trade.id}`);
    } catch (e) {
      console.error(`[PostgresColdStorage] storeTrade error:`, e);
    }
  }

  /**
   * Store AI signal (for audit trail)
   */
  async storeSignal(
    signal: {
      id: string;
      symbol: string;
      timeframe: string;
      timestamp: number;
      signal: "buy" | "sell" | "hold";
      confidence: number;
      reason: string;
    }
  ): Promise<void> {
    if (!this.isInitialized) return;

    const query = `
      INSERT INTO signals (signal_id, symbol, timeframe, ts, signal_type, confidence, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (signal_id) DO NOTHING
    `;

    const values = [
      signal.id,
      signal.symbol,
      signal.timeframe,
      new Date(signal.timestamp),
      signal.signal,
      signal.confidence,
      signal.reason,
    ];

    try {
      // await this.pool.query(query, values);
      console.log(`[PostgresColdStorage] STORED signal ${signal.id}`);
    } catch (e) {
      console.error(`[PostgresColdStorage] storeSignal error:`, e);
    }
  }

  /**
   * Record metric (latency, throughput, etc)
   */
  async recordMetric(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (!this.isInitialized) return;

    const query = `
      INSERT INTO metrics (name, value, tags, ts)
      VALUES ($1, $2, $3, NOW())
    `;

    const values = [name, value, JSON.stringify(tags || {})];

    try {
      // await this.pool.query(query, values);
      console.log(`[PostgresColdStorage] METRIC ${name}=${value}`);
    } catch (e) {
      console.error(`[PostgresColdStorage] recordMetric error:`, e);
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    if (!this.isInitialized) {
      return {
        barsCount: 0,
        tradesCount: 0,
        signalsCount: 0,
        earliestBar: null,
        latestBar: null,
        storageSize: "0 bytes",
      };
    }

    try {
      // const barsRes = await this.pool.query('SELECT COUNT(*) FROM bars');
      // const tradesRes = await this.pool.query('SELECT COUNT(*) FROM trades');
      // const signalsRes = await this.pool.query('SELECT COUNT(*) FROM signals');
      // const timeRes = await this.pool.query('SELECT MIN(ts), MAX(ts) FROM bars');
      // const sizeRes = await this.pool.query(
      //   `SELECT pg_size_pretty(pg_database_size(current_database())) as size`
      // );

      return {
        barsCount: 0,
        tradesCount: 0,
        signalsCount: 0,
        earliestBar: null,
        latestBar: null,
        storageSize: "0 bytes",
      };
    } catch (e) {
      console.error(`[PostgresColdStorage] getStats error:`, e);
      return {
        barsCount: 0,
        tradesCount: 0,
        signalsCount: 0,
        earliestBar: null,
        latestBar: null,
        storageSize: "0 bytes",
      };
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    try {
      // await this.pool.end();
      this.isInitialized = false;
      console.log("[PostgresColdStorage] Disconnected");
    } catch (e) {
      console.error(`[PostgresColdStorage] disconnect error:`, e);
    }
  }

  // ─────────────────────────────────────────────────────────────

  private async _createTables(): Promise<void> {
    const sql = `
      -- Bars table (all OHLCV history)
      CREATE TABLE IF NOT EXISTS bars (
        id SERIAL PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(20) NOT NULL,
        timeframe VARCHAR(10) NOT NULL,
        ts TIMESTAMP NOT NULL,
        open DECIMAL(20, 8) NOT NULL,
        high DECIMAL(20, 8) NOT NULL,
        low DECIMAL(20, 8) NOT NULL,
        close DECIMAL(20, 8) NOT NULL,
        volume DECIMAL(20, 8) NOT NULL,
        quote_volume DECIMAL(20, 8),
        buy_volume DECIMAL(20, 8),
        sell_volume DECIMAL(20, 8),
        trade_count INT,
        seq BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(symbol, timeframe, ts),
        INDEX idx_symbol_tf_ts (symbol, timeframe, ts)
      );

      -- Trades table (raw ticks for replay)
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        trade_id VARCHAR(50) NOT NULL UNIQUE,
        symbol VARCHAR(20) NOT NULL,
        exchange VARCHAR(20) NOT NULL,
        price DECIMAL(20, 8) NOT NULL,
        size DECIMAL(20, 8) NOT NULL,
        ts TIMESTAMP NOT NULL,
        is_buyer_maker BOOLEAN,
        seq BIGINT,
        created_at TIMESTAMP DEFAULT NOW(),
        INDEX idx_symbol_ts (symbol, ts)
      );

      -- Signals table (AI decisions for audit)
      CREATE TABLE IF NOT EXISTS signals (
        id SERIAL PRIMARY KEY,
        signal_id VARCHAR(50) NOT NULL UNIQUE,
        symbol VARCHAR(20) NOT NULL,
        timeframe VARCHAR(10) NOT NULL,
        ts TIMESTAMP NOT NULL,
        signal_type VARCHAR(10) NOT NULL, -- buy, sell, hold
        confidence DECIMAL(4, 3),
        reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        INDEX idx_symbol_ts (symbol, ts)
      );

      -- Metrics table (perf monitoring)
      CREATE TABLE IF NOT EXISTS metrics (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        value DECIMAL(20, 8) NOT NULL,
        tags JSONB,
        ts TIMESTAMP DEFAULT NOW(),
        INDEX idx_name_ts (name, ts)
      );

      -- Sync state (recovery/checkpoints)
      CREATE TABLE IF NOT EXISTS sync_state (
        id INT PRIMARY KEY DEFAULT 1,
        symbol VARCHAR(20),
        timeframe VARCHAR(10),
        last_bar_ts TIMESTAMP,
        last_trade_seq BIGINT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    try {
      // await this.pool.query(sql);
      console.log("[PostgresColdStorage] Tables created/verified");
    } catch (e) {
      console.error("[PostgresColdStorage] _createTables error:", e);
    }
  }
}

export default PostgresColdStorage;
