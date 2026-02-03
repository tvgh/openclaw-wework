/**
 * Rate Limiter (Sliding Window)
 * 速率限制器 - 滑动窗口算法
 */

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  waitTime?: number;
  remaining: number;
  resetAt?: number;
}

export interface RateLimitStatus {
  current: number;
  limit: number;
  remaining: number;
}

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private requests: Map<string, number[]>;

  constructor(options: RateLimitOptions = {}) {
    this.windowMs = options.windowMs ?? 60000; // 1分钟
    this.maxRequests = options.maxRequests ?? 60;
    this.requests = new Map();
  }

  /**
   * 检查是否超限
   */
  async check(key: string = "default"): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    // 过滤出窗口内的请求时间戳
    const timestamps = this.requests.get(key)!.filter((t) => t > windowStart);
    const count = timestamps.length;

    if (count >= this.maxRequests) {
      const oldest = timestamps[0];
      const waitTime = oldest + this.windowMs - now;
      return {
        allowed: false,
        waitTime,
        remaining: 0,
        resetAt: oldest + this.windowMs,
      };
    }

    // 记录本次请求
    timestamps.push(now);
    this.requests.set(key, timestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - count - 1,
      resetAt: now + this.windowMs,
    };
  }

  /**
   * 等待直到可以发送请求
   */
  async waitForSlot(key: string = "default"): Promise<void> {
    const result = await this.check(key);
    if (!result.allowed && result.waitTime) {
      await new Promise((resolve) => setTimeout(resolve, result.waitTime));
    }
  }

  /**
   * 获取状态
   */
  getStatus(key: string = "default"): RateLimitStatus {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = this.requests.get(key) || [];
    const recent = timestamps.filter((t) => t > windowStart);

    return {
      current: recent.length,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - recent.length),
    };
  }

  /**
   * 重置特定key的计数
   */
  reset(key: string = "default"): void {
    this.requests.delete(key);
  }

  /**
   * 清空所有计数
   */
  clear(): void {
    this.requests.clear();
  }

  /**
   * 清理过期的时间戳
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.requests) {
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, recent);
      }
    }
  }
}

// 默认限流器实例 (60请求/分钟)
export const rateLimiter = new RateLimiter({
  windowMs: 60000,
  maxRequests: 60,
});
