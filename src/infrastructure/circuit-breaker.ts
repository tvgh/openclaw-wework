/**
 * Circuit Breaker Pattern
 * 断路器 - 防止级联故障
 */

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenSuccessThreshold?: number;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  halfOpenSuccess: number;
}

export class CircuitBreaker {
  private failureThreshold: number;
  private resetTimeout: number;
  private halfOpenSuccessThreshold: number;
  private state: CircuitState;
  private failureCount: number;
  private lastFailureTime: number | null;
  private halfOpenSuccess: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000; // 30秒
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 3;
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenSuccess = 0;
  }

  /**
   * 执行操作（带断路器保护）
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 检查断路器状态
    if (this.state === "open") {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.resetTimeout
      ) {
        // 超时后进入半开状态
        this.state = "half-open";
        this.halfOpenSuccess = 0;
      } else {
        throw new CircuitBreakerOpenError(
          "Circuit breaker is open",
          this.getTimeUntilReset()
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * 成功回调
   */
  onSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccess++;
      if (this.halfOpenSuccess >= this.halfOpenSuccessThreshold) {
        this.reset();
      }
    }
    this.failureCount = 0;
  }

  /**
   * 失败回调
   */
  onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // 半开状态下失败，立即重新开启
      this.state = "open";
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
    }
  }

  /**
   * 重置断路器
   */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenSuccess = 0;
  }

  /**
   * 强制打开断路器
   */
  trip(): void {
    this.state = "open";
    this.lastFailureTime = Date.now();
  }

  /**
   * 获取状态
   */
  getState(): CircuitBreakerState {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      halfOpenSuccess: this.halfOpenSuccess,
    };
  }

  /**
   * 检查是否可用
   */
  isAvailable(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "half-open") return true;
    if (
      this.state === "open" &&
      this.lastFailureTime &&
      Date.now() - this.lastFailureTime > this.resetTimeout
    ) {
      return true;
    }
    return false;
  }

  /**
   * 获取距离重置的时间
   */
  getTimeUntilReset(): number | null {
    if (this.state !== "open" || !this.lastFailureTime) {
      return null;
    }
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.resetTimeout - elapsed);
  }
}

/**
 * 断路器开启错误
 */
export class CircuitBreakerOpenError extends Error {
  public readonly timeUntilReset: number | null;

  constructor(message: string, timeUntilReset: number | null) {
    super(message);
    this.name = "CircuitBreakerOpenError";
    this.timeUntilReset = timeUntilReset;
  }
}

// 默认断路器实例
export const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenSuccessThreshold: 3,
});
