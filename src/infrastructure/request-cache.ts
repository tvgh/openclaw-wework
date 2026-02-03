/**
 * Request Cache (LRU)
 * 请求缓存 - 用于减少重复API调用
 */

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
}

export interface CacheOptions {
  maxSize?: number;
  defaultTTL?: number;
}

export interface CacheStatus {
  size: number;
  maxSize: number;
  entries: Array<{
    key: string;
    hitCount: number;
    expiresAt: number;
  }>;
}

export class RequestCache<T = unknown> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;
  private defaultTTL: number;

  constructor(options: CacheOptions = {}) {
    this.cache = new Map();
    this.maxSize = options.maxSize ?? 100;
    this.defaultTTL = options.defaultTTL ?? 30000; // 30秒
  }

  /**
   * 生成缓存key
   */
  generateKey(
    method: string,
    url: string,
    params: Record<string, string> = {}
  ): string {
    const paramStr = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return `${method}:${url}?${paramStr}`;
  }

  /**
   * 获取缓存
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    return entry.data;
  }

  /**
   * 设置缓存
   */
  set(key: string, data: T, ttl: number = this.defaultTTL): void {
    // 如果缓存已满，移除最少使用的条目 (LRU)
    if (this.cache.size >= this.maxSize) {
      let minHit = Infinity;
      let minKey: string | null = null;

      for (const [k, v] of this.cache) {
        if (v.hitCount < minHit) {
          minHit = v.hitCount;
          minKey = k;
        }
      }

      if (minKey) {
        this.cache.delete(minKey);
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
      hitCount: 0,
    });
  }

  /**
   * 检查key是否存在且未过期
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 获取缓存状态
   */
  getStatus(): CacheStatus {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: Array.from(this.cache.entries()).map(([k, v]) => ({
        key: k.length > 50 ? k.substring(0, 50) + "..." : k,
        hitCount: v.hitCount,
        expiresAt: v.expiresAt,
      })),
    };
  }

  /**
   * 清理过期缓存
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  get size(): number {
    return this.cache.size;
  }
}

// 默认请求缓存实例
export const requestCache = new RequestCache({
  maxSize: 100,
  defaultTTL: 30000,
});
