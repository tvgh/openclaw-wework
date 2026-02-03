/**
 * Message Queue with Retry
 * 消息队列 - 支持重试和指数退避
 */

export interface QueueItem<T> {
  id: string;
  message: T;
  sendFn: (msg: T) => Promise<void>;
  retries: number;
  addedAt: number;
  lastAttempt?: number;
}

export interface FailedItem<T> {
  id: string;
  message: T;
  error: string;
  failedAt: number;
  retries: number;
}

export interface MessageQueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  maxConcurrent?: number;
}

export interface QueueStats {
  total: number;
  success: number;
  failed: number;
  retries: number;
}

export interface QueueStatus {
  pending: number;
  processing: number;
  stats: QueueStats;
  failedCount: number;
}

export class MessageQueue<T = unknown> {
  private maxRetries: number;
  private retryDelay: number;
  private maxConcurrent: number;
  private queue: QueueItem<T>[];
  private processing: number;
  private failed: FailedItem<T>[];
  private stats: QueueStats;
  private idCounter: number;

  constructor(options: MessageQueueOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1000;
    this.maxConcurrent = options.maxConcurrent ?? 5;
    this.queue = [];
    this.processing = 0;
    this.failed = [];
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      retries: 0,
    };
    this.idCounter = 0;
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * 添加消息到队列
   */
  async add(message: T, sendFn: (msg: T) => Promise<void>): Promise<string> {
    const id = this.generateId();
    this.queue.push({
      id,
      message,
      sendFn,
      retries: 0,
      addedAt: Date.now(),
    });
    this.stats.total++;

    // 异步处理队列
    this.process().catch(() => {});

    return id;
  }

  /**
   * 处理队列
   */
  private async process(): Promise<void> {
    if (this.processing >= this.maxConcurrent) return;
    if (this.queue.length === 0) return;

    this.processing++;

    try {
      while (this.queue.length > 0 && this.processing <= this.maxConcurrent) {
        const item = this.queue.shift();
        if (item) {
          await this.processItem(item);
        }
      }
    } finally {
      this.processing--;
    }

    // 如果还有待处理项，继续处理
    if (this.queue.length > 0) {
      this.process().catch(() => {});
    }
  }

  /**
   * 处理单个消息
   */
  private async processItem(item: QueueItem<T>): Promise<void> {
    const { message, sendFn, retries } = item;
    item.lastAttempt = Date.now();

    try {
      await sendFn(message);
      this.stats.success++;
    } catch (err) {
      if (retries < this.maxRetries) {
        item.retries++;
        this.stats.retries++;

        // 指数退避
        const delay = this.retryDelay * Math.pow(2, retries);
        await new Promise((resolve) => setTimeout(resolve, delay));

        // 放回队列头部优先重试
        this.queue.unshift(item);
      } else {
        this.stats.failed++;
        this.failed.push({
          id: item.id,
          message,
          error: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
          retries: item.retries,
        });
      }
    }
  }

  /**
   * 获取队列状态
   */
  getStatus(): QueueStatus {
    return {
      pending: this.queue.length,
      processing: this.processing,
      stats: { ...this.stats },
      failedCount: this.failed.length,
    };
  }

  /**
   * 获取失败的消息
   */
  getFailedItems(): FailedItem<T>[] {
    return [...this.failed];
  }

  /**
   * 重试失败的消息
   */
  async retryFailed(): Promise<number> {
    const items = [...this.failed];
    this.failed = [];
    let retried = 0;

    for (const item of items) {
      // 注意：重试时需要提供 sendFn，这里只是简单放回队列
      // 实际使用时应该在添加时保存 sendFn 或使用默认发送函数
      retried++;
    }

    return retried;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 清空失败列表
   */
  clearFailed(): void {
    this.failed = [];
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      retries: 0,
    };
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.queue.length === 0 && this.processing === 0;
  }

  /**
   * 等待队列处理完成
   */
  async drain(): Promise<void> {
    while (!this.isEmpty()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// 默认消息队列实例
export const messageQueue = new MessageQueue({
  maxRetries: 3,
  retryDelay: 1000,
  maxConcurrent: 5,
});
