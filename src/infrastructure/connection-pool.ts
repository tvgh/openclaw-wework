/**
 * HTTP Connection Pool
 * HTTP连接池管理 - 用于复用连接和限制并发
 */

export interface ConnectionPoolOptions {
  maxConnections?: number;
  timeout?: number;
}

export interface ConnectionEntry {
  createdAt: number;
  lastUsed: number;
  useCount: number;
}

export interface PoolStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
}

export interface PoolStatus {
  activeConnections: number;
  maxConnections: number;
  stats: PoolStats;
}

export class HttpConnectionPool {
  private maxConnections: number;
  private connections: Map<string, ConnectionEntry>;
  private timeout: number;
  private stats: PoolStats;

  constructor(options: ConnectionPoolOptions = {}) {
    this.maxConnections = options.maxConnections ?? 10;
    this.connections = new Map();
    this.timeout = options.timeout ?? 30000;
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
    };
  }

  /**
   * 获取或创建连接
   */
  getConnection(key: string): ConnectionEntry {
    if (!this.connections.has(key)) {
      if (this.connections.size >= this.maxConnections) {
        // 移除最早的连接 (FIFO)
        const oldestKey = this.connections.keys().next().value;
        if (oldestKey) {
          this.connections.delete(oldestKey);
        }
      }
      this.connections.set(key, {
        createdAt: Date.now(),
        lastUsed: Date.now(),
        useCount: 0,
      });
    }

    const conn = this.connections.get(key)!;
    conn.lastUsed = Date.now();
    conn.useCount++;
    return conn;
  }

  /**
   * 执行HTTP请求（带连接管理和超时控制）
   */
  async request(
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout ?? this.timeout
    );

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      const responseTime = Date.now() - startTime;
      this.updateAvgResponseTime(responseTime);
      this.stats.successfulRequests++;

      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      this.stats.failedRequests++;
      throw err;
    }
  }

  /**
   * 更新平均响应时间
   */
  private updateAvgResponseTime(newTime: number): void {
    const total = this.stats.successfulRequests;
    if (total === 0) {
      this.stats.avgResponseTime = newTime;
    } else {
      this.stats.avgResponseTime =
        (this.stats.avgResponseTime * (total - 1) + newTime) / total;
    }
  }

  /**
   * 获取池状态
   */
  getStatus(): PoolStatus {
    return {
      activeConnections: this.connections.size,
      maxConnections: this.maxConnections,
      stats: { ...this.stats },
    };
  }

  /**
   * 清理过期连接
   */
  cleanup(maxAge: number = 300000): void {
    const now = Date.now();
    for (const [key, conn] of this.connections) {
      if (now - conn.lastUsed > maxAge) {
        this.connections.delete(key);
      }
    }
  }

  /**
   * 清空连接池
   */
  clear(): void {
    this.connections.clear();
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
    };
  }
}

// 默认连接池实例
export const connectionPool = new HttpConnectionPool({
  maxConnections: 10,
  timeout: 30000,
});
