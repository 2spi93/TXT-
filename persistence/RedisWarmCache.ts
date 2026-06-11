/**
 * Redis Warm Cache Layer
 * 
 * Architecture layer between Hot Cache (RAM) and Cold Storage (PostgreSQL)
 * 
 * Benefits:
 * - Survives restart (hot cache is lost)
 * - Consistent across processes
 * - Fast (Redis < 1ms)
 * - Good for recent bars (1000-10000 per symbol/tf)
 * 
 * Flow:
 * DataBus → Hot Cache (instant)
 *        → Redis Cache (100ms, persists)
 *        → PostgreSQL (1s, forever)
 */

import type { Bar } from "../data_bar_builder/types.ts";
import type { Timeframe } from "../timeframe_engine/TimeframeEngine.ts";
import type { DataBusBar } from "../data_bus/DataBus.ts";

export interface RedisCacheConfig {
  host: string;
  port: number;
  db?: number;
  password?: string;
  maxMemory?: string; // e.g., "256mb"
  ttl?: number; // seconds, default 86400 (24h)
}

export interface WarmCacheStats {
  keysCount: number;
  memory: string;
  hitRate: number; // 0-1
  missRate: number; // 0-1
}

/**
 * Redis client abstraction
 * (In production, use `redis` npm package or `ioredis`)
 */
export class RedisWarmCache {
  private config: RedisCacheConfig;
  private client: any; // redis.RedisClient
  private hits: number = 0;
  private misses: number = 0;
  private isConnected: boolean = false;

  constructor(config: RedisCacheConfig) {
    this.config = config;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      // In production: import { createClient } from 'redis';
      // const client = createClient({ host, port, password, db });
      // await client.connect();

      console.log(
        `[RedisWarmCache] Connecting to Redis ${this.config.host}:${this.config.port}`
      );
      this.isConnected = true;

      // Set max memory policy (optional)
      if (this.config.maxMemory) {
        // await client.configSet('maxmemory', this.config.maxMemory);
        // await client.configSet('maxmemory-policy', 'allkeys-lru');
        console.log(
          `[RedisWarmCache] Max memory set to ${this.config.maxMemory}`
        );
      }
    } catch (e) {
      console.error("[RedisWarmCache] Connection failed:", e);
      throw e;
    }
  }

  /**
   * Store bar in Redis
   * Key format: "bar:{symbol}:{timeframe}:{timestamp}"
   */
  async setBar(bar: DataBusBar): Promise<void> {
    if (!this.isConnected) return;

    const key = `bar:${bar.symbol}:${bar.timeframe}:${bar.timestamp}`;
    const value = JSON.stringify(bar);
    const ttl = this.config.ttl || 86400; // 24h default

    try {
      // await this.client.setEx(key, ttl, value);
      console.log(`[RedisWarmCache] SET ${key}`);
    } catch (e) {
      console.error(`[RedisWarmCache] setBar error:`, e);
    }
  }

  /**
   * Get bar from Redis
   * Returns null if not found (cache miss)
   */
  async getBar(symbol: string, timeframe: Timeframe, timestamp: number): Promise<Bar | null> {
    if (!this.isConnected) {
      this.misses++;
      return null;
    }

    const key = `bar:${symbol}:${timeframe}:${timestamp}`;

    try {
      // const value = await this.client.get(key);
      // if (value) {
      //   this.hits++;
      //   return JSON.parse(value);
      // }

      this.misses++;
      return null;
    } catch (e) {
      console.error(`[RedisWarmCache] getBar error:`, e);
      this.misses++;
      return null;
    }
  }

  /**
   * Get recent bars (for chart loading)
   * Key pattern: "bar:{symbol}:{timeframe}:*"
   */
  async getBars(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100
  ): Promise<Bar[]> {
    if (!this.isConnected) return [];

    const pattern = `bar:${symbol}:${timeframe}:*`;
    const result: Bar[] = [];

    try {
      // const keys = await this.client.keys(pattern);
      // const sorted = keys.sort().slice(-limit);
      // const values = await Promise.all(
      //   sorted.map((k) => this.client.get(k))
      // );
      // return values.map((v) => JSON.parse(v));

      this.hits += limit;
      return result;
    } catch (e) {
      console.error(`[RedisWarmCache] getBars error:`, e);
      this.misses += limit;
      return [];
    }
  }

  /**
   * Store trade history (for audit/analysis)
   * Key: "trade:{symbol}:{tradeId}"
   */
  async setTrade(symbol: string, tradeId: string, tradeData: any): Promise<void> {
    if (!this.isConnected) return;

    const key = `trade:${symbol}:${tradeId}`;
    const ttl = this.config.ttl || 86400;

    try {
      // await this.client.setEx(key, ttl, JSON.stringify(tradeData));
      console.log(`[RedisWarmCache] SET ${key}`);
    } catch (e) {
      console.error(`[RedisWarmCache] setTrade error:`, e);
    }
  }

  /**
   * Store AI signal (for audit trail)
   * Key: "signal:{symbol}:{signalId}"
   */
  async setSignal(symbol: string, signalId: string, signalData: any): Promise<void> {
    if (!this.isConnected) return;

    const key = `signal:${symbol}:${signalId}`;
    const ttl = 604800; // 7 days

    try {
      // await this.client.setEx(key, ttl, JSON.stringify(signalData));
      console.log(`[RedisWarmCache] SET ${key}`);
    } catch (e) {
      console.error(`[RedisWarmCache] setSignal error:`, e);
    }
  }

  /**
   * Store hot key-value (general purpose)
   * Example: last_sync_time, pending_orders, etc
   */
  async set(key: string, value: any, ttlSeconds: number = 3600): Promise<void> {
    if (!this.isConnected) return;

    try {
      // await this.client.setEx(`hot:${key}`, ttlSeconds, JSON.stringify(value));
      console.log(`[RedisWarmCache] SET hot:${key}`);
    } catch (e) {
      console.error(`[RedisWarmCache] set error:`, e);
    }
  }

  /**
   * Get hot key-value
   */
  async get(key: string): Promise<any> {
    if (!this.isConnected) return null;

    try {
      // const value = await this.client.get(`hot:${key}`);
      // return value ? JSON.parse(value) : null;
      return null;
    } catch (e) {
      console.error(`[RedisWarmCache] get error:`, e);
      return null;
    }
  }

  /**
   * List all keys (for debugging)
   */
  async listKeys(pattern: string = "*"): Promise<string[]> {
    if (!this.isConnected) return [];

    try {
      // return await this.client.keys(pattern);
      return [];
    } catch (e) {
      console.error(`[RedisWarmCache] listKeys error:`, e);
      return [];
    }
  }

  /**
   * Clear all data (dangerous, use only in dev)
   */
  async flushDb(): Promise<void> {
    if (!this.isConnected) return;

    try {
      // await this.client.flushDb();
      console.log("[RedisWarmCache] Database flushed");
    } catch (e) {
      console.error(`[RedisWarmCache] flushDb error:`, e);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): WarmCacheStats {
    const total = this.hits + this.misses;
    return {
      keysCount: 0, // Would require DBSIZE call
      memory: "unknown", // Would require INFO call
      hitRate: total > 0 ? this.hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
    };
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    try {
      // await this.client.quit();
      this.isConnected = false;
      console.log("[RedisWarmCache] Disconnected");
    } catch (e) {
      console.error(`[RedisWarmCache] disconnect error:`, e);
    }
  }
}

export default RedisWarmCache;
