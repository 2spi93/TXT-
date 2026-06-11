/**
 * Unified Storage Manager
 * 
 * Coordinates 3-layer caching:
 * 1. Hot Cache (RAM - instant, lost on restart)
 * 2. Warm Cache (Redis - fast, survives restart)
 * 3. Cold Storage (PostgreSQL - permanent)
 * 
 * Flow:
 * DataBus → Hot Cache (sync)
 *        → Redis (async, 100ms)
 *        → PostgreSQL (async, 1s)
 * 
 * Read pattern (LRU):
 * 1. Hot Cache (O(1), always try first)
 * 2. Redis (O(1), if not in RAM)
 * 3. PostgreSQL (O(n), full query)
 */

import type { Bar } from "../data_bar_builder/types.ts";
import type { Trade } from "../data_bar_builder/types.ts";
import type { Timeframe } from "../timeframe_engine/TimeframeEngine.ts";
import type { DataBusBar } from "../data_bus/DataBus.ts";
import RedisWarmCache from "./RedisWarmCache.ts";
import PostgresColdStorage from "./PostgresColdStorage.ts";

export interface StorageManagerConfig {
  redis?: {
    host: string;
    port: number;
    db?: number;
    password?: string;
  };
  postgres?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  batchWriteInterval?: number; // ms, default 5000
  batchSize?: number; // default 100
}

export interface StorageStats {
  hotCache: { size: number };
  warmCache: { hitRate: number; missRate: number };
  coldStorage: {
    barsCount: number;
    tradesCount: number;
    earliestBar: number | null;
    latestBar: number | null;
  };
}

/**
 * 3-Layer Storage Coordinator
 */
export class StorageManager {
  private redis: RedisWarmCache | null = null;
  private postgres: PostgresColdStorage | null = null;
  private config: StorageManagerConfig;

  // Batching for async writes
  private writeBatchBars: Map<string, Bar> = new Map();
  private writeBatchTrades: Trade[] = [];
  private writeBatchInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: StorageManagerConfig) {
    this.config = config;
  }

  /**
   * Initialize storage layers
   */
  async initialize(): Promise<void> {
    try {
      // Initialize Redis (optional)
      if (this.config.redis) {
        this.redis = new RedisWarmCache(this.config.redis);
        await this.redis.connect();
        console.log("[StorageManager] Redis initialized");
      }

      // Initialize PostgreSQL (optional)
      if (this.config.postgres) {
        this.postgres = new PostgresColdStorage(this.config.postgres);
        await this.postgres.initialize();
        console.log("[StorageManager] PostgreSQL initialized");
      }

      // Start batch writer
      this._startBatchWriter();
      console.log("[StorageManager] Storage layers initialized");
    } catch (e) {
      console.error("[StorageManager] Initialization error:", e);
      throw e;
    }
  }

  /**
   * Store bar (writes to all layers)
   * Hot cache: sync
   * Redis + PostgreSQL: async (batched)
   */
  async storeBar(bar: DataBusBar): Promise<void> {
    // Hot cache is internal (already in DataBus)
    // We manage Redis and PostgreSQL here

    // Add to batch
    const key = `${bar.symbol}:${bar.timeframe}:${bar.timestamp}`;
    this.writeBatchBars.set(key, bar);

    // Async writes via batch writer
  }

  /**
   * Store trade (for audit trail)
   */
  async storeTrade(trade: Trade): Promise<void> {
    this.writeBatchTrades.push(trade);
  }

  /**
   * Get bar from storage (3-layer LRU read)
   * 1. Try Redis
   * 2. Try PostgreSQL
   * 3. Return null
   */
  async getBar(symbol: string, timeframe: Timeframe, timestamp: number): Promise<Bar | null> {
    // Try Redis warm cache
    if (this.redis) {
      const bar = await this.redis.getBar(symbol, timeframe, timestamp);
      if (bar) {
        console.log(`[StorageManager] Cache HIT: ${symbol} ${timeframe} ${timestamp}`);
        return bar;
      }
    }

    // Try PostgreSQL cold storage
    if (this.postgres) {
      const bars = await this.postgres.getBars(
        symbol,
        timeframe,
        timestamp,
        timestamp
      );
      if (bars.length > 0) {
        console.log(
          `[StorageManager] Cold storage HIT: ${symbol} ${timeframe} ${timestamp}`
        );
        // Promote to Redis for next time
        if (this.redis) {
          await this.redis.setBar(bars[0] as any);
        }
        return bars[0];
      }
    }

    console.log(`[StorageManager] Cache MISS: ${symbol} ${timeframe} ${timestamp}`);
    return null;
  }

  /**
   * Get bars range from PostgreSQL
   * (Redis is limited to last N; PostgreSQL has full history)
   */
  async getBarsRange(
    symbol: string,
    timeframe: Timeframe,
    startTime: number,
    endTime: number
  ): Promise<Bar[]> {
    if (!this.postgres) {
      console.warn("[StorageManager] PostgreSQL not configured");
      return [];
    }

    return await this.postgres.getBars(symbol, timeframe, startTime, endTime);
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    const redisStats = this.redis?.getStats() || { hitRate: 0, missRate: 0 };
    const pgStats = await this.postgres?.getStats() || {
      barsCount: 0,
      tradesCount: 0,
      earliestBar: null,
      latestBar: null,
    };

    return {
      hotCache: { size: 0 }, // Would need DataBus integration
      warmCache: {
        hitRate: redisStats.hitRate,
        missRate: redisStats.missRate,
      },
      coldStorage: {
        barsCount: pgStats.barsCount,
        tradesCount: pgStats.tradesCount,
        earliestBar: pgStats.earliestBar,
        latestBar: pgStats.latestBar,
      },
    };
  }

  /**
   * Flush batch writes (manual trigger)
   */
  async flush(): Promise<void> {
    await this._processBatch();
    console.log("[StorageManager] Batch flushed");
  }

  /**
   * Disconnect all layers
   */
  async disconnect(): Promise<void> {
    // Flush pending writes
    await this._processBatch();

    if (this.writeBatchInterval) {
      clearInterval(this.writeBatchInterval);
    }

    if (this.redis) {
      await this.redis.disconnect();
    }

    if (this.postgres) {
      await this.postgres.disconnect();
    }

    console.log("[StorageManager] Disconnected");
  }

  // ─────────────────────────────────────────────────────────────

  private _startBatchWriter(): void {
    const interval = this.config.batchWriteInterval || 5000;

    this.writeBatchInterval = setInterval(async () => {
      await this._processBatch();
    }, interval);
  }

  private async _processBatch(): Promise<void> {
    const barCount = this.writeBatchBars.size;
    const tradeCount = this.writeBatchTrades.length;

    if (barCount === 0 && tradeCount === 0) {
      return;
    }

    try {
      // Write bars to Redis
      if (this.redis && barCount > 0) {
        for (const bar of this.writeBatchBars.values()) {
          await this.redis.setBar(bar as any);
        }
      }

      // Write bars to PostgreSQL
      if (this.postgres && barCount > 0) {
        for (const bar of this.writeBatchBars.values()) {
          await this.postgres.storeBar(bar);
        }
      }

      // Write trades to PostgreSQL
      if (this.postgres && tradeCount > 0) {
        for (const trade of this.writeBatchTrades) {
          await this.postgres.storeTrade(trade);
        }
      }

      console.log(
        `[StorageManager] Batch write: ${barCount} bars, ${tradeCount} trades`
      );

      // Clear batches
      this.writeBatchBars.clear();
      this.writeBatchTrades = [];
    } catch (e) {
      console.error("[StorageManager] Batch write error:", e);
    }
  }
}

export default StorageManager;
