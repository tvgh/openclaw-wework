import {
  getChatChannelMeta,
  type ChannelPlugin,
} from "clawdbot/plugin-sdk";

import { getWorkWeixinRuntime } from "./runtime.js";
import {
  connectionPool,
  requestCache,
  rateLimiter,
  circuitBreaker,
  messageQueue,
  getInfrastructureStatus,
  type QueueStatus,
} from "./infrastructure/index.js";

const meta = getChatChannelMeta("workweixin");
const WORKWEIXIN_API_BASE = "https://qyapi.weixin.qq.com";

// WorkWeixin account config interface
interface WorkWeixinAccountConfig {
  enabled?: boolean;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  token?: string;
  encodingAESKey?: string;
  dmPolicy?: string;
  allowFrom?: string[];
}

interface ResolvedWorkWeixinAccount {
  accountId: string;
  name: string | null;
  enabled: boolean;
  config: WorkWeixinAccountConfig;
}

interface WorkWeixinConfig {
  enabled?: boolean;
  corpId?: string;
  corpSecret?: string;
  agentId?: string;
  token?: string;
  encodingAESKey?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  accounts?: Record<string, WorkWeixinAccountConfig>;
}

function getWorkWeixinConfig(cfg: any): WorkWeixinConfig | undefined {
  return cfg?.channels?.workweixin;
}

function resolveWorkWeixinAccount(cfg: any, accountId: string): ResolvedWorkWeixinAccount {
  const wxConfig = getWorkWeixinConfig(cfg) || {};

  if (accountId === "default" || !accountId) {
    return {
      accountId: "default",
      name: null,
      enabled: wxConfig.enabled ?? false,
      config: {
        corpId: wxConfig.corpId,
        corpSecret: wxConfig.corpSecret,
        agentId: wxConfig.agentId,
        token: wxConfig.token,
        encodingAESKey: wxConfig.encodingAESKey,
        dmPolicy: wxConfig.dmPolicy,
        allowFrom: wxConfig.allowFrom,
      },
    };
  }

  const accountConfig = wxConfig.accounts?.[accountId] || {};
  return {
    accountId,
    name: null,
    enabled: accountConfig.enabled ?? false,
    config: accountConfig,
  };
}

function listWorkWeixinAccountIds(cfg: any): string[] {
  const wxConfig = getWorkWeixinConfig(cfg);
  if (!wxConfig) return [];

  const ids: string[] = [];
  if (wxConfig.corpId || wxConfig.enabled) {
    ids.push("default");
  }
  if (wxConfig.accounts) {
    ids.push(...Object.keys(wxConfig.accounts));
  }
  return ids;
}

// WeChat Work API helper - 带缓存的Token获取
async function getAccessToken(corpId: string, corpSecret: string): Promise<string> {
  const cacheKey = requestCache.generateKey("GET", "/cgi-bin/gettoken", { corpId });

  // 尝试从缓存获取
  const cached = requestCache.get(cacheKey) as { accessToken: string; expiresIn: number } | null;
  if (cached) {
    return cached.accessToken;
  }

  const url = `${WORKWEIXIN_API_BASE}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
  const response = await connectionPool.request(url, { method: "GET" });
  const data = await response.json() as { errcode?: number; access_token?: string; expires_in?: number; errmsg?: string };

  if (data.errcode !== 0) {
    throw new Error(`Failed to get access token: ${data.errmsg}`);
  }

  const result = {
    accessToken: data.access_token!,
    expiresIn: data.expires_in!,
  };

  // 缓存access_token (缓存时间比过期时间短120秒)
  const ttl = (data.expires_in! - 120) * 1000;
  requestCache.set(cacheKey, result, ttl);

  return result.accessToken;
}

async function sendWorkWeixinMessage(
  toUser: string,
  content: string,
  config: WorkWeixinAccountConfig,
  options: { accountId?: string; useQueue?: boolean } = {}
): Promise<{ success: boolean; msgid?: string }> {
  const accountId = options.accountId ?? "default";

  // 检查限流
  const rateCheck = await rateLimiter.check(accountId);
  if (!rateCheck.allowed) {
    if (rateCheck.waitTime && rateCheck.waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, rateCheck.waitTime));
    }
  }

  // 使用断路器保护的发送逻辑
  return circuitBreaker.execute(async () => {
    const token = await getAccessToken(config.corpId!, config.corpSecret!);
    const url = `${WORKWEIXIN_API_BASE}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;

    const response = await connectionPool.request(url, {
      method: "POST",
      body: JSON.stringify({
        touser: toUser,
        msgtype: "text",
        agentid: config.agentId,
        text: { content },
      }),
    });

    const data = (await response.json()) as {
      errcode?: number;
      msgid?: string;
      errmsg?: string;
    };

    if (data.errcode !== 0) {
      throw new Error(`Failed to send message: ${data.errmsg}`);
    }

    return { success: true, msgid: data.msgid };
  });
}

/**
 * 发送消息（通过消息队列，带重试机制）
 */
async function sendWorkWeixinMessageQueued(
  toUser: string,
  content: string,
  config: WorkWeixinAccountConfig,
  accountId: string = "default"
): Promise<string> {
  return messageQueue.add({ toUser, content, config, accountId }, async (msg) => {
    await sendWorkWeixinMessage(msg.toUser, msg.content, msg.config, {
      accountId: msg.accountId,
    });
  });
}

/**
 * 获取基础设施状态
 */
function getWorkWeixinInfraStatus() {
  return getInfrastructureStatus();
}

export const workWeixinPlugin: ChannelPlugin<ResolvedWorkWeixinAccount> = {
  id: "workweixin",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "workweixinUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(workweixin|wx|weixin):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveWorkWeixinAccount(cfg, "default");
      await sendWorkWeixinMessage(
        id,
        "配对已批准！您现在可以通过企微向Clawdbot发送消息。",
        account.config
      );
    },
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: true,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.workweixin"] },
  configSchema: {
    safeParse(value: unknown) {
      return { success: true, data: value };
    },
    jsonSchema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg) => listWorkWeixinAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWorkWeixinAccount(cfg, accountId),
    defaultAccountId: (cfg) => listWorkWeixinAccountIds(cfg)[0] || "default",
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = { ...cfg };
      if (!next.channels) next.channels = {};
      if (!next.channels.workweixin) next.channels.workweixin = {};
      if (accountId === "default") {
        next.channels.workweixin.enabled = enabled;
      } else {
        if (!next.channels.workweixin.accounts) next.channels.workweixin.accounts = {};
        if (!next.channels.workweixin.accounts[accountId]) next.channels.workweixin.accounts[accountId] = {};
        next.channels.workweixin.accounts[accountId].enabled = enabled;
      }
      return next;
    },
    deleteAccount: ({ cfg, accountId }) => {
      const next = { ...cfg };
      if (accountId === "default" && next.channels?.workweixin) {
        delete next.channels.workweixin.corpId;
        delete next.channels.workweixin.corpSecret;
        delete next.channels.workweixin.agentId;
      } else if (next.channels?.workweixin?.accounts?.[accountId]) {
        delete next.channels.workweixin.accounts[accountId];
      }
      return next;
    },
    isConfigured: (account) =>
      Boolean(account.config.corpId?.trim()) && Boolean(account.config.corpSecret?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.corpId?.trim()) && Boolean(account.config.corpSecret?.trim()),
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveWorkWeixinAccount(cfg, accountId).config.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) => allowFrom.map(String).filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: `channels.workweixin.dmPolicy`,
      allowFromPath: `channels.workweixin.`,
      approveHint: `clawdbot channels approve workweixin <userId>`,
      normalizeEntry: (raw) => raw.replace(/^(workweixin|wx|weixin):/i, ""),
    }),
    collectWarnings: () => [],
  },
  groups: {
    resolveRequireMention: () => true,
    resolveToolPolicy: () => "allow",
  },
  threading: {
    resolveReplyToMode: () => "first",
  },
  messaging: {
    normalizeTarget: (target) => String(target ?? "").trim().replace(/^(workweixin|wx|weixin):/i, ""),
    targetResolver: {
      looksLikeId: (target) => {
        const t = String(target ?? "").trim();
        return t.length > 0 && t.length <= 64;
      },
      hint: "<userId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  actions: {
    listActions: () => [{ id: "reply", label: "Reply", icon: "reply" }],
    extractToolSend: () => null,
    handleAction: async ({ action }) => {
      if (action.id === "reply") {
        return { action: "reply" };
      }
      return { action: "unknown" };
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId ?? "default",
    applyAccountName: ({ cfg }) => cfg,
    validateInput: ({ input }) => {
      if (!input.corpId && !input.corpSecret) {
        return "WorkWeixin requires --corp-id and --corp-secret.";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const next = { ...cfg };
      if (!next.channels) next.channels = {};
      if (!next.channels.workweixin) next.channels.workweixin = {};

      if (accountId === "default") {
        next.channels.workweixin = {
          ...next.channels.workweixin,
          enabled: true,
          corpId: input.corpId,
          corpSecret: input.corpSecret,
          agentId: input.agentId,
        };
      }
      return next;
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      if (!text) return [];
      const chunks = [];
      const size = limit || 2000;
      let remaining = String(text);
      while (remaining.length > size) {
        chunks.push(remaining.slice(0, size));
        remaining = remaining.slice(size);
      }
      if (remaining.length) chunks.push(remaining);
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveWorkWeixinAccount(cfg, accountId ?? "default");
      const result = await sendWorkWeixinMessage(to, text, account.config, {
        accountId: accountId ?? "default",
      });
      return { channel: "workweixin", ...result };
    },
    sendMedia: async () => {
      throw new Error("Media not yet supported");
    },
  },
  status: {
    defaultRuntime: { accountId: "default", running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    collectStatusIssues: () => {
      const issues: Array<{ level: string; message: string }> = [];
      const infraStatus = getWorkWeixinInfraStatus();

      // 检查断路器状态
      if (infraStatus.circuitBreaker.state === "open") {
        issues.push({
          level: "error",
          message: "Circuit breaker is open - API calls are blocked",
        });
      } else if (infraStatus.circuitBreaker.state === "half-open") {
        issues.push({
          level: "warning",
          message: "Circuit breaker is recovering",
        });
      }

      // 检查消息队列积压
      if (infraStatus.messageQueue.pending > 100) {
        issues.push({
          level: "warning",
          message: `Message queue backlog: ${infraStatus.messageQueue.pending} pending`,
        });
      }

      // 检查失败消息
      if (infraStatus.messageQueue.failedCount > 0) {
        issues.push({
          level: "warning",
          message: `${infraStatus.messageQueue.failedCount} failed messages in queue`,
        });
      }

      return issues;
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
    }),
    probeAccount: async ({ account }) => {
      try {
        // 使用断路器保护的探测
        await circuitBreaker.execute(async () => {
          await getAccessToken(account.config.corpId!, account.config.corpSecret!);
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    },
    auditAccount: async () => undefined,
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.config.corpId?.trim()) && Boolean(account.config.corpSecret?.trim()),
      running: runtime?.running ?? false,
      probe,
      infrastructure: getWorkWeixinInfraStatus(),
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[workweixin] Starting provider for account: ${account.accountId}`);
      // For now, just return an empty async generator
      // Real implementation would set up webhook listener
      return (async function* () {
        // Placeholder - webhook handling would go here
      })();
    },
    logoutAccount: async ({ accountId, cfg }) => {
      return { cleared: false, loggedOut: false };
    },
  },
};
