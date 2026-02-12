/**
 * Infrastructure Module
 * 基础设施层 - 导出所有基础设施组件
 */

// Connection Pool
import { HttpConnectionPool } from "./connection-pool.js";
export {
  HttpConnectionPool,
  connectionPool,
  type ConnectionPoolOptions,
  type ConnectionEntry,
  type PoolStats,
  type PoolStatus,
} from "./connection-pool.js";

// Request Cache
import { RequestCache } from "./request-cache.js";
export {
  RequestCache,
  requestCache,
  type CacheEntry,
  type CacheOptions,
  type CacheStatus,
} from "./request-cache.js";

// Rate Limiter
import { RateLimiter } from "./rate-limiter.js";
export {
  RateLimiter,
  rateLimiter,
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitStatus,
} from "./rate-limiter.js";

// Circuit Breaker
import { CircuitBreaker } from "./circuit-breaker.js";
export {
  CircuitBreaker,
  CircuitBreakerOpenError,
  circuitBreaker,
  type CircuitState,
  type CircuitBreakerOptions,
  type CircuitBreakerState,
} from "./circuit-breaker.js";

// Message Queue
import { MessageQueue } from "./message-queue.js";
export {
  MessageQueue,
  messageQueue,
  type QueueItem,
  type FailedItem,
  type MessageQueueOptions,
  type QueueStats,
  type QueueStatus,
} from "./message-queue.js";

/**
 * 创建完整的基础设施实例
 */
export function createInfrastructure(options?: {
  connectionPool?: import("./connection-pool.js").ConnectionPoolOptions;
  requestCache?: import("./request-cache.js").CacheOptions;
  rateLimiter?: import("./rate-limiter.js").RateLimitOptions;
  circuitBreaker?: import("./circuit-breaker.js").CircuitBreakerOptions;
  messageQueue?: import("./message-queue.js").MessageQueueOptions;
}) {
  return {
    connectionPool: new HttpConnectionPool(options?.connectionPool),
    requestCache: new RequestCache(options?.requestCache),
    rateLimiter: new RateLimiter(options?.rateLimiter),
    circuitBreaker: new CircuitBreaker(options?.circuitBreaker),
    messageQueue: new MessageQueue(options?.messageQueue),
  };
}

/**
 * 获取所有默认实例的状态
 */
export function getInfrastructureStatus() {
  return {
    connectionPool: connectionPool.getStatus(),
    requestCache: requestCache.getStatus(),
    rateLimiter: rateLimiter.getStatus(),
    circuitBreaker: circuitBreaker.getState(),
    messageQueue: messageQueue.getStatus(),
  };
}

/**
 * 重置所有默认实例
 */
export function resetInfrastructure() {
  connectionPool.clear();
  connectionPool.resetStats();
  requestCache.clear();
  rateLimiter.clear();
  circuitBreaker.reset();
  messageQueue.clear();
  messageQueue.clearFailed();
  messageQueue.resetStats();
}
